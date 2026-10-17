/**
 * Pure state helpers for the settings page: drafts, diffs, validation, group
 * edits and display labels. No React and no DOM, so they are unit-tested
 * directly.
 */
import type {
  AgentPresetOption, BindingKind, ContextUsage, GroupMemberView, GroupView,
  ModelCatalogView, ModelChoice, ModelSelection, PresetCatalogView, RoutingOp,
} from '../shared/protocol.ts';
import { DEFAULT_SECRET_REF } from '../shared/protocol.ts';
import type { FormOperation, StoredConfig } from './types.ts';

export const DEFAULTS: StoredConfig = {
  botId: '',
  secretEnv: DEFAULT_SECRET_REF,
  adminUserIds: [],
  adminWorkspaces: [],
  wsUrl: '',
  questionTimeoutMs: 60000,
  remoteApprovals: false,
  logEnabled: true,
  logRetentionDays: 14,
};

const LIST_KEYS = ['adminUserIds', 'adminWorkspaces'] as const;
const SCALAR_KEYS = [
  'botId', 'wsUrl', 'questionTimeoutMs', 'remoteApprovals', 'logEnabled', 'logRetentionDays',
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
    adminUserIds: list(v.adminUserIds),
    adminWorkspaces: list(v.adminWorkspaces),
    wsUrl: text(v.wsUrl),
    questionTimeoutMs: typeof v.questionTimeoutMs === 'number' ? v.questionTimeoutMs : DEFAULTS.questionTimeoutMs,
    remoteApprovals: v.remoteApprovals === true,
    logEnabled: v.logEnabled !== false,
    logRetentionDays: typeof v.logRetentionDays === 'number' ? v.logRetentionDays : DEFAULTS.logRetentionDays,
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

export type FieldErrors = Partial<Record<
  'botId' | 'secret' | 'wsUrl' | 'questionTimeoutMs' | 'logRetentionDays',
  string
>>;

/** The 连接 card's own validation: both credentials, nothing else. */
export function validateCredentials(draft: { readonly botId: string; readonly secret: string }, secretConfigured: boolean): FieldErrors {
  const errors: FieldErrors = {};
  if (!draft.botId.trim()) errors.botId = '请填写企业微信 Bot ID。';
  if (!draft.secret.trim() && !secretConfigured) errors.secret = '首次配置需要填写 Bot Secret。';
  return errors;
}

/** The 高级设置 card's own validation: a safe endpoint and the two ranges. */
export function validateAdvanced(draft: Pick<StoredConfig, 'wsUrl' | 'questionTimeoutMs' | 'logRetentionDays'>): FieldErrors {
  const errors: FieldErrors = {};
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
  return errors;
}

export function toggle(values: readonly string[], id: string, on?: boolean): string[] {
  const has = values.includes(id);
  const want = on ?? !has;
  if (want === has) return [...values];
  return want ? [...values, id] : values.filter(value => value !== id);
}

/**
 * Whether one Workspace is inside the administrator notification scope.
 * An empty stored list is the default and means every Workspace.
 */
export function scopeIncludes(values: readonly string[], path: string): boolean {
  return values.length === 0 || values.includes(path);
}

/**
 * The stored scope after toggling one Workspace.
 *
 * A list that covers every offered Workspace collapses back to `[]` — the
 * canonical "all" the Config documents, so checking everything does not
 * silently pin today's Workspace set into the file.
 */
export function toggleScope(values: readonly string[], allPaths: readonly string[], path: string, on: boolean): string[] {
  const next = new Set(values.length ? values : allPaths);
  if (on) next.add(path); else next.delete(path);
  if (next.size >= allPaths.length) return [];
  return allPaths.filter(item => next.has(item));
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

/** A model's display name without its id, for space-tight rows. */
export function modelName(catalog: ModelCatalogView | null | undefined, selection: ModelSelection | undefined): string {
  if (!selection) return '';
  const choice = catalog?.choices.find(item => item.provider === selection.provider && item.model === selection.model);
  return choice ? choice.name : selection.model;
}

/** The effort's display name, or the raw id when the catalog does not know it. */
export function effortLabel(
  catalog: ModelCatalogView | null | undefined, selection: ModelSelection | undefined,
): string {
  const effort = selection?.reasoningEffort;
  if (!effort) return '';
  const choice = catalog?.choices.find(item => item.provider === selection!.provider && item.model === selection!.model);
  return choice?.efforts?.find(item => item.id === effort)?.name ?? effort;
}

/** Names of the presets DSH ships without publishing one. */
const BUILT_IN_PRESET_NAME: Record<string, string> = {
  standard: '标准',
  ptc: 'PTC',
  minimal: '极简',
  cordis: 'Cordis',
};

export function presetName(preset: AgentPresetOption): string {
  return preset.name || BUILT_IN_PRESET_NAME[preset.id] || preset.id;
}

/** A preset's label; the empty id means "whatever DSH composes by default". */
export function presetLabel(presets: PresetCatalogView | null | undefined, id: string | undefined): string {
  if (!id) {
    const fallback = presets?.presets.find(preset => preset.isDefault);
    return fallback ? `跟随 DSH 默认（${presetName(fallback)}）` : '跟随 DSH 默认';
  }
  const found = presets?.presets.find(preset => preset.id === id);
  return found ? presetName(found) : id;
}

/**
 * A preset for a one-line group summary: the name it actually runs, marked when
 * that comes from DSH rather than from the group. `presetLabel` spells the
 * fallback out in full, which is right in a dropdown and too long beside four
 * other facts.
 */
export function presetSummaryLabel(presets: PresetCatalogView | null | undefined, id: string | undefined): string {
  if (id) return presetLabel(presets, id);
  const fallback = presets?.presets.find(preset => preset.isDefault);
  return fallback ? `${presetName(fallback)}（DSH 默认）` : 'DSH 默认';
}

/** Compact token count: 812, 12.3k, 200k, 1.2M. */
export function formatTokens(value: number): string {
  if (value < 1000) return String(Math.round(value));
  if (value < 100_000) return `${(value / 1000).toFixed(1)}k`;
  if (value < 1_000_000) return `${Math.round(value / 1000)}k`;
  return `${(value / 1_000_000).toFixed(1)}M`;
}

/** `12.3k / 200k（6%）`, or just the used count when DSH reported no window. */
export function contextLabel(context: ContextUsage | undefined): string {
  if (!context) return '';
  const used = formatTokens(context.used);
  if (!context.window) return used;
  return `${used} / ${formatTokens(context.window)}（${Math.round((context.used / context.window) * 100)}%）`;
}

export function dshDefaultLabel(catalog: ModelCatalogView | null | undefined): string {
  const value = catalog?.dshDefault;
  if (!value) return '跟随 DSH 默认模型';
  return `跟随 DSH 默认模型（${modelName(catalog, value)}）`;
}

/* ------------------------- groups and members ------------------------- */

export const BINDING_KIND_LABEL: Record<BindingKind, string> = { user: '个人', group: '群聊' };

export const SESSION_STATE_LABEL: Record<GroupMemberView['sessionState'], string> = {
  bound: '已绑定',
  auto: '待创建',
  blank: '待使用',
  missing: '会话不存在',
  archived: '会话已归档',
  unusable: '会话不可用',
};

/** `user:<userid>` / `group:<chatid>`: the key a note is stored under. */
export function personKey(kind: BindingKind, id: string): string {
  return `${kind}:${id}`;
}

/** One group's model for a summary line: its name, marked when it follows DSH. */
export function groupModelSummary(catalog: ModelCatalogView | null | undefined, group: GroupView): string {
  if (group.effectiveProvider && group.effectiveModel) {
    return modelName(catalog, { provider: group.effectiveProvider, model: group.effectiveModel });
  }
  const fallback = catalog?.dshDefault;
  return fallback ? `${modelName(catalog, fallback)}（DSH 默认）` : 'DSH 默认';
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

/* --------------------------- routing operations ------------------------ */

export function addGroup(name?: string): RoutingOp {
  return { op: 'group.add', ...(name ? { name } : {}) };
}

export function updateGroup(id: string, patch: {
  name?: string;
  workspace?: string;
  provider?: string;
  model?: string;
  reasoningEffort?: string;
  preset?: string;
}): RoutingOp {
  return { op: 'group.update', id, patch };
}

export function deleteGroup(id: string): RoutingOp {
  return { op: 'group.delete', id };
}

export function addMember(groupId: string, kind: BindingKind, id: string, label?: string): RoutingOp {
  return { op: 'member.add', groupId, kind, id, ...(label ? { label } : {}) };
}

export function updateMember(key: string, patch: { groupId?: string }): RoutingOp {
  return { op: 'member.update', key, patch };
}

/** Set (or clear) a person's 备注; works for members and administrators alike. */
export function setLabel(key: string, label: string): RoutingOp {
  return { op: 'label.set', key, label };
}

export function removeMember(key: string): RoutingOp {
  return { op: 'member.remove', key };
}

/** Archive one member's Session; the next message creates a fresh one. */
export function archiveMember(key: string): RoutingOp {
  return { op: 'member.archive', key };
}
