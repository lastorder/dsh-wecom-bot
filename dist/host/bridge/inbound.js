import { validIdentifier } from './format.js';
export function parseInbound(frame, botId) {
    if (frame?.cmd !== 'aibot_msg_callback' || !validIdentifier(frame.headers?.req_id, 512))
        return null;
    const body = frame.body;
    if (!body || body.aibotid !== botId || !validIdentifier(body.msgid, 512))
        return null;
    if (typeof body.msgtype !== 'string' || !body.msgtype)
        return null;
    if (body.chattype !== 'single' && body.chattype !== 'group')
        return null;
    const user = body.from?.userid;
    if (!validIdentifier(user))
        return null;
    const chat = body.chattype === 'group' ? body.chatid : user;
    if (!validIdentifier(chat))
        return null;
    const text = body.msgtype === 'text' ? body.text?.content : undefined;
    return {
        frame,
        reqId: frame.headers.req_id,
        msgId: body.msgid,
        chat,
        user,
        chatType: body.chattype,
        msgtype: body.msgtype,
        ...(typeof text === 'string' ? { text } : {}),
    };
}
/** Bounded replay guard for callback `msgid`s. */
export function createReplayGuard(windowMs = 5 * 60 * 1000, maxEntries = 1000) {
    const seen = new Map();
    return {
        /** True the first time an id is seen within the window. */
        first(id, now = Date.now()) {
            for (const [key, time] of seen) {
                if (time > now - windowMs && seen.size <= maxEntries)
                    break;
                seen.delete(key);
            }
            if (seen.has(id))
                return false;
            seen.set(id, now);
            return true;
        },
    };
}
//# sourceMappingURL=inbound.js.map