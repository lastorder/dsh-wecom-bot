import { WSClient } from '@wecom/aibot-node-sdk';
import { createBridge, type Bridge, type BridgeClient } from './bridge/index.js';
import { createAccessPolicy } from './bridge/policy.js';
import { createBindingStore, type BindingStore } from './bindings.js';
import { applyBindingOps, buildBindingsView, type BindingOpResult } from './bindings-view.js';
import { catalogView, createCatalogService, type CatalogService } from './catalog.js';
import {
  isTrustedWsUrl, readBridgeSettings, type BridgeSettings, type PluginConfig,
} from './config.js';
import type { AgentDefaultModel, HostContext, Logger, SessionEvent, SessionHandle, WorkspaceRegistry } from './dsh.js';
import { pluginHome, type Journal } from './journal.js';
import { createModelService, type ModelService } from './models.js';
import { createObservationStore, type ObservationStore } from './observation.js';
import { createRoundTracker, type RoundTracker } from './rounds.js';
import { createRouter, type Router } from './routing.js';
import { createSessionProvisioner, type ModelDefaults, type SessionProvisioner } from './sessions.js';
import { createStatusTracker, type StatusTracker } from './status.js';
import { summarizeTurn, type TurnSummary } from './turns.js';
import { createWorkspaceService, pluginWorkspacePath, type WorkspaceService } from './workspaces.js';
import { join } from 'node:path';
import type {
  BindingOp, BindingsView, BridgeStateView, ModelCatalogView, PluginDefaultsView,
} from '../shared/protocol.js';

/**
 * Host-lifetime orchestration.
 *
 * Owns everything that must survive a reconnect — observed IDs, rounds, the
 * Session catalog, routing bindings, status counters — and rebuilds the WeCom
 * bridge whenever the Config changes. It also owns the single `session/event`
 * listener, so turns that end while the bridge is being replaced still
 * complete their rounds.
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
  /** The bindings table for the settings page. */
  bindingsView(options?: { readonly refresh?: boolean }): Promise<BindingsView>;
  /** Apply settings-page binding edits. */
  applyBindings(ops: readonly BindingOp[]): Promise<BindingOpResult>;
  /** Values the journal must scrub (the resolved Bot Secret). */
  secrets(): readonly string[];
  readonly observations: ObservationStore;
  readonly rounds: RoundTracker;
  readonly status: StatusTracker;
  readonly catalogs: CatalogService;
  readonly bindings: BindingStore;
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
  const bindings = createBindingStore({
    directory: pluginHome(),
    onError: (error, stage) => {
      log.warn(`WeCom binding store ${stage} failed`);
      journal.write({ event: 'binding.store.error', level: 'warn', stage, error });
    },
  });
  const workspaces = createWorkspaceService({
    registry: () => {
      const registry = ctx.get?.('workspaceRegistry') as WorkspaceRegistry | undefined;
      return registry && typeof registry.list === 'function' ? registry : undefined;
    },
    defaultPath: pluginWorkspacePath(pluginHome()),
    log,
  });
  const models: ModelService = createModelService({
    sessionController: ctx.sessionController,
    defaults: () => ctx.get?.('agentDefaultModel') as AgentDefaultModel | undefined,
    log,
  });
  const provisioner: SessionProvisioner = createSessionProvisioner({
    sessionController: ctx.sessionController,
    models,
    workspaces,
    catalogs,
    bindings,
    bindingKey: binding => `${binding.kind}:${binding.id}`,
    journal,
    log,
  });

  function modelDefaults(): ModelDefaults {
    const settings = readBridgeSettings(config);
    return {
      provider: settings.defaultProvider,
      model: settings.defaultModel,
      reasoningEffort: settings.defaultReasoningEffort,
    };
  }

  const router: Router = createRouter({ store: bindings, provisioner, defaults: modelDefaults, log });

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
      chatIds: settings.chatIds, allowedUserIds: settings.allowedUserIds,
      defaultWorkspace: settings.defaultWorkspace || pluginWorkspacePath(pluginHome()),
      defaultProvider: settings.defaultProvider, defaultModel: settings.defaultModel,
      defaultReasoningEffort: settings.defaultReasoningEffort,
      adminUserIds: settings.adminUserIds, adminWorkspaces: settings.adminWorkspaces,
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
    const created = createBridge({
      ctx, client, settings, router, log, journal, observations, rounds, catalogs, status, scrub,
    });
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

  async function defaultsView(): Promise<PluginDefaultsView> {
    const settings = readBridgeSettings(config);
    const base = {
      workspace: settings.defaultWorkspace,
      provider: settings.defaultProvider,
      model: settings.defaultModel,
      ...(settings.defaultReasoningEffort ? { reasoningEffort: settings.defaultReasoningEffort } : {}),
    };
    try {
      const resolved = await workspaces.describe(settings.defaultWorkspace);
      return { ...base, workspacePath: resolved.path, workspaceTitle: resolved.title };
    } catch (error) {
      return {
        ...base, workspacePath: '',
        workspaceTitle: settings.defaultWorkspace || '插件默认 Workspace',
        workspaceError: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** Never let a slow model catalog hold up the settings page. */
  async function modelsView(refresh: boolean): Promise<{ view: ModelCatalogView | null; error?: string }> {
    const cached = models.snapshot();
    if (cached && !refresh) return { view: cached };
    try {
      if (cached) return { view: await models.load({ refresh: true }) };
      const loaded = await Promise.race([
        models.load(),
        new Promise<undefined>(resolve => { setTimeout(() => resolve(undefined), 2500).unref?.(); }),
      ]);
      return { view: loaded ?? models.snapshot() ?? null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { view: cached ?? null, error: `读取 DSH 模型列表失败：${message}` };
    }
  }

  async function bindingsView(options: { readonly refresh?: boolean } = {}): Promise<BindingsView> {
    await bindings.load();
    if (options.refresh) catalogs.invalidate();
    const policy = createAccessPolicy(readBridgeSettings(config));
    return await buildBindingsView({
      bindings, provisioner, workspaces, models, catalogs, observations,
      defaults: modelDefaults,
      isAdmin: user => policy.isAdmin(user),
    });
  }

  return {
    observations, rounds, status, catalogs, bindings,
    current: () => bridge,
    secrets: () => (secret ? [secret] : []),
    async start() {
      const off = [
        ctx.on('app-boot/config-reload', schedule),
        ctx.on('credentials/reference-updated', ref => { if (ref === config.secretEnv.get().trim()) schedule(); }),
        ctx.on('session/event', onSessionEvent),
      ];
      for (const dispose of off) if (typeof dispose === 'function') disposers.push(dispose);
      await bindings.load();
      schedule();
      await queue;
    },
    async stop() {
      disposed = true;
      for (const dispose of disposers.splice(0)) dispose();
      await queue;
      teardown();
      rounds.closeAll('interrupted');
      await bindings.flush();
    },
    bindingsView,
    async applyBindings(ops) {
      const result = await applyBindingOps({ bindings, workspaces, models, router, log }, ops);
      if (result.ok) catalogs.invalidate();
      return result;
    },
    async state(stateOptions = {}) {
      const refresh = stateOptions.refresh === true;
      let sessions: BridgeStateView['sessions'] = null;
      let sessionsError: string | undefined;
      if (refresh) catalogs.invalidate();
      try {
        const catalog = await catalogs.load({ force: refresh });
        sessions = catalogView(catalog, bindings.list().map(record => record.sessionId).filter(Boolean));
        lastCatalogError = '';
      } catch (error) {
        sessionsError = '暂时无法读取 DSH Session 列表';
        const message = error instanceof Error ? error.message : String(error);
        if (message !== lastCatalogError) journal.write({ event: 'catalog.error', level: 'warn', error });
        lastCatalogError = message;
      }
      const settings = readBridgeSettings(config);
      const defaults = await defaultsView();
      let bindingsState: BindingsView | null = null;
      let bindingsError: string | undefined;
      try {
        bindingsState = await bindingsView({ refresh });
      } catch (error) {
        bindingsError = '暂时无法读取绑定信息';
        journal.write({ event: 'binding.view.error', level: 'warn', error });
      }
      const { view: modelView, error: modelsError } = await modelsView(refresh);
      const notices: string[] = [];
      if (defaults.workspaceError) notices.push(`默认 Workspace 不可用：${defaults.workspaceError}`);
      if (settings.adminUserIds.length && !settings.adminWorkspaces.length) {
        notices.push('已配置管理员但未限定 Workspace：管理员会收到所有 Workspace 的会话通知。');
      }
      if (bindingsState?.full) notices.push('会话绑定数量已达上限，新会话不会被记录；请在下方清理。');
      return {
        version: 2,
        connection: status.connection(),
        traffic: status.traffic(),
        observed: observations.snapshot(),
        sessions,
        ...(sessionsError ? { sessionsError } : {}),
        bindings: bindingsState,
        ...(bindingsError ? { bindingsError } : {}),
        models: modelView,
        ...(modelsError ? { modelsError } : {}),
        workspaces: workspaces.list(),
        defaults,
        admins: settings.adminUserIds,
        adminWorkspaces: settings.adminWorkspaces,
        notices,
        journal: journal.info(),
      };
    },
  };
}
