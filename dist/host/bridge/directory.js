export function createSessionDirectory(catalogs, policy) {
    function operable(catalog) {
        return catalog.entries
            .filter(entry => policy.sessionListed(entry.sessionId))
            .map(entry => ({
            sessionId: entry.sessionId, title: entry.title, workspace: entry.group.title, groupKey: entry.group.key,
            running: entry.running, pinned: entry.pinned,
        }));
    }
    async function lookup(sessionId) {
        const catalog = await catalogs.load();
        // A Session created after the cached read is "missing", not hidden: refresh once.
        return !catalog.get(sessionId) && catalog.hiddenReason(sessionId) === 'missing'
            ? catalogs.load({ force: true })
            : catalog;
    }
    return {
        async groups() {
            const result = new Map();
            for (const session of operable(await catalogs.load({ force: true }))) {
                const group = result.get(session.groupKey) ?? { title: session.workspace, sessions: [] };
                group.sessions.push(session);
                result.set(session.groupKey, group);
            }
            return [...result.values()];
        },
        async resolve(token, listing) {
            const value = token.trim();
            if (!value)
                return { ok: false, reason: 'not-found' };
            let catalog;
            try {
                catalog = await catalogs.load({ force: true });
            }
            catch {
                return { ok: false, reason: 'unavailable' };
            }
            const sessions = operable(catalog);
            let candidates = [];
            if (/^\d{1,3}$/.test(value) && listing) {
                const id = listing[Number(value) - 1];
                candidates = sessions.filter(session => session.sessionId === id);
            }
            else {
                const exact = sessions.filter(session => session.sessionId === value);
                candidates = exact.length || value.length < 6 ? exact : sessions.filter(session => session.sessionId.startsWith(value));
            }
            if (candidates.length === 1)
                return { ok: true, session: candidates[0] };
            if (candidates.length > 1)
                return { ok: false, reason: 'ambiguous' };
            if (!policy.sessionListed(value) && catalog.get(value))
                return { ok: false, reason: 'forbidden' };
            const hidden = catalog.hiddenReason(value);
            return { ok: false, reason: 'not-found', ...(hidden && hidden !== 'missing' ? { hidden } : {}) };
        },
        async permitted(sessionId) {
            if (!policy.sessionListed(sessionId))
                return false;
            try {
                return Boolean((await lookup(sessionId)).get(sessionId));
            }
            catch {
                return policy.sessionIds.has(sessionId);
            }
        },
        async describe(sessionId) {
            try {
                const catalog = await catalogs.load();
                const entry = catalog.get(sessionId);
                return entry ? { title: entry.title, workspace: entry.group.title } : { title: catalog.titleOf(sessionId) };
            }
            catch {
                return { title: null };
            }
        },
    };
}
//# sourceMappingURL=directory.js.map