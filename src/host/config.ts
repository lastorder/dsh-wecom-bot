import z from '@deepseek-ai/schemastery';
import { DEFAULT_SECRET_REF } from '../shared/protocol.js';

/**
 * Plugin Config. Only Bot ID and the Secret are required to connect.
 *
 * This is *policy*: who may talk to the Bot, which Workspace and model new
 * Sessions use, and who the administrators are. Per-conversation routing
 * (which Session a chat owns) is runtime state and lives in the binding
 * store, not here — see `bindings.ts`.
 */
export const Config = z.object({
  botId: z.string().default('').volatile()
    .description('企业微信智能机器人的 Bot ID（必填）。'),
  secretEnv: z.string().role('credential-ref').default(DEFAULT_SECRET_REF).volatile()
    .description('Bot Secret 在 DSH 凭据库中的引用名；Secret 本身不写入配置。'),
  chatIds: z.array(z.string()).default([]).volatile()
    .description('允许的企微会话（单聊为 userid，群聊为 chatid）。留空 = 全部允许。'),
  allowedUserIds: z.array(z.string()).default([]).volatile()
    .description('允许操作的企微 userid。留空 = 任何人。'),
  defaultWorkspace: z.string().default('').volatile()
    .description('新会话使用的 Workspace 绝对路径；留空 = 在 DSH home 的 wecom-bot/workspace 自动创建。'),
  defaultProvider: z.string().default('').volatile()
    .description('新会话默认模型的服务商 id；留空 = 使用 DSH 当前默认模型。'),
  defaultModel: z.string().default('').volatile()
    .description('新会话默认模型的 id；留空 = 使用 DSH 当前默认模型。'),
  defaultReasoningEffort: z.string().default('').volatile()
    .description('新会话默认模型的思考强度；留空 = 使用模型默认值。'),
  adminUserIds: z.array(z.string()).default([]).volatile()
    .description('管理员 userid：可切换会话，并按 Workspace 接收通知。'),
  adminWorkspaces: z.array(z.string()).default([]).volatile()
    .description('管理员可操作/接收通知的 Workspace 路径。留空 = 全部 Workspace。'),
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

interface Volatile<T> { get(): T }

export interface PluginConfig {
  readonly botId: Volatile<string>;
  readonly secretEnv: Volatile<string>;
  readonly chatIds: Volatile<string[]>;
  readonly allowedUserIds: Volatile<string[]>;
  readonly defaultWorkspace: Volatile<string>;
  readonly defaultProvider: Volatile<string>;
  readonly defaultModel: Volatile<string>;
  readonly defaultReasoningEffort: Volatile<string>;
  readonly adminUserIds: Volatile<string[]>;
  readonly adminWorkspaces: Volatile<string[]>;
  readonly wsUrl: Volatile<string>;
  readonly questionTimeoutMs: Volatile<number>;
  readonly remoteApprovals: Volatile<boolean>;
  readonly logEnabled: Volatile<boolean>;
  readonly logRetentionDays: Volatile<number>;
}

/** Normalized settings consumed by the bridge. */
export interface BridgeSettings {
  readonly botId: string;
  readonly secretRef: string;
  /** Empty for the SDK default endpoint. */
  readonly wsUrl: string;
  readonly chatIds: readonly string[];
  readonly allowedUserIds: readonly string[];
  /** Empty means the plugin's own Workspace under the DSH home. */
  readonly defaultWorkspace: string;
  /** Empty provider/model mean "use the DSH default model". */
  readonly defaultProvider: string;
  readonly defaultModel: string;
  readonly defaultReasoningEffort: string;
  readonly adminUserIds: readonly string[];
  /** Empty means every Workspace. */
  readonly adminWorkspaces: readonly string[];
  readonly questionTimeoutMs: number;
  readonly remoteApprovals: boolean;
}

export interface JournalSettings {
  readonly enabled: boolean;
  readonly retentionDays: number;
}

export function uniqueIds(values: readonly unknown[] | undefined): string[] {
  const result = new Set<string>();
  for (const value of values ?? []) {
    if (typeof value !== 'string') continue;
    const id = value.trim();
    if (id) result.add(id);
  }
  return [...result];
}

/** Only a credential-free `wss://` URL may replace the SDK endpoint. */
export function isTrustedWsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'wss:' && !url.username && !url.password && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
}

export function readBridgeSettings(config: PluginConfig): BridgeSettings {
  return {
    botId: config.botId.get().trim(),
    secretRef: config.secretEnv.get().trim(),
    wsUrl: config.wsUrl.get().trim(),
    chatIds: uniqueIds(config.chatIds.get()),
    allowedUserIds: uniqueIds(config.allowedUserIds.get()),
    defaultWorkspace: config.defaultWorkspace.get().trim(),
    defaultProvider: config.defaultProvider.get().trim(),
    defaultModel: config.defaultModel.get().trim(),
    defaultReasoningEffort: config.defaultReasoningEffort.get().trim(),
    adminUserIds: uniqueIds(config.adminUserIds.get()),
    adminWorkspaces: uniqueIds(config.adminWorkspaces.get()),
    questionTimeoutMs: clamp(config.questionTimeoutMs.get(), 1000, 300000, 60000),
    remoteApprovals: config.remoteApprovals.get() === true,
  };
}

export function readJournalSettings(config: PluginConfig): JournalSettings {
  return {
    enabled: config.logEnabled.get() !== false,
    retentionDays: clamp(config.logRetentionDays.get(), 1, 365, 14),
  };
}

/** Trailing separators and redundant `.` segments make two spellings of one path differ. */
export function normalizePath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const collapsed = trimmed.replace(/[/\\]+$/, '');
  return collapsed || trimmed;
}

/** Whether a path lies in a configured workspace list; an empty list is every path. */
export function pathListed(values: readonly string[], path: string | undefined): boolean {
  if (!values.length) return true;
  if (!path) return false;
  const target = normalizePath(path);
  return values.some(value => normalizePath(value) === target);
}
