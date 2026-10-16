/**
 * Pure state helpers for the settings page: drafts, diffs, validation and
 * list filtering. No React and no DOM, so they are unit-tested directly.
 */
import type { CatalogGroup, CatalogSession, ObservedIdentity } from '../shared/protocol.ts';
import { DEFAULT_SECRET_REF } from '../shared/protocol.ts';
import type { FormOperation, StoredConfig } from './types.ts';

export const DEFAULTS: StoredConfig = {
  botId: '',
  secretEnv: DEFAULT_SECRET_REF,
  chatIds: [],
  sessionIds: [],
  allowedUserIds: [],
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

const LIST_KEYS = ['chatIds', 'sessionIds', 'allowedUserIds'] as const;
const SCALAR_KEYS = ['botId', 'wsUrl', 'questionTimeoutMs', 'remoteApprovals', 'logEnabled', 'logRetentionDays'] as const;

function list(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export function storedFrom(value: Partial<StoredConfig> | undefined): StoredConfig {
  const v = value ?? {};
  return {
    botId: typeof v.botId === 'string' ? v.botId : DEFAULTS.botId,
    secretEnv: typeof v.secretEnv === 'string' && v.secretEnv.trim() ? v.secretEnv : DEFAULTS.secretEnv,
    chatIds: list(v.chatIds),
    sessionIds: list(v.sessionIds),
    allowedUserIds: list(v.allowedUserIds),
    wsUrl: typeof v.wsUrl === 'string' ? v.wsUrl : DEFAULTS.wsUrl,
    questionTimeoutMs: typeof v.questionTimeoutMs === 'number' ? v.questionTimeoutMs : DEFAULTS.questionTimeoutMs,
    remoteApprovals: v.remoteApprovals === true,
    logEnabled: v.logEnabled !== false,
    logRetentionDays: typeof v.logRetentionDays === 'number' ? v.logRetentionDays : DEFAULTS.logRetentionDays,
  };
}

export function draftFrom(stored: StoredConfig): Draft {
  return { ...stored, chatIds: [...stored.chatIds], sessionIds: [...stored.sessionIds], allowedUserIds: [...stored.allowedUserIds], secret: '' };
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

export type FieldErrors = Partial<Record<'botId' | 'secret' | 'wsUrl' | 'questionTimeoutMs' | 'logRetentionDays', string>>;

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
  return errors;
}

export type AccessDimension = 'sessions' | 'chats' | 'users';

export interface AccessSummary {
  /** `open`: nothing restricted; `partial`: some lists empty; `restricted`: all three set. */
  readonly level: 'open' | 'partial' | 'restricted';
  readonly unrestricted: readonly AccessDimension[];
}

export function accessSummary(draft: Pick<StoredConfig, 'sessionIds' | 'chatIds' | 'allowedUserIds'>): AccessSummary {
  const unrestricted: AccessDimension[] = [];
  if (!normalizedList(draft.sessionIds).length) unrestricted.push('sessions');
  if (!normalizedList(draft.chatIds).length) unrestricted.push('chats');
  if (!normalizedList(draft.allowedUserIds).length) unrestricted.push('users');
  return { level: unrestricted.length === 3 ? 'open' : unrestricted.length ? 'partial' : 'restricted', unrestricted };
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

function matches(session: CatalogSession, group: CatalogGroup, needle: string): boolean {
  return [session.title ?? '', session.sessionId, group.title, group.path ?? '']
    .some(text => text.toLowerCase().includes(needle));
}

/** Filter by title, id, Workspace title or path; optionally keep only selected rows. */
export function filterGroups(
  groups: readonly CatalogGroup[], query: string, selected?: ReadonlySet<string>,
): CatalogGroup[] {
  const needle = query.trim().toLowerCase();
  return groups
    .map(group => ({
      ...group,
      sessions: group.sessions.filter(session =>
        (!needle || matches(session, group, needle)) && (!selected || selected.has(session.sessionId))),
    }))
    .filter(group => group.sessions.length > 0);
}

/** Observed identities plus configured IDs that were not observed recently. */
export function identityRows(observed: readonly ObservedIdentity[], configured: readonly string[]): { id: string; observed?: ObservedIdentity }[] {
  const rows: { id: string; observed?: ObservedIdentity }[] = observed.map(entry => ({ id: entry.id, observed: entry }));
  const known = new Set(observed.map(entry => entry.id));
  for (const id of configured) if (!known.has(id)) rows.push({ id });
  return rows;
}

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
