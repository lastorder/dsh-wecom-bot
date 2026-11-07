import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * What the plugin remembers about each card it sent.
 *
 * WeCom's click callback carries only the button key and the `task_id`, never
 * what the card said. A card that outlives its request — answered elsewhere,
 * timed out, or forgotten by a restart — can therefore only be retired with its
 * old content if the plugin kept that content itself. This is that memory: the
 * readable facts of each card (question, options, Session…), and, once known,
 * how the request ended, so a late tap shows a record instead of a bare
 * 「已失效」. It is bounded in count and age and survives restarts.
 */

export interface CardRow {
  readonly keyname: string;
  readonly value: string;
}

export interface CardClosure {
  /** `answered`, `allowed-once`, `rejected`, or `closed` (nobody here decided: DSH page, timeout). */
  readonly outcome: string;
  /** What was answered, in words. */
  readonly summary?: string;
}

export interface CardMemo {
  readonly kind: 'question' | 'approval';
  /** The verification code the card's `task_id` carries. */
  readonly nonce: string;
  /** The card's subtitle: the question, or the reason of an approval. */
  readonly sub?: string;
  readonly rows: readonly CardRow[];
  readonly toolName?: string;
  readonly at: number;
  readonly closed?: CardClosure;
}

export interface CardMemory {
  remember(taskId: string, memo: CardMemo): void;
  /** Record how a request ended, on every card that announced it. */
  close(nonce: string, closure: CardClosure): void;
  recall(taskId: string): CardMemo | undefined;
  load(): Promise<void>;
  /** Resolves once everything remembered so far is on disk. */
  flush(): Promise<void>;
}

export interface CardMemoryOptions {
  /** Without a file the memory lives for the process only (tests). */
  readonly file?: string;
  readonly maxCards?: number;
  readonly maxAgeMs?: number;
  readonly now?: () => number;
  onError?(error: unknown, stage: 'read' | 'write'): void;
}

const FILE_VERSION = 1;

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/** A memo read back from disk is re-typed, never trusted. */
function revive(value: unknown): CardMemo | undefined {
  if (!record(value) || (value.kind !== 'question' && value.kind !== 'approval')) return undefined;
  if (typeof value.nonce !== 'string' || typeof value.at !== 'number') return undefined;
  const rows = Array.isArray(value.rows)
    ? value.rows.flatMap((row): CardRow[] => record(row) && typeof row.keyname === 'string' && typeof row.value === 'string'
      ? [{ keyname: row.keyname, value: row.value }] : [])
    : [];
  const closed = record(value.closed) && typeof value.closed.outcome === 'string'
    ? { outcome: value.closed.outcome, ...(typeof value.closed.summary === 'string' ? { summary: value.closed.summary } : {}) }
    : undefined;
  return {
    kind: value.kind, nonce: value.nonce, at: value.at, rows,
    ...(typeof value.sub === 'string' ? { sub: value.sub } : {}),
    ...(typeof value.toolName === 'string' ? { toolName: value.toolName } : {}),
    ...(closed ? { closed } : {}),
  };
}

export function createCardMemory(options: CardMemoryOptions = {}): CardMemory {
  const { file } = options;
  const maxCards = options.maxCards ?? 400;
  const maxAgeMs = options.maxAgeMs ?? 30 * 24 * 60 * 60_000;
  const now = options.now ?? Date.now;
  const cards = new Map<string, CardMemo>();
  let loaded: Promise<void> | undefined;
  let chain: Promise<void> = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dirty = false;

  function prune(): void {
    const cutoff = now() - maxAgeMs;
    for (const [id, memo] of cards) if (memo.at < cutoff) cards.delete(id);
    while (cards.size > maxCards) cards.delete(cards.keys().next().value!);
  }

  function write(): Promise<void> {
    if (!file) return chain;
    dirty = false;
    prune();
    const payload = JSON.stringify({ version: FILE_VERSION, cards: [...cards] });
    chain = chain.then(async () => {
      const temporary = `${file}.${process.pid}.tmp`;
      try {
        await mkdir(dirname(file), { recursive: true, mode: 0o700 });
        await writeFile(temporary, `${payload}\n`, { encoding: 'utf8', mode: 0o600 });
        await rename(temporary, file);
      } catch (error) {
        options.onError?.(error, 'write');
      }
    });
    return chain;
  }

  function touch(): void {
    if (!file) return;
    dirty = true;
    // Several cards go out in a burst (every chat of one request): one write.
    if (!timer) timer = setTimeout(() => { timer = undefined; if (dirty) void write(); }, 300);
    timer.unref?.();
  }

  return {
    remember(taskId, memo) {
      cards.delete(taskId);
      cards.set(taskId, memo);
      prune();
      touch();
    },
    close(nonce, closure) {
      let changed = false;
      for (const [id, memo] of cards) {
        if (memo.nonce !== nonce) continue;
        cards.set(id, { ...memo, closed: closure });
        changed = true;
      }
      if (changed) touch();
    },
    recall: taskId => cards.get(taskId),
    load() {
      loaded ??= (async () => {
        if (!file) return;
        try {
          const parsed: unknown = JSON.parse(await readFile(file, 'utf8'));
          if (!record(parsed) || parsed.version !== FILE_VERSION || !Array.isArray(parsed.cards)) return;
          for (const entry of parsed.cards) {
            if (!Array.isArray(entry) || typeof entry[0] !== 'string') continue;
            const memo = revive(entry[1]);
            // What this process already remembers is newer than the file.
            if (memo && !cards.has(entry[0])) cards.set(entry[0], memo);
          }
          prune();
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') options.onError?.(error, 'read');
        }
      })();
      return loaded;
    },
    async flush() {
      if (timer) { clearTimeout(timer); timer = undefined; }
      if (dirty) await write();
      await chain;
    },
  };
}
