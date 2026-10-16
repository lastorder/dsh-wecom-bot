import { limitBytes, MAX_NOTICE_BYTES } from './format.js';
export function ackSummary(frame) {
    if (!frame || typeof frame !== 'object')
        return undefined;
    const value = frame;
    return {
        ...(value.errcode !== undefined ? { errcode: value.errcode } : {}),
        ...(value.errmsg !== undefined ? { errmsg: value.errmsg } : {}),
        ...(value.headers?.req_id !== undefined ? { reqId: value.headers.req_id } : {}),
    };
}
export function createOutbox(options) {
    const { client, journal, log, status } = options;
    const maxQueue = options.maxQueue ?? 100;
    const queue = [];
    let online = false;
    let sending = false;
    let closed = false;
    async function drain() {
        if (sending || !online || closed)
            return;
        sending = true;
        try {
            while (online && !closed && queue.length) {
                const notice = queue.shift();
                const body = { msgtype: 'markdown', markdown: { content: notice.text } };
                const started = Date.now();
                const meta = {
                    chatId: notice.chat, kind: notice.kind,
                    ...(notice.sessionId ? { sessionId: notice.sessionId } : {}),
                    ...(notice.roundIds?.length ? { roundIds: notice.roundIds } : {}),
                };
                try {
                    const ack = await client.sendMessage(notice.chat, body);
                    status.count('notifications');
                    journal.write({ event: 'wecom.send', ...meta, request: { chatid: notice.chat, body }, response: ackSummary(ack), durationMs: Date.now() - started });
                }
                catch (error) {
                    status.count('failures');
                    // SDK errors may echo the socket URL: keep them out of the DSH log.
                    log.warn('WeCom notification send failed');
                    journal.write({ event: 'wecom.send', level: 'warn', ...meta, request: { chatid: notice.chat, body }, error, durationMs: Date.now() - started });
                }
            }
        }
        finally {
            sending = false;
        }
    }
    return {
        enqueue(notice) {
            if (closed)
                return;
            if (queue.length >= maxQueue) {
                const dropped = queue.shift();
                log.warn('WeCom notification queue full; dropping the oldest notification');
                journal.write({ event: 'wecom.send.dropped', level: 'warn', chatId: dropped.chat, kind: dropped.kind });
            }
            queue.push({ ...notice, text: limitBytes(notice.text, MAX_NOTICE_BYTES) });
            void drain();
        },
        setOnline(next) {
            online = next;
            if (next)
                void drain();
        },
        clear() {
            closed = true;
            queue.length = 0;
        },
        size: () => queue.length,
    };
}
//# sourceMappingURL=outbox.js.map