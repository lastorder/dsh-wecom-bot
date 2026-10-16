export function createStatusTracker(journal, now = Date.now) {
    let status = { phase: 'unconfigured', since: now() };
    const counters = { received: 0, rejected: 0, prompts: 0, notifications: 0, failures: 0 };
    const since = now();
    let lastMessageAt;
    return {
        set(phase, detail) {
            if (status.phase === phase && status.detail === detail)
                return;
            const previous = status.phase;
            status = { phase, since: now(), ...(detail ? { detail } : {}) };
            journal.write({
                event: 'connection.phase',
                level: phase === 'error' || phase === 'displaced' || phase === 'invalid' ? 'warn' : 'info',
                phase, previous, ...(detail ? { detail } : {}),
            });
        },
        connection: () => status,
        count(counter, at = now()) {
            counters[counter]++;
            if (counter === 'received')
                lastMessageAt = at;
        },
        traffic: () => ({ since, ...counters, ...(lastMessageAt ? { lastMessageAt } : {}) }),
    };
}
//# sourceMappingURL=status.js.map