import { randomUUID } from 'node:crypto';
export function createRoundTracker(options) {
    const { journal } = options;
    const now = options.now ?? Date.now;
    const ttl = options.ttlMs ?? 24 * 60 * 60 * 1000;
    const maxPending = options.maxPending ?? 500;
    const byRequest = new Map();
    function emit(round, outcome, extra = {}) {
        if (round.done)
            return;
        round.done = true;
        if (round.requestId)
            byRequest.delete(round.requestId);
        const completedAt = now();
        const { response, metadata, ...rest } = extra;
        journal.write({
            event: 'round.complete',
            level: outcome === 'prompt-failed' || outcome === 'expired' ? 'warn' : 'info',
            roundId: round.id,
            outcome,
            chatId: round.init.chatId,
            userId: round.init.userId,
            chatType: round.init.chatType,
            msgId: round.init.msgId,
            ...(round.sessionId ? { sessionId: round.sessionId } : {}),
            ...(round.sessionTitle !== undefined ? { sessionTitle: round.sessionTitle } : {}),
            ...(round.workspace ? { workspace: round.workspace } : {}),
            ...(round.requestId ? { requestId: round.requestId } : {}),
            request: {
                msgtype: round.init.msgtype,
                ...(round.init.text !== undefined ? { text: round.init.text } : {}),
                ...(round.command ? { command: round.command } : {}),
            },
            response: { replies: round.replies, ...response },
            ...(metadata ? { metadata } : {}),
            timing: {
                receivedAt: new Date(round.receivedAt).toISOString(),
                ...(round.submittedAt ? { submittedAt: new Date(round.submittedAt).toISOString() } : {}),
                completedAt: new Date(completedAt).toISOString(),
                totalMs: completedAt - round.receivedAt,
            },
            ...rest,
        });
    }
    function expire() {
        const cutoff = now() - ttl;
        for (const round of [...byRequest.values()]) {
            if ((round.submittedAt ?? round.receivedAt) <= cutoff)
                emit(round, 'expired');
        }
        while (byRequest.size > maxPending)
            emit(byRequest.values().next().value, 'expired');
    }
    return {
        begin(init) {
            return { id: randomUUID(), init, receivedAt: now(), replies: [], done: false };
        },
        reply(round, text) {
            if (!round.done)
                round.replies.push(text);
        },
        complete(round, outcome, extra) {
            emit(round, outcome, extra);
        },
        awaitTurn(round, requestId) {
            if (round.done)
                return;
            round.requestId = requestId;
            round.submittedAt = now();
            byRequest.set(requestId, round);
            expire();
        },
        onTurnEnd(summary, notifiedChats = []) {
            const finished = [];
            for (const requestId of summary.promptIds) {
                const round = byRequest.get(requestId);
                if (!round || round.sessionId !== summary.sessionId)
                    continue;
                emit(round, 'turn-ended', {
                    response: {
                        reason: summary.reason,
                        assistant: summary.assistantText,
                        notifiedChats,
                    },
                    metadata: {
                        turn: summary.turn,
                        model: summary.model,
                        steps: summary.steps,
                        toolCalls: summary.toolCalls,
                        omittedBlocks: summary.omittedBlocks,
                        turnDurationMs: summary.durationMs,
                    },
                });
                finished.push(round);
            }
            expire();
            return finished;
        },
        hasPending(sessionId) {
            for (const round of byRequest.values())
                if (round.sessionId === sessionId)
                    return true;
            return false;
        },
        pending: () => byRequest.size,
        closeAll(outcome) {
            for (const round of [...byRequest.values()])
                emit(round, outcome);
        },
    };
}
//# sourceMappingURL=rounds.js.map