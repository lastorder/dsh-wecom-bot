function textOf(content) {
    return (content ?? [])
        .filter(block => block.type === 'text' && typeof block.text === 'string')
        .map(block => block.text)
        .join('\n')
        .trim();
}
/** Walk back from the end of the log to this turn's `turn/start`. */
export function summarizeTurn(session, end) {
    const events = session.snapshotEvents();
    const turn = end.data?.turn;
    let assistantText = '';
    let finalFound = false;
    const omittedBlocks = {};
    const toolCalls = {};
    const promptIds = [];
    let steps = 0;
    let startedAt;
    let model;
    for (let index = events.length - 1; index >= 0; index--) {
        const event = events[index];
        if (event === end || event.type === 'turn/end')
            continue;
        if (event.type === 'turn/start') {
            if (turn === undefined || event.data?.turn === turn) {
                startedAt = event.time;
                break;
            }
            continue;
        }
        if (turn !== undefined && typeof event.data?.turn === 'number' && event.data.turn !== turn)
            continue;
        switch (event.type) {
            case 'assistant/message': {
                if (finalFound)
                    break;
                const content = event.data?.message?.content;
                const text = textOf(content);
                if (!text)
                    break;
                finalFound = true;
                assistantText = text;
                for (const block of content ?? []) {
                    if (block.type !== 'text')
                        omittedBlocks[block.type] = (omittedBlocks[block.type] ?? 0) + 1;
                }
                break;
            }
            case 'step/start':
                steps++;
                break;
            case 'tool/call': {
                const name = typeof event.data?.name === 'string' ? event.data.name : 'unknown';
                toolCalls[name] = (toolCalls[name] ?? 0) + 1;
                break;
            }
            case 'user/message': {
                const source = event.data?.source;
                if (source?.kind === 'user' && typeof source.rpcId === 'string')
                    promptIds.push(source.rpcId);
                break;
            }
            case 'request/header': {
                const config = event.data?.header?.config;
                if (config && !model)
                    model = { provider: config.provider, model: config.model, reasoningEffort: config.reasoningEffort };
                break;
            }
            default:
                break;
        }
    }
    const endedAt = end.time;
    return {
        sessionId: session.id,
        ...(turn === undefined ? {} : { turn }),
        reason: end.data?.reason?.kind ?? 'unknown',
        ...(startedAt === undefined ? {} : { startedAt }),
        ...(endedAt === undefined ? {} : { endedAt }),
        ...(startedAt !== undefined && endedAt !== undefined ? { durationMs: endedAt - startedAt } : {}),
        ...(model ? { model } : {}),
        steps,
        toolCalls,
        assistantText,
        omittedBlocks,
        promptIds: promptIds.reverse(),
    };
}
//# sourceMappingURL=turns.js.map