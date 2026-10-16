/**
 * Pure state helpers for the settings page: drafts, diffs, validation and
 * list filtering. No React and no DOM, so they are unit-tested directly.
 */
import type {
  BindingOp, BindingView, BindingsView, CatalogGroup, CatalogSession, ModelCatalogView,
  ModelChoice, ModelSelection, ObservedIdentity,
} from '../shared/protocol.ts';
import { DEFAULT_SECRET_REF } from '../shared/protocol.ts';
import type { FormOperation, StoredConfig } from './types.ts';

export const DEFAULTS: StoredConfig = {
  botId: '',
  secretEnv: DEFAULT_SECRET_REF,
  chatIds: [],
  allowedUserIds: [],
  defaultWorkspace: '',
  defaultProvider: '',
  defaultModel: '',
  defaultReasoningEffort: '',
  adminUserIds: [],
  adminWorkspaces: [],
  wsUrl: '',
  questionTimeoutMs: 60000,
  remoteApprovals: false,
  logEnabled: true,
  logRetentionDays: 14,
};

/** Editable copy of the Config plus the write-only Secret. */
export interface Draft extends StoredConfig {
  /** New Secret typed by the user; empty keeps the stored one. */
  readonly secret: string;
}

const LIST_KEYS = ['chatIds', 'allowedUserIds', 'adminUserIds', 'adminWorkspaces'] as const;
const SCALAR_KEYS = [
  'botId', 'wsUrl', 'questionTimeoutMs', 'remoteApprovals', 'logEnabled', 'logRetentionDays',
  'defaultWorkspace', 'defaultProvider', 'defaultModel', 'defaultReasoningEffort',
] as const;

function list(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export function storedFrom(value: Partial<StoredConfig> | undefined): StoredConfig {
  const v = value ?? {};
  return {
    botId: text(v.botId),
    secretEnv: text(v.secretEnv).trim() || DEFAULTS.secretEnv,
    chatIds: list(v.chatIds),
    allowedUserIds: list(v.allowedUserIds),
    defaultWorkspace: text(v.defaultWorkspace),
    defaultProvider: text(v.defaultProvider),
    defaultModel: text(v.defaultModel),
    defaultReasoningEffort: text(v.defaultReasoningEffort),
    adminUserIds: list(v.adminUserIds),
    adminWorkspaces: list(v.adminWorkspaces),
    wsUrl: text(v.wsUrl),
    questionTimeoutMs: typeof v.questionTimeoutMs === 'number' ? v.questionTimeoutMs : DEFAULTS.questionTimeoutMs,
    remoteApprovals: v.remoteApprovals === true,
    logEnabled: v.logEnabled !== false,
    logRetentionDays: typeof v.logRetentionDays === 'number' ? v.logRetentionDays : DEFAULTS.logRetentionDays,
  };
}

export function draftFrom(stored: StoredConfig): Draft {
  return {
    ...stored,
    chatIds: [...stored.chatIds],
    allowedUserIds: [...stored.allowedUserIds],
    adminUserIds: [...stored.adminUserIds],
    adminWorkspaces: [...stored.adminWorkspaces],
    secret: '',
  };
}

function normalizedList(values: readonly string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  const left = normalizedList(a);
  const right = normalizedList(b);
  return left.length === right.length && left.every(item => right.includes(item));
}

function normalizedScalar(key: (typeof SCALAR_KEYS)[number], draft: StoredConfig): unknown {
  const value = draft[key];
  return typeof value === 'string' ? value.trim() : value;
}

/** The minimal Config operations that turn `base` into `draft` (Secret excluded). */
export function changedOperations(draft: StoredConfig, base: StoredConfig): FormOperation[] {
  const ops: FormOperation[] = [];
  for (const key of SCALAR_KEYS) {
    const next = normalizedScalar(key, draft);
    if (next !== normalizedScalar(key, base)) ops.push({ op: 'set', path: [key], value: next });
  }
  for (const key of LIST_KEYS) {
    if (!sameList(draft[key], base[key])) ops.push({ op: 'set', path: [key], value: normalizedList(draft[key]) });
  }
  return ops;
}

export function isDirty(draft: Draft, base: StoredConfig): boolean {
  return Boolean(draft.secret.trim()) || changedOperations(draft, base).length > 0;
}

export type FieldErrors = Partial<Record<
  'botId' | 'secret' | 'wsUrl' | 'questionTimeoutMs' | 'logRetentionDays' | 'defaultWorkspace' | 'defaultModel',
  string
>>;

/** Absolute path in either POSIX or Windows spelling. */
export function isAbsolutePath(value: string): boolean {
  return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\');
}

export function validate(draft: Draft, secretConfigured: boolean): FieldErrors {
  const errors: FieldErrors = {};
  if (!draft.botId.trim()) errors.botId = '请填写企业微信 Bot ID。';
  if (!draft.secret.trim() && !secretConfigured) errors.secret = '首次配置需要填写 Bot Secret。';
  const wsUrl = draft.wsUrl.trim();
  if (wsUrl) {
    try {
      const url = new URL(wsUrl);
      if (url.protocol !== 'wss:' || url.username || url.password) errors.wsUrl = '只接受不含账号密码的 wss:// 地址。';
    } catch {
      errors.wsUrl = '不是有效的 URL。';
    }
  }
  if (!Number.isFinite(draft.questionTimeoutMs) || draft.questionTimeoutMs < 1000 || draft.questionTimeoutMs > 300000) {
    errors.questionTimeoutMs = '请输入 1–300 秒。';
  }
  if (!Number.isInteger(draft.logRetentionDays) || draft.logRetentionDays < 1 || draft.logRetentionDays > 365) {
    errors.logRetentionDays = '请输入 1–365 的整数天数。';
  }
  const workspace = draft.defaultWorkspace.trim();
  if (workspace && !isAbsolutePath(workspace)) errors.defaultWorkspace = '请填写绝对路径（留空 = 使用插件目录下的 workspace）。';
  const provider = draft.defaultProvider.trim();
  const model = draft.defaultModel.trim();
  if (Boolean(provider) !== Boolean(model)) errors.defaultModel = '请同时选择服务商与模型，或都留空以跟随 DSH 默认模型。';
  return errors;
}

export type AccessDimension = 'chats' | 'users';

export interface AccessSummary {
  /** `open`: nothing restricted; `partial`: one list empty; `restricted`: both set. */
  readonly level: 'open' | 'partial' | 'restricted';
  readonly unrestricted: readonly AccessDimension[];
}

export function accessSummary(draft: Pick<StoredConfig, 'chatIds' | 'allowedUserIds'>): AccessSummary {
  const unrestricted: AccessDimension[] = [];
  if (!normalizedList(draft.chatIds).length) unrestricted.push('chats');
  if (!normalizedList(draft.allowedUserIds).length) unrestricted.push('users');
  return { level: unrestricted.length === 2 ? 'open' : unrestricted.length ? 'partial' : 'restricted', unrestricted };
}

export function toggle(values: readonly string[], id: string, on?: boolean): string[] {
  const has = values.includes(id);
  const want = on ?? !has;
  if (want === has) return [...values];
  return want ? [...values, id] : values.filter(value => value !== id);
}

export function setAll(values: readonly string[], ids: readonly string[], on: boolean): string[] {
  if (on) return [...new Set([...values, ...ids])];
  const remove = new Set(ids);
  return values.filter(value => !remove.has(value));
}

/** Observed identities plus configured IDs that were not observed recently. */
export function identityRows(observed: readonly ObservedIdentity[], configured: readonly string[]): { id: string; observed?: ObservedIdentity }[] {
  const rows: { id: string; observed?: ObservedIdentity }[] = observed.map(entry => ({ id: entry.id, observed: entry }));
  const known = new Set(observed.map(entry => entry.id));
  for (const id of configured) if (!known.has(id)) rows.push({ id });
  return rows;
}

/* ------------------------------- models ------------------------------- */

/** A provider/model pair as it is stored in one `<option value>`. */
export function modelKey(provider: string, model: string): string {
  return provider && model ? `${provider}\u0000${model}` : '';
}

export function parseModelKey(key: string): { provider: string; model: string } {
  const [provider = '', model = ''] = key.split('\u0000');
  return { provider, model };
}

export function choiceLabel(choice: ModelChoice): string {
  return choice.name === choice.model ? choice.model : `${choice.name}（${choice.model}）`;
}

/** Reasoning efforts offered by one provider/model pair. */
export function effortsFor(
  catalog: ModelCatalogView | null | undefined, provider: string, model: string,
): readonly { id: string; name: string }[] {
  const choice = catalog?.choices.find(item => item.provider === provider && item.model === model);
  return choice?.efforts ?? [];
}

export function modelLabel(catalog: ModelCatalogView | null | undefined, selection: ModelSelection | undefined): string {
  if (!selection) return '';
  const choice = catalog?.choices.find(item => item.provider === selection.provider && item.model === selection.model);
  return choice ? choiceLabel(choice) : `${selection.provider}/${selection.model}`;
}

export function dshDefaultLabel(catalog: ModelCatalogView | null | undefined): string {
  const value = catalog?.dshDefault;
  if (!value) return '跟随 DSH 默认模型';
  return `跟随 DSH 默认模型（${modelLabel(catalog, value)}）`;
}

/* ------------------------------ bindings ------------------------------ */

export const BINDING_KIND_LABEL = { user: '个人', group: '群聊' } as const;

export const SESSION_STATE_LABEL: Record<BindingView['sessionState'], string> = {
  bound: '已绑定',
  auto: '待创建',
  blank: '待使用',
  missing: '会话不存在',
  archived: '会话已归档',
  unusable: '会话不可用',
};

export interface BindingGroup {
  readonly key: string;
  readonly title: string;
  readonly path: string;
  readonly rows: readonly BindingView[];
}

/** Bindings grouped by their effective Workspace, filtered by one search string. */
export function bindingGroups(view: BindingsView | null | undefined, query: string): BindingGroup[] {
  const needle = query.trim().toLowerCase();
  const groups = new Map<string, { title: string; path: string; rows: BindingView[] }>();
  for (const binding of view?.items ?? []) {
    const haystack = [
      binding.id, binding.note ?? '', binding.sessionTitle ?? '', binding.sessionId,
      binding.workspaceTitle, binding.workspacePath,
      binding.provider && binding.model ? `${binding.provider}/${binding.model}` : '',
      binding.sessionModel ? `${binding.sessionModel.provider}/${binding.sessionModel.model}` : '',
    ].join(' ').toLowerCase();
    if (needle && !haystack.includes(needle)) continue;
    const key = binding.workspacePath || binding.workspaceTitle;
    const group = groups.get(key) ?? { title: binding.workspaceTitle, path: binding.workspacePath, rows: [] };
    group.rows.push(binding);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .map(([key, group]) => ({ key, title: group.title, path: group.path, rows: group.rows }))
    .sort((left, right) => left.title.localeCompare(right.title));
}

export interface SessionOption {
  readonly sessionId: string;
  readonly title: string | null;
  /** True when the Session is not part of the current catalog. */
  readonly stale?: boolean;
}

/** Sessions the page may offer for one binding: its Workspace's, plus its own. */
export function sessionOptions(binding: BindingView, groups: readonly CatalogGroup[] | undefined): SessionOption[] {
  const found = (groups ?? []).find(group => (group.path ?? '') === binding.workspacePath);
  const options: SessionOption[] = (found?.sessions ?? [])
    .map((session: CatalogSession) => ({ sessionId: session.sessionId, title: session.title }));
  if (binding.sessionId && !options.some(option => option.sessionId === binding.sessionId)) {
    options.unshift({ sessionId: binding.sessionId, title: binding.sessionTitle, stale: true });
  }
  return options;
}

/* ------------------------------- display ------------------------------ */

/** Shorten a home-directory prefix for display: /Users/me/x → ~/x. */
export function displayPath(path: string | undefined): string {
  return (path ?? '').replace(/^(\/Users|\/home)\/[^/]+(?=\/|$)/, '~').replace(/^[A-Za-z]:\\Users\\[^\\]+(?=\\|$)/, '~');
}

export function relativeTime(at: number | undefined, now = Date.now()): string {
  if (!at) return '';
  const diff = Math.max(0, now - at);
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 30 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return new Date(at).toLocaleDateString();
}

/* --------------------------- binding operations ------------------------ */

export function setBindingWorkspace(key: string, workspace: string): BindingOp {
  return { op: 'set', key, patch: { workspace } };
}

export function setBindingSession(key: string, sessionId: string): BindingOp {
  return { op: 'set', key, patch: { sessionId } };
}

export function setBindingModel(key: string, provider: string, model: string, reasoningEffort: string): BindingOp {
  return { op: 'set', key, patch: { provider, model, reasoningEffort } };
}
