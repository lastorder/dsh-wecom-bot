import { WSClient } from '@wecom/aibot-node-sdk';
import { createBridge } from './bridge/index.js';
import { catalogView, createCatalogService } from './catalog.js';
import { isTrustedWsUrl, readBridgeSettings, } from './config.js';
import { createObservationStore } from './observation.js';
import { createRoundTracker } from './rounds.js';
import { createStatusTracker } from './status.js';
import { summarizeTurn } from './turns.js';
export function createRuntime(options) {
    const { ctx, config, log, journal } = options;
    const createClient = options.createClient ?? ((clientOptions) => new WSClient({
        botId: clientOptions.botId,
        secret: clientOptions.secret,
        ...(clientOptions.wsUrl ? { wsUrl: clientOptions.wsUrl } : {}),
        logger: clientOptions.logger,
    }));
    const status = createStatusTracker(journal);
    const observations = createObservationStore();
    const rounds = createRoundTracker({ journal });
    const catalogs = createCatalogService({
        list: async (signal) => (await ctx.sessionController.list({}, signal)).items,
        registry: () => {
            const registry = ctx.get?.('workspaceRegistry');
            return registry && typeof registry.list === 'function' ? registry : undefined;
        },
    });
    let bridge;
    let stopBridge;
    let signature = '';
    let secret = '';
    let queue = Promise.resolve();
    let disposed = false;
    let lastCatalogError = '';
    const disposers = [];
    const scrub = (text) => (secret.length >= 6 ? text.split(secret).join('[redacted]') : text);
    function sdkLogger() {
        const forward = (level) => (...args) => {
            const parts = args.map(arg => typeof arg === 'string' ? arg : arg instanceof Error ? arg.message : arg);
            journal.write({ event: 'wecom.sdk', level, message: parts });
            const text = scrub(parts.filter(part => typeof part === 'string').join(' '));
            // Surface the SDK's terminal conditions on the settings page.
            if (/^Authentication failed/.test(text))
                status.set('error', `认证失败：${text.replace(/^Authentication failed:\s*/, '').slice(0, 160)}`);
            else if (/^Max auth failure attempts/.test(text))
                status.set('error', '多次认证失败，已停止重试；请检查 Bot ID 与 Secret');
            else if (/^Max reconnect attempts/.test(text))
                status.set('offline', '多次重连失败，已停止重连；保存配置可重新连接');
        };
        return { debug() { }, info: forward('info'), warn: forward('warn'), error: forward('error') };
    }
    function teardown() {
        stopBridge?.();
        stopBridge = undefined;
        bridge = undefined;
    }
    async function reconfigure() {
        if (disposed)
            return;
        const settings = readBridgeSettings(config);
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
            }
            catch (error) {
                if (disposed)
                    return;
                teardown();
                signature = '';
                status.set('error', '读取 DSH 凭据失败');
                journal.write({ event: 'config.error', level: 'error', stage: 'credentials', secretRef: settings.secretRef, error });
                return;
            }
        }
        if (disposed)
            return;
        const next = JSON.stringify([settings, resolved]);
        if (next === signature)
            return;
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
    function schedule() {
        queue = queue.then(reconfigure).catch(error => {
            log.error('WeCom reconfigure failed (details in the plugin journal)');
            journal.write({ event: 'bridge.error', level: 'error', stage: 'reconfigure', error });
        });
    }
    async function onTurnEnd(session, end) {
        let cached;
        const summary = () => (cached ??= summarizeTurn(session, end));
        let notified = [];
        try {
            notified = bridge ? await bridge.onTurnEnd(session, end, summary) : [];
        }
        catch (error) {
            journal.write({ event: 'bridge.error', level: 'error', stage: 'turn-end', sessionId: session.id, error });
        }
        if (!rounds.hasPending(session.id) && !notified.length)
            return;
        const turn = summary();
        journal.write({
            event: 'dsh.turn.end', sessionId: session.id, turn: turn.turn, reason: turn.reason,
            durationMs: turn.durationMs, model: turn.model, steps: turn.steps, toolCalls: turn.toolCalls,
            omittedBlocks: turn.omittedBlocks, promptIds: turn.promptIds, assistant: turn.assistantText,
            notifiedChats: notified,
        });
        rounds.onTurnEnd(turn, notified);
    }
    function onSessionEvent(session, event) {
        if (disposed)
            return;
        if (event.type === 'session/title')
            catalogs.invalidate();
        if (event.type === 'turn/end')
            void onTurnEnd(session, event);
    }
    return {
        observations, rounds, status, catalogs,
        current: () => bridge,
        secrets: () => (secret ? [secret] : []),
        async start() {
            const off = [
                ctx.on('app-boot/config-reload', schedule),
                ctx.on('credentials/reference-updated', ref => { if (ref === config.secretEnv.get().trim())
                    schedule(); }),
                ctx.on('session/event', onSessionEvent),
            ];
            for (const dispose of off)
                if (typeof dispose === 'function')
                    disposers.push(dispose);
            schedule();
            await queue;
        },
        async stop() {
            disposed = true;
            for (const dispose of disposers.splice(0))
                dispose();
            await queue;
            teardown();
            rounds.closeAll('interrupted');
        },
        async state(stateOptions = {}) {
            let sessions = null;
            let sessionsError;
            try {
                const catalog = await catalogs.load({ force: stateOptions.refresh === true });
                sessions = catalogView(catalog, readBridgeSettings(config).sessionIds);
                lastCatalogError = '';
            }
            catch (error) {
                sessionsError = '暂时无法读取 DSH Session 列表';
                const message = error instanceof Error ? error.message : String(error);
                if (message !== lastCatalogError)
                    journal.write({ event: 'catalog.error', level: 'warn', error });
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
//# sourceMappingURL=runtime.js.map