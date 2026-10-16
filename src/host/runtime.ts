import { WSClient } from '@wecom/aibot-node-sdk';
import { createBridge, type Bridge, type BridgeClient } from './bridge/index.js';
import { catalogView, createCatalogService, type CatalogService } from './catalog.js';
import {
  isTrustedWsUrl, readBridgeSettings, type BridgeSettings, type PluginConfig,
} from './config.js';
import type { HostContext, Logger, SessionEvent, SessionHandle, WorkspaceRegistry } from './dsh.js';
import type { Journal } from './journal.js';
import { createObservationStore, type ObservationStore } from './observation.js';
import { createRoundTracker, type RoundTracker } from './rounds.js';
import { createStatusTracker, type StatusTracker } from './status.js';
import { summarizeTurn, type TurnSummary } from './turns.js';
import type { BridgeStateView } from '../shared/protocol.js';

/**
 * Host-lifetime orchestration.
 *
 * Owns everything that must survive a reconnect (observed IDs, rounds, the
 * Session catalog, status counters) and rebuilds the WeCom bridge whenever
 * the Config or the Bot Secret changes. It also owns the single
 * `session/event` listener, so turns that end while the bridge is being
 * replaced still complete their rounds.
 */

export interface ClientOptions {
  readonly botId: string;
  readonly secret: string;
  readonly wsUrl?: string;
  readonly logger: { debug(...args: unknown[]): void; info(...args: unknown[]): void; warn(...args: unknown[]): void; error(...args: unknown[]): void };
}

export interface RuntimeOptions {
  readonly ctx: HostContext;
  readonly config: PluginConfig;
  readonly log: Logger;
  readonly journal: Journal;
  readonly createClient?: (options: ClientOptions) => BridgeClient;
}

export interface Runtime {
  start(): Promise<void>;
  stop(): Promise<void>;
  state(options?: { readonly refresh?: boolean }): Promise<BridgeStateView>;
  /** Values the journal must scrub (the resolved Bot Secret). */
  secrets(): readonly string[];
  readonly observations: ObservationStore;
  readonly rounds: RoundTracker;
  readonly status: StatusTracker;
  readonly catalogs: CatalogService;
  current(): Bridge | undefined;
}

export function createRuntime(options: RuntimeOptions): Runtime {
  const { ctx, config, log, journal } = options;
  const createClient = options.createClient ?? ((clientOptions: ClientOptions) => new WSClient({
    botId: clientOptions.botId,
    secret: clientOptions.secret,
    ...(clientOptions.wsUrl ? { wsUrl: clientOptions.wsUrl } : {}),
    logger: clientOptions.logger,
  }) as unknown as BridgeClient);

  const status = createStatusTracker(journal);
  const observations = createObservationStore();
  const rounds = createRoundTracker({ journal });
  const catalogs = createCatalogService({
    list: async signal => (await ctx.sessionController.list({}, signal)).items,
    registry: () => {
      const registry = ctx.get?.('workspaceRegistry') as WorkspaceRegistry | undefined;
      return registry && typeof registry.list === 'function' ? registry : undefined;
    },
  });

  let bridge: Bridge | undefined;
  let stopBridge: (() => void) | undefined;
  let signature = '';
  let secret = '';
  let queue: Promise<void> = Promise.resolve();
  let disposed = false;
  let lastCatalogError = '';
  const disposers: (() => void)[] = [];

  const scrub = (text: string) => (secret.length >= 6 ? text.split(secret).join('[redacted]') : text);

  function sdkLogger(): ClientOptions['logger'] {
    const forward = (level: 'info' | 'warn' | 'error') => (...args: unknown[]) => {
      const parts = args.map(arg => typeof arg === 'string' ? arg : arg instanceof Error ? arg.message : arg);
      journal.write({ event: 'wecom.sdk', level, message: parts });
      const text = scrub(parts.filter(part => typeof part === 'string').join(' '));
      // Surface the SDK's terminal conditions on the settings page.
      if (/^Authentication failed/.test(text)) status.set('error', `认证失败：${text.replace(/^Authentication failed:\s*/, '').slice(0, 160)}`);
      else if (/^Max auth failure attempts/.test(text)) status.set('error', '多次认证失败，已停止重试；请检查 Bot ID 与 Secret');
      else if (/^Max reconnect attempts/.test(text)) status.set('offline', '多次重连失败，已停止重连；保存配置可重新连接');
    };
    return { debug() {}, info: forward('info'), warn: forward('warn'), error: forward('error') };
  }

  function teardown(): void {
    stopBridge?.();
    stopBridge = undefined;
    bridge = undefined;
  }

  async function reconfigure(): Promise<void> {
    if (disposed) return;
    const settings: BridgeSettings = readBridgeSettings(config);
    if (settings.wsUrl && !isTrustedWsUrl(settings.wsUrl)) {
      if (signature !== 'invalid-ws') {
        teardown();
        signature = 'invalid-ws';
        secret = '';
        log.error('WeCom wsUrl must be a credential-free wss:// address; connection disabled');
        status.set('invalid', 'WebSocket 地址必须是不含账号密码的 wss:// 地址');
      }
      return;
    }
    let resolved = '';
    if (settings.secretRef) {
      try {
        resolved = (await ctx.credentials.resolve(settings.secretRef))?.value ?? '';
      } catch (error) {
        if (disposed) return;
        teardown();
        signature = '';
        status.set('error', '读取 DSH 凭据失败');
        journal.write({ event: 'config.error', level: 'error', stage: 'credentials', secretRef: settings.secretRef, error });
        return;
      }
    }
    if (disposed) return;
    const next = JSON.stringify([settings, resolved]);
    if (next === signature) return;
    signature = next;
    teardown();
    secret = resolved;
    journal.write({
      event: 'config.applied',
      botId: settings.botId, secretRef: settings.secretRef, secretConfigured: Boolean(resolved),
      wsUrl: settings.wsUrl || 'sdk-default',
      chatIds: settings.chatIds, sessionIds: settings.sessionIds, allowedUserIds: settings.allowedUserIds,
      questionTimeoutMs: settings.questionTimeoutMs, remoteApprovals: settings.remoteApprovals,
    });
    if (!settings.botId || !resolved) {
      log.info?.('WeCom bridge awaits Bot ID and Secret on the plugin page');
      status.set('unconfigured', !settings.botId ? '缺少 Bot ID' : '缺少 Bot Secret');
      return;
    }
    const client = createClient({
      botId: settings.botId, secret: resolved, logger: sdkLogger(),
      ...(settings.wsUrl ? { wsUrl: settings.wsUrl } : {}),
    });
    const created = createBridge({ ctx, client, settings, log, journal, observations, rounds, catalogs, status, scrub });
    stopBridge = created.start();
    bridge = created;
  }

  function schedule(): void {
    queue = queue.then(reconfigure).catch(error => {
      log.error('WeCom reconfigure failed (details in the plugin journal)');
      journal.write({ event: 'bridge.error', level: 'error', stage: 'reconfigure', error });
    });
  }

  async function onTurnEnd(session: SessionHandle, end: SessionEvent): Promise<void> {
    let cached: TurnSummary | undefined;
    const summary = () => (cached ??= summarizeTurn(session, end));
    let notified: readonly string[] = [];
    try {
      notified = bridge ? await bridge.onTurnEnd(session, end, summary) : [];
    } catch (error) {
      journal.write({ event: 'bridge.error', level: 'error', stage: 'turn-end', sessionId: session.id, error });
    }
    if (!rounds.hasPending(session.id) && !notified.length) return;
    const turn = summary();
    journal.write({
      event: 'dsh.turn.end', sessionId: session.id, turn: turn.turn, reason: turn.reason,
      durationMs: turn.durationMs, model: turn.model, steps: turn.steps, toolCalls: turn.toolCalls,
      omittedBlocks: turn.omittedBlocks, promptIds: turn.promptIds, assistant: turn.assistantText,
      notifiedChats: notified,
    });
    rounds.onTurnEnd(turn, notified);
  }

  function onSessionEvent(session: SessionHandle, event: SessionEvent): void {
    if (disposed) return;
    if (event.type === 'session/title') catalogs.invalidate();
    if (event.type === 'turn/end') void onTurnEnd(session, event);
  }

  return {
    observations, rounds, status, catalogs,
    current: () => bridge,
    secrets: () => (secret ? [secret] : []),
    async start() {
      const off = [
        ctx.on('app-boot/config-reload', schedule),
        ctx.on('credentials/reference-updated', ref => { if (ref === config.secretEnv.get().trim()) schedule(); }),
        ctx.on('session/event', onSessionEvent),
      ];
      for (const dispose of off) if (typeof dispose === 'function') disposers.push(dispose);
      schedule();
      await queue;
    },
    async stop() {
      disposed = true;
      for (const dispose of disposers.splice(0)) dispose();
      await queue;
      teardown();
      rounds.closeAll('interrupted');
    },
    async state(stateOptions = {}) {
      let sessions: BridgeStateView['sessions'] = null;
      let sessionsError: string | undefined;
      try {
        const catalog = await catalogs.load({ force: stateOptions.refresh === true });
        sessions = catalogView(catalog, readBridgeSettings(config).sessionIds);
        lastCatalogError = '';
      } catch (error) {
        sessionsError = '暂时无法读取 DSH Session 列表';
        const message = error instanceof Error ? error.message : String(error);
        if (message !== lastCatalogError) journal.write({ event: 'catalog.error', level: 'warn', error });
        lastCatalogError = message;
      }
      return {
        version: 1,
        connection: status.connection(),
        traffic: status.traffic(),
        observed: observations.snapshot(),
        sessions,
        ...(sessionsError ? { sessionsError } : {}),
        journal: journal.info(),
      };
    },
  };
}
