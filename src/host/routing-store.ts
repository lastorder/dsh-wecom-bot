import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  DEFAULT_GROUP_ID, DEFAULT_GROUP_NAME, MAX_BINDINGS, MAX_GROUPS, MAX_LABEL_CHARS,
  ROUTING_VERSION, type BindingKind, type BindingRecord, type GroupRecord,
} from '../shared/protocol.js';

/**
 * Durable routing state: the user groups (each owning a Workspace, a model and
 * an agent preset) and the members assigned to them.
 *
 * A member row is what authorizes one WeCom principal — private chat senders
 * by their userid, group chats by their chatid — and it also records the DSH
 * Session that principal talks to. This is runtime state, not Config: the page
 * edits it live (and the operator authorizes a rejected sender from the
 * settings page), which must not rewrite the DSH profile document or
 * reconnect the socket. The file lives next to the journal, under
 * `<DSH home>/wecom-bot/bindings.json`, and every write is serialized and
 * atomic (write-then-rename).
 *
 * The operator note (备注) is keyed by person, not by membership: a note is
 * about who somebody is, so it survives being moved between groups, being
 * removed, and belonging to no group at all (an administrator).
 *
 * Administrators also keep one preference here: the Workspace their operator
 * commands (`/sessions`, `/new`) default to. It belongs to the person, like
 * the note, and is written by the Bot itself rather than the page.
 *
 * There is deliberately no migration path from the pre-group versions: the
 * plugin has no deployed users on them, and a file of another version is set
 * aside rather than half-read, so a future change only has to describe the
 * current version.
 */

export interface BindingKeyParts {
  readonly chat: string;
  readonly user: string;
  readonly chatType: 'single' | 'group';
}

export interface GroupPatch {
  readonly name?: string;
  readonly workspace?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly reasoningEffort?: string;
  readonly preset?: string;
}

export interface BindingPatch {
  readonly groupId?: string;
  readonly sessionId?: string;
}

export interface RoutingStore {
  /** Read the file once; safe to call repeatedly and concurrently. */
  load(): Promise<void>;
  groups(): readonly GroupRecord[];
  group(id: string): GroupRecord | undefined;
  bindings(): readonly BindingRecord[];
  get(key: string): BindingRecord | undefined;
  /** Members of one group, newest activity last. */
  inGroup(groupId: string): readonly BindingRecord[];
  createGroup(name?: string): Promise<GroupRecord>;
  updateGroup(id: string, patch: GroupPatch): Promise<GroupRecord | undefined>;
  /** Deletes a group and every membership in it; the default group is refused. */
  removeGroup(id: string): Promise<{ readonly ok: boolean; readonly removed: number }>;
  /** Authorize a principal (or re-assign an existing one) into a group. */
  create(kind: BindingKind, id: string, options: { readonly groupId: string; readonly label?: string }): Promise<BindingRecord>;
  update(key: string, patch: BindingPatch): Promise<BindingRecord | undefined>;
  remove(key: string): Promise<boolean>;
  /** The operator note for one principal, whether or not it is a member. */
  label(key: string): string;
  /** Set (or clear) one principal's note; survives membership changes. */
  setLabel(key: string, label: string): Promise<string>;
  /** The Workspace one administrator's commands default to; empty means all. */
  adminWorkspace(user: string): string;
  /** Point one administrator's commands at one Workspace ('' clears it). */
  setAdminWorkspace(user: string, path: string): Promise<void>;
  /** Every member currently pointing at one Session. */
  forSession(sessionId: string): readonly BindingRecord[];
  /** True when no new member may be created. */
  full(): boolean;
  flush(): Promise<void>;
  /** Absolute path of the backing file. */
  readonly file: string;
}

export interface RoutingStoreOptions {
  readonly directory: string;
  readonly maxEntries?: number;
  readonly maxGroups?: number;
  now?(): number;
  onError?(error: unknown, stage: string): void;
}

interface StoredFile {
  readonly version?: unknown;
  readonly groups?: unknown;
  readonly bindings?: unknown;
  readonly labels?: unknown;
  /** Per-administrator preferences, keyed by userid; see {@link AdminDefaults}. */
  readonly adminDefaults?: unknown;
}

/**
 * One administrator's preferences. An object rather than a bare path so a
 * second preference can join `workspace` later without changing the file
 * shape again.
 */
export interface AdminDefaults {
  readonly workspace: string;
}

/** `user:<userid>` for private chats, `group:<chatid>` for groups. */
export function bindingKey(kind: BindingKind, id: string): string {
  return `${kind}:${id}`;
}

export function bindingKeyFor(parts: BindingKeyParts): string {
  return parts.chatType === 'group' ? bindingKey('group', parts.chat) : bindingKey('user', parts.user);
}

export function parseBindingKey(key: string): { readonly kind: BindingKind; readonly id: string } | undefined {
  const match = /^(user|group):(.+)$/.exec(key.trim());
  if (!match) return undefined;
  return { kind: match[1] as BindingKind, id: match[2]! };
}

/** Bounded, control-character-free WeCom identifier. */
export function validBindingId(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim()) && value.length <= 512
    && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
}

/** One-line operator note, bounded and free of control characters. */
export function normalizeLabel(value: unknown): string {
  if (typeof value !== 'string') return '';
  const squashed = value.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  if (/[\u0000-\u001f\u007f-\u009f]/.test(squashed)) return '';
  return squashed.slice(0, MAX_LABEL_CHARS);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * The Workspace stored in one `adminDefaults` entry. Only the object form is
 * read: this layout was never released any other way, and a bare string is
 * exactly the shape a future reader would have to guess about.
 */
function adminDefaultsWorkspace(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  return text((value as Record<string, unknown>).workspace);
}

function stamp(value: unknown): number {
  return Number.isFinite(value) ? Number(value) : 0;
}

function normalizeGroup(value: unknown): GroupRecord | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const id = text(record.id);
  if (!id || id.length > 64) return undefined;
  const name = normalizeLabel(record.name) || DEFAULT_GROUP_NAME;
  return {
    id,
    name,
    workspace: text(record.workspace),
    provider: text(record.provider),
    model: text(record.model),
    reasoningEffort: text(record.reasoningEffort),
    preset: text(record.preset),
    createdAt: stamp(record.createdAt),
    updatedAt: stamp(record.updatedAt),
  };
}

/** One stored member row, or undefined when the entry is unusable. */
function normalizeBinding(value: unknown): BindingRecord | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const kind = record.kind === 'group' ? 'group' : record.kind === 'user' ? 'user' : undefined;
  if (!kind || !validBindingId(record.id)) return undefined;
  return {
    kind,
    id: (record.id as string).trim(),
    groupId: text(record.groupId) || DEFAULT_GROUP_ID,
    sessionId: text(record.sessionId),
    createdAt: stamp(record.createdAt),
    updatedAt: stamp(record.updatedAt),
  };
}

export function createRoutingStore(options: RoutingStoreOptions): RoutingStore {
  const file = join(options.directory, 'bindings.json');
  const max = options.maxEntries ?? MAX_BINDINGS;
  const maxGroups = options.maxGroups ?? MAX_GROUPS;
  const now = options.now ?? Date.now;
  const report = (error: unknown, stage: string) => { try { options.onError?.(error, stage); } catch { /* reporting must never throw */ } };
  const groups = new Map<string, GroupRecord>();
  const bindings = new Map<string, BindingRecord>();
  /** Notes by principal key (`user:<id>` / `group:<id>`), members or not. */
  const labels = new Map<string, string>();
  /** Per-administrator default Workspace, keyed by userid. */
  const adminWorkspaces = new Map<string, string>();
  let loaded: Promise<void> | undefined;
  let chain: Promise<void> = Promise.resolve();
  let dropped = false;

  function defaultGroup(): GroupRecord {
    const existing = groups.get(DEFAULT_GROUP_ID);
    if (existing) return existing;
    const at = now();
    const created: GroupRecord = {
      id: DEFAULT_GROUP_ID, name: DEFAULT_GROUP_NAME, workspace: '',
      provider: '', model: '', reasoningEffort: '', preset: '', createdAt: at, updatedAt: at,
    };
    groups.set(DEFAULT_GROUP_ID, created);
    return created;
  }

  function loadOnce(): Promise<void> {
    loaded ??= readFileOnce();
    return loaded;
  }

  /** Move an unreadable file aside so the next write cannot destroy it. */
  async function setAside(suffix: string): Promise<void> {
    await rename(file, `${file}.${suffix}`).catch(cause => report(cause, 'quarantine'));
  }

  async function readFileOnce(): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') report(error, 'read');
      defaultGroup();
      return;
    }
    let parsed: StoredFile;
    try {
      parsed = JSON.parse(raw) as StoredFile;
    } catch (error) {
      report(error, 'parse');
      await setAside('corrupt');
      defaultGroup();
      return;
    }
    const version = typeof parsed.version === 'number' || typeof parsed.version === 'string'
      ? String(parsed.version)
      : '';
    if (version !== ROUTING_VERSION || !Array.isArray(parsed.bindings)) {
      // Every earlier layout is gone by design (there is no deployment on one),
      // so this is a read error, not something to migrate.
      report(new Error(`routing file version ${version || '(missing)'} is not ${ROUTING_VERSION}`), 'version');
      // The version is untrusted file content: never let it choose a path.
      await setAside(`v${version.replace(/[^0-9A-Za-z.-]/g, '_').slice(0, 24) || 'unknown'}`);
      defaultGroup();
      return;
    }
    if (Array.isArray(parsed.groups)) {
      for (const entry of parsed.groups) {
        const group = normalizeGroup(entry);
        if (!group || groups.has(group.id)) continue;
        groups.set(group.id, group);
      }
    }
    defaultGroup();
    for (const [key, value] of Object.entries((parsed.labels ?? {}) as Record<string, unknown>)) {
      const note = normalizeLabel(value);
      if (!note || !parseBindingKey(key)) continue;
      labels.set(key, note);
    }
    for (const [user, value] of Object.entries((parsed.adminDefaults ?? {}) as Record<string, unknown>)) {
      const path = adminDefaultsWorkspace(value);
      if (path && validBindingId(user)) adminWorkspaces.set(user, path);
    }
    for (const entry of parsed.bindings) {
      const record = normalizeBinding(entry);
      if (!record) continue;
      if (!bindings.has(bindingKey(record.kind, record.id))) bindings.set(bindingKey(record.kind, record.id), record);
    }
    // A member must never reference a group that is not there.
    for (const [key, record] of bindings) {
      if (!groups.has(record.groupId)) bindings.set(key, { ...record, groupId: DEFAULT_GROUP_ID });
    }
  }

  function persist(): Promise<void> {
    const payload = JSON.stringify({
      version: ROUTING_VERSION,
      savedAt: new Date(now()).toISOString(),
      groups: [...groups.values()],
      bindings: [...bindings.values()],
      labels: Object.fromEntries(labels),
      adminDefaults: Object.fromEntries(
        [...adminWorkspaces].map(([user, workspace]): [string, AdminDefaults] => [user, { workspace }]),
      ),
    }, undefined, 2);
    chain = chain.then(async () => {
      const temporary = `${file}.${process.pid}.tmp`;
      try {
        await mkdir(dirname(file), { recursive: true, mode: 0o700 });
        await writeFile(temporary, `${payload}\n`, { encoding: 'utf8', mode: 0o600 });
        await rename(temporary, file);
      } catch (error) {
        report(error, 'write');
      }
    });
    return chain;
  }

  function putBinding(record: BindingRecord): BindingRecord {
    bindings.set(bindingKey(record.kind, record.id), record);
    void persist();
    return record;
  }

  function putGroup(record: GroupRecord): GroupRecord {
    groups.set(record.id, record);
    void persist();
    return record;
  }

  async function writeLabel(key: string, value: string): Promise<string> {
    const note = normalizeLabel(value);
    if (note) labels.set(key, note);
    else labels.delete(key);
    await persist();
    return note;
  }

  return {
    file,
    async load() {
      await loadOnce();
    },
    groups: () => [...groups.values()],
    group: id => groups.get(id),
    bindings: () => [...bindings.values()],
    get: key => bindings.get(key),
    inGroup: groupId => [...bindings.values()].filter(record => record.groupId === groupId),
    async createGroup(name) {
      await loadOnce();
      if (groups.size >= maxGroups) throw new Error(`group limit reached (${maxGroups})`);
      const at = now();
      const label = normalizeLabel(name) || `分组 ${groups.size}`;
      const id = `g${at.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      return putGroup({
        id, name: label, workspace: '', provider: '', model: '', reasoningEffort: '', preset: '',
        createdAt: at, updatedAt: at,
      });
    },
    async updateGroup(id, patch) {
      await loadOnce();
      const existing = groups.get(id);
      if (!existing) return undefined;
      const name = patch.name === undefined ? existing.name : normalizeLabel(patch.name);
      const next: GroupRecord = {
        ...existing,
        name: name || existing.name,
        ...(patch.workspace !== undefined ? { workspace: patch.workspace.trim() } : {}),
        ...(patch.provider !== undefined ? { provider: patch.provider.trim() } : {}),
        ...(patch.model !== undefined ? { model: patch.model.trim() } : {}),
        ...(patch.reasoningEffort !== undefined ? { reasoningEffort: patch.reasoningEffort.trim() } : {}),
        ...(patch.preset !== undefined ? { preset: patch.preset.trim() } : {}),
        updatedAt: now(),
      };
      return putGroup(next);
    },
    async removeGroup(id) {
      await loadOnce();
      if (id === DEFAULT_GROUP_ID || !groups.has(id)) return { ok: false, removed: 0 };
      let removed = 0;
      for (const [key, record] of [...bindings]) {
        if (record.groupId !== id) continue;
        bindings.delete(key);
        removed++;
      }
      groups.delete(id);
      await persist();
      return { ok: true, removed };
    },
    async create(kind, id, createOptions) {
      await loadOnce();
      const cleanId = id.trim();
      const key = bindingKey(kind, cleanId);
      const groupId = groups.has(createOptions.groupId) ? createOptions.groupId : DEFAULT_GROUP_ID;
      const existing = bindings.get(key);
      const label = normalizeLabel(createOptions.label);
      // A note typed while authorizing is the person's note from now on.
      if (label) await writeLabel(key, label);
      if (existing) {
        // Authorizing an already-known principal just moves it.
        return putBinding({ ...existing, groupId, updatedAt: now() });
      }
      if (bindings.size >= max) {
        if (!dropped) {
          dropped = true;
          report(new Error(`refusing to create more than ${max} members`), 'limit');
        }
        throw new Error(`member limit reached (${max})`);
      }
      const at = now();
      return putBinding({ kind, id: cleanId, groupId, sessionId: '', createdAt: at, updatedAt: at });
    },
    async update(key, patch) {
      await loadOnce();
      const existing = bindings.get(key);
      if (!existing) return undefined;
      const groupId = patch.groupId !== undefined && groups.has(patch.groupId) ? patch.groupId : existing.groupId;
      const next: BindingRecord = {
        ...existing,
        groupId,
        ...(patch.sessionId !== undefined ? { sessionId: patch.sessionId.trim() } : {}),
        updatedAt: now(),
      };
      return putBinding(next);
    },
    async remove(key) {
      await loadOnce();
      const existed = bindings.delete(key);
      if (existed) await persist();
      return existed;
    },
    label: key => labels.get(key) ?? '',
    async setLabel(key, value) {
      await loadOnce();
      return await writeLabel(key, value);
    },
    adminWorkspace: user => adminWorkspaces.get(user) ?? '',
    async setAdminWorkspace(user, path) {
      await loadOnce();
      const clean = path.trim();
      if (clean) adminWorkspaces.set(user, clean);
      else adminWorkspaces.delete(user);
      await persist();
    },
    forSession: sessionId => [...bindings.values()].filter(record => record.sessionId && record.sessionId === sessionId),
    full: () => bindings.size >= max,
    flush: () => chain,
  };
}
