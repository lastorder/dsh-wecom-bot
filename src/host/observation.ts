import type {
  AccessDecision, ObservedIdentities, ObservedIdentity, RejectionReason,
} from '../shared/protocol.js';

/**
 * Host-lifetime, bounded memory of WeCom identities that messaged the Bot.
 *
 * It stores identifiers, counters and the latest access decision only —
 * never message content. Rejected senders are kept on purpose, so the
 * operator can see who tried and decide whether to allow them. Entries
 * expire after `ttlMs` and the oldest are evicted beyond `maxEntries`.
 */

export interface IdentitySighting {
  readonly chat: string;
  readonly user: string;
  readonly chatType: 'single' | 'group';
  readonly decision: AccessDecision;
  readonly reason?: RejectionReason;
}

export interface EligibleSource { readonly chat: string; readonly user: string }

export interface ObservationStore {
  /** Record one message from a valid Bot callback, accepted or rejected. */
  record(sighting: IdentitySighting): void;
  /** An accepted source may receive automatic notifications when no chat list is configured. */
  markEligible(chat: string, user: string): void;
  eligibleSources(): readonly EligibleSource[];
  snapshot(): ObservedIdentities;
}

export interface ObservationOptions {
  readonly ttlMs?: number;
  readonly maxEntries?: number;
  now?(): number;
}

interface Entry {
  id: string;
  firstSeenAt: number;
  lastSeenAt: number;
  messages: number;
  decision: AccessDecision;
  reason?: RejectionReason;
  chatType?: 'single' | 'group';
  via?: string;
}

export const OBSERVATION_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_OBSERVED = 200;

export function createObservationStore(options: ObservationOptions = {}): ObservationStore {
  const ttl = options.ttlMs ?? OBSERVATION_TTL_MS;
  const max = options.maxEntries ?? MAX_OBSERVED;
  const now = options.now ?? Date.now;
  const users = new Map<string, Entry>();
  const chats = new Map<string, Entry>();
  const eligible = new Map<string, EligibleSource & { time: number }>();

  function prune(at: number): void {
    for (const map of [users, chats]) {
      for (const [id, entry] of map) if (entry.lastSeenAt <= at - ttl) map.delete(id);
    }
    for (const [key, source] of eligible) if (source.time <= at - ttl) eligible.delete(key);
  }

  function touch(map: Map<string, Entry>, id: string, at: number, update: (entry: Entry) => void): void {
    const existing = map.get(id);
    const entry: Entry = existing ?? { id, firstSeenAt: at, lastSeenAt: at, messages: 0, decision: 'accepted' };
    map.delete(id); // re-insert to keep Map order = recency
    entry.lastSeenAt = at;
    entry.messages++;
    update(entry);
    map.set(id, entry);
    if (map.size > max) map.delete(map.keys().next().value!);
  }

  function freeze(entry: Entry): ObservedIdentity {
    return Object.freeze({
      id: entry.id, firstSeenAt: entry.firstSeenAt, lastSeenAt: entry.lastSeenAt,
      messages: entry.messages, decision: entry.decision,
      ...(entry.reason ? { reason: entry.reason } : {}),
      ...(entry.chatType ? { chatType: entry.chatType } : {}),
      ...(entry.via ? { via: entry.via } : {}),
    });
  }

  return {
    record(sighting) {
      const at = now();
      prune(at);
      const apply = (entry: Entry) => {
        entry.decision = sighting.decision;
        if (sighting.reason) entry.reason = sighting.reason; else delete entry.reason;
      };
      touch(users, sighting.user, at, entry => { apply(entry); entry.via = sighting.chat; });
      touch(chats, sighting.chat, at, entry => {
        apply(entry);
        entry.chatType = sighting.chatType;
        if (sighting.chatType === 'group') entry.via = sighting.user; else delete entry.via;
      });
    },
    markEligible(chat, user) {
      const key = `${chat}\0${user}`;
      eligible.delete(key);
      eligible.set(key, { chat, user, time: now() });
      if (eligible.size > max) eligible.delete(eligible.keys().next().value!);
    },
    eligibleSources() {
      prune(now());
      return [...eligible.values()].map(({ chat, user }) => ({ chat, user }));
    },
    snapshot() {
      prune(now());
      return Object.freeze({
        users: Object.freeze([...users.values()].reverse().map(freeze)),
        chats: Object.freeze([...chats.values()].reverse().map(freeze)),
      });
    },
  };
}
