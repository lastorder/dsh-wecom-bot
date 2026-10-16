import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  BINDINGS_VERSION, MAX_BINDINGS, type BindingKind, type BindingRecord,
} from '../shared/protocol.js';

/**
 * Durable routing bindings: one WeCom private chat (identified by its
 * sender's userid) or group chat is bound to one Workspace, one DSH Session
 * and optionally one model.
 *
 * This is runtime state, not Config: the Host creates a binding the first
 * time an accepted sender messages the Bot, which must not rewrite the DSH
 * profile document or reconnect the socket. The file lives next to the
 * journal, under `<DSH home>/wecom-bot/bindings.json`, and every write is
 * serialized and atomic (write-then-rename).
 */

export interface BindingKeyParts {
  readonly chat: string;
  readonly user: string;
  readonly chatType: 'single' | 'group';
}

export interface BindingStore {
  /** Read the file once; safe to call repeatedly and concurrently. */
  load(): Promise<void>;
  list(): readonly BindingRecord[];
  get(key: string): BindingRecord | undefined;
  /** The binding for one incoming message, created empty when it is new. */
  ensure(parts: BindingKeyParts): Promise<BindingRecord>;
  create(kind: BindingKind, id: string): Promise<BindingRecord>;
  update(key: string, patch: BindingPatch): Promise<BindingRecord | undefined>;
  remove(key: string): Promise<boolean>;
  /** Every binding currently pointing at one Session. */
  forSession(sessionId: string): readonly BindingRecord[];
  /** True when no new binding may be created. */
  full(): boolean;
  flush(): Promise<void>;
  /** Absolute path of the backing file. */
  readonly file: string;
}

export interface BindingPatch {
  readonly workspace?: string;
  readonly sessionId?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly reasoningEffort?: string;
  readonly note?: string;
}

export interface BindingStoreOptions {
  readonly directory: string;
  readonly maxEntries?: number;
  now?(): number;
  onError?(error: unknown, stage: string): void;
}

interface StoredFile {
  readonly version?: unknown;
  readonly bindings?: unknown;
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

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** One stored record, or undefined when the entry is unusable. */
function normalizeRecord(value: unknown): BindingRecord | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const kind = record.kind === 'group' ? 'group' : record.kind === 'user' ? 'user' : undefined;
  if (!kind || !validBindingId(record.id)) return undefined;
  const note = text(record.note);
  return {
    kind,
    id: (record.id as string).trim(),
    workspace: text(record.workspace),
    sessionId: text(record.sessionId),
    provider: text(record.provider),
    model: text(record.model),
    reasoningEffort: text(record.reasoningEffort),
    ...(note ? { note } : {}),
    createdAt: Number.isFinite(record.createdAt) ? Number(record.createdAt) : 0,
    updatedAt: Number.isFinite(record.updatedAt) ? Number(record.updatedAt) : 0,
  };
}

export function createBindingStore(options: BindingStoreOptions): BindingStore {
  const file = join(options.directory, 'bindings.json');
  const max = options.maxEntries ?? MAX_BINDINGS;
  const now = options.now ?? Date.now;
  const report = (error: unknown, stage: string) => { try { options.onError?.(error, stage); } catch { /* reporting must never throw */ } };
  const bindings = new Map<string, BindingRecord>();
  let loaded: Promise<void> | undefined;
  let chain: Promise<void> = Promise.resolve();
  let dropped = false;

  function loadOnce(): Promise<void> {
    loaded ??= readFileOnce();
    return loaded;
  }

  async function readFileOnce(): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') report(error, 'read');
      return;
    }
    let parsed: StoredFile;
    try {
      parsed = JSON.parse(raw) as StoredFile;
    } catch (error) {
      report(error, 'parse');
      // Keep the unreadable file instead of silently overwriting it.
      await rename(file, `${file}.corrupt`).catch(cause => report(cause, 'quarantine'));
      return;
    }
    if (Number(parsed.version) !== BINDINGS_VERSION || !Array.isArray(parsed.bindings)) {
      report(new Error(`unsupported bindings file version: ${String(parsed.version)}`), 'version');
      return;
    }
    for (const entry of parsed.bindings) {
      const record = normalizeRecord(entry);
      if (!record) continue;
      const key = bindingKey(record.kind, record.id);
      if (!bindings.has(key)) bindings.set(key, record);
    }
  }

  function persist(): Promise<void> {
    const payload = JSON.stringify({
      version: BINDINGS_VERSION,
      savedAt: new Date(now()).toISOString(),
      bindings: [...bindings.values()],
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

  function put(record: BindingRecord): BindingRecord {
    bindings.set(bindingKey(record.kind, record.id), record);
    void persist();
    return record;
  }

  return {
    file,
    async load() {
      await loadOnce();
    },
    list: () => [...bindings.values()],
    get: key => bindings.get(key),
    async ensure(parts) {
      await loadOnce();
      const key = bindingKeyFor(parts);
      const existing = bindings.get(key);
      if (existing) return existing;
      if (bindings.size >= max) {
        if (!dropped) {
          dropped = true;
          report(new Error(`refusing to create more than ${max} bindings`), 'limit');
        }
        throw new Error(`binding limit reached (${max})`);
      }
      const at = now();
      return put({
        kind: parts.chatType === 'group' ? 'group' : 'user',
        id: parts.chatType === 'group' ? parts.chat : parts.user,
        workspace: '', sessionId: '', provider: '', model: '', reasoningEffort: '',
        createdAt: at, updatedAt: at,
      });
    },
    async create(kind, id) {
      await loadOnce();
      const key = bindingKey(kind, id);
      const existing = bindings.get(key);
      if (existing) return existing;
      if (bindings.size >= max) throw new Error(`binding limit reached (${max})`);
      const at = now();
      return put({
        kind, id, workspace: '', sessionId: '', provider: '', model: '', reasoningEffort: '',
        createdAt: at, updatedAt: at,
      });
    },
    async update(key, patch) {
      await loadOnce();
      const existing = bindings.get(key);
      if (!existing) return undefined;
      const next: BindingRecord = {
        ...existing,
        ...(patch.workspace !== undefined ? { workspace: patch.workspace.trim() } : {}),
        ...(patch.sessionId !== undefined ? { sessionId: patch.sessionId.trim() } : {}),
        ...(patch.provider !== undefined ? { provider: patch.provider.trim() } : {}),
        ...(patch.model !== undefined ? { model: patch.model.trim() } : {}),
        ...(patch.reasoningEffort !== undefined ? { reasoningEffort: patch.reasoningEffort.trim() } : {}),
        ...(patch.note !== undefined ? { note: patch.note.trim() } : {}),
        updatedAt: now(),
      };
      return put(next);
    },
    async remove(key) {
      await loadOnce();
      const existed = bindings.delete(key);
      if (existed) await persist();
      return existed;
    },
    forSession: sessionId => [...bindings.values()].filter(record => record.sessionId && record.sessionId === sessionId),
    full: () => bindings.size >= max,
    flush: () => chain,
  };
}
