export const OBSERVATION_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_OBSERVED = 200;
export function createObservationStore(options = {}) {
    const ttl = options.ttlMs ?? OBSERVATION_TTL_MS;
    const max = options.maxEntries ?? MAX_OBSERVED;
    const now = options.now ?? Date.now;
    const users = new Map();
    const chats = new Map();
    const eligible = new Map();
    function prune(at) {
        for (const map of [users, chats]) {
            for (const [id, entry] of map)
                if (entry.lastSeenAt <= at - ttl)
                    map.delete(id);
        }
        for (const [key, source] of eligible)
            if (source.time <= at - ttl)
                eligible.delete(key);
    }
    function touch(map, id, at, update) {
        const existing = map.get(id);
        const entry = existing ?? { id, firstSeenAt: at, lastSeenAt: at, messages: 0, decision: 'accepted' };
        map.delete(id); // re-insert to keep Map order = recency
        entry.lastSeenAt = at;
        entry.messages++;
        update(entry);
        map.set(id, entry);
        if (map.size > max)
            map.delete(map.keys().next().value);
    }
    function freeze(entry) {
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
            const apply = (entry) => {
                entry.decision = sighting.decision;
                if (sighting.reason)
                    entry.reason = sighting.reason;
                else
                    delete entry.reason;
            };
            touch(users, sighting.user, at, entry => { apply(entry); entry.via = sighting.chat; });
            touch(chats, sighting.chat, at, entry => {
                apply(entry);
                entry.chatType = sighting.chatType;
                if (sighting.chatType === 'group')
                    entry.via = sighting.user;
                else
                    delete entry.via;
            });
        },
        markEligible(chat, user) {
            const key = `${chat}\0${user}`;
            eligible.delete(key);
            eligible.set(key, { chat, user, time: now() });
            if (eligible.size > max)
                eligible.delete(eligible.keys().next().value);
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
//# sourceMappingURL=observation.js.map