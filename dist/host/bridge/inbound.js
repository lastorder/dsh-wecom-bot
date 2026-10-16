import { validIdentifier } from './format.js';
/** WeCom quotes carry the quoted content, not its id — flatten whatever text
 * it holds (text, or the text items of a mixed message) so the bridge can
 * look for its own `/use <token>` hint inside it. */
function flattenQuote(quote) {
    if (!quote || typeof quote !== 'object')
        return undefined;
    const q = quote;
    if (q.msgtype === 'text' && typeof q.text?.content === 'string')
        return q.text.content;
    if (q.msgtype === 'mixed' && Array.isArray(q.mixed?.msg_item)) {
        const texts = q.mixed.msg_item
            .map(item => item)
            .filter(item => item?.msgtype === 'text' && typeof item.text?.content === 'string')
            .map(item => item.text.content);
        return texts.length ? texts.join('\n') : undefined;
    }
    return undefined;
}
// A group message is only ever delivered to this Bot when it was @-mentioned
// (WeCom never forwards a group message otherwise), and WeCom leaves that
// mention as literal "@DisplayName " text wherever the sender's cursor was —
// most people mention the Bot first, then type. One or more such tokens at
// the very start are addressing, not content: stripped so a command typed
// right after "@Bot" still parses, and so DSH is not handed stray "@Bot "
// text as if the sender had written it. A mid-message mention is left
// alone — it was clearly meant as part of what was said.
const LEADING_MENTIONS_RE = /^(?:@\S+\s*)+/;
function stripLeadingMentions(text) {
    return text.replace(LEADING_MENTIONS_RE, '');
}
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
    const rawText = body.msgtype === 'text' ? body.text?.content : undefined;
    const text = typeof rawText === 'string' && body.chattype === 'group' ? stripLeadingMentions(rawText) : rawText;
    const quotedText = flattenQuote(body.quote);
    return {
        frame,
        reqId: frame.headers.req_id,
        msgId: body.msgid,
        chat,
        user,
        chatType: body.chattype,
        msgtype: body.msgtype,
        ...(typeof text === 'string' ? { text } : {}),
        ...(quotedText !== undefined ? { quotedText } : {}),
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