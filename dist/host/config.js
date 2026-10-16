import z from '@deepseek-ai/schemastery';
import { DEFAULT_SECRET_REF } from '../shared/protocol.js';
/**
 * Plugin Config. Only Bot ID and the Secret are required to connect; every
 * list left empty means "allow all" for that dimension. The Secret itself
 * never lives here: `secretEnv` names a DSH credential reference.
 */
export const Config = z.object({
    botId: z.string().default('').volatile()
        .description('企业微信智能机器人的 Bot ID（必填）。'),
    secretEnv: z.string().role('credential-ref').default(DEFAULT_SECRET_REF).volatile()
        .description('Bot Secret 在 DSH 凭据库中的引用名；Secret 本身不写入配置。'),
    chatIds: z.array(z.string()).default([]).volatile()
        .description('允许的企微会话（单聊为 userid，群聊为 chatid）。留空 = 全部允许。'),
    sessionIds: z.array(z.string()).default([]).volatile()
        .description('允许操作的 DSH Session。留空 = 全部未归档 Session。'),
    allowedUserIds: z.array(z.string()).default([]).volatile()
        .description('允许操作的企微 userid。留空 = 任何人。'),
    wsUrl: z.string().default('').volatile()
        .description('自定义 WebSocket 地址，仅接受 wss://；留空使用 SDK 默认地址。'),
    questionTimeoutMs: z.number().min(1000).max(300000).default(60000).volatile()
        .description('等待企微回答提问/审批的毫秒数，超时后回退到 DSH 页面。'),
    remoteApprovals: z.boolean().default(false).volatile()
        .description('允许在企微单聊中审批工具调用（默认关闭）。'),
    logEnabled: z.boolean().default(true).volatile()
        .description('在 DSH home 的 wecom-bot/logs 下写入 JSONL 对话日志。'),
    logRetentionDays: z.number().min(1).max(365).default(14).volatile()
        .description('JSONL 日志保留天数。'),
});
export function uniqueIds(values) {
    const result = new Set();
    for (const value of values ?? []) {
        if (typeof value !== 'string')
            continue;
        const id = value.trim();
        if (id)
            result.add(id);
    }
    return [...result];
}
/** Only a credential-free `wss://` URL may replace the SDK endpoint. */
export function isTrustedWsUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'wss:' && !url.username && !url.password && Boolean(url.hostname);
    }
    catch {
        return false;
    }
}
function clamp(value, min, max, fallback) {
    return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
}
export function readBridgeSettings(config) {
    return {
        botId: config.botId.get().trim(),
        secretRef: config.secretEnv.get().trim(),
        wsUrl: config.wsUrl.get().trim(),
        chatIds: uniqueIds(config.chatIds.get()),
        sessionIds: uniqueIds(config.sessionIds.get()),
        allowedUserIds: uniqueIds(config.allowedUserIds.get()),
        questionTimeoutMs: clamp(config.questionTimeoutMs.get(), 1000, 300000, 60000),
        remoteApprovals: config.remoteApprovals.get() === true,
    };
}
export function readJournalSettings(config) {
    return {
        enabled: config.logEnabled.get() !== false,
        retentionDays: clamp(config.logRetentionDays.get(), 1, 365, 14),
    };
}
//# sourceMappingURL=config.js.map