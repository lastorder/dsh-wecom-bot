/** Text helpers shared by bridge replies and notifications. */
const encoder = new TextEncoder();
export const MAX_INBOUND_BYTES = 6000;
export const MAX_NOTICE_BYTES = 3500;
export const MAX_REPLY_BYTES = 4000;
export function byteLength(text) {
    return encoder.encode(text).length;
}
/** Longest prefix within `maxBytes` UTF-8 bytes, never splitting a code point. */
export function limitBytes(text, maxBytes) {
    if (byteLength(text) <= maxBytes)
        return text;
    const marker = '…';
    const budget = Math.max(0, maxBytes - byteLength(marker));
    let used = 0;
    let result = '';
    for (const char of text) {
        const size = byteLength(char);
        if (used + size > budget)
            break;
        used += size;
        result += char;
    }
    return result + marker;
}
/** Escape Markdown so untrusted text renders literally in WeCom. */
export function escapeMarkdown(text) {
    return text.replace(/[\\`*_{}\[\]()#+.!>|~-]/g, '\\$&');
}
/** A Markdown-safe, length-bounded fragment of untrusted text. */
export function plain(text, maxBytes = MAX_NOTICE_BYTES) {
    return limitBytes(escapeMarkdown(text), maxBytes);
}
export function oneLine(text) {
    return text.replace(/[\r\n]+/g, ' ').trim();
}
export function shortId(id) {
    return id.length > 13 ? `${id.slice(0, 8)}…` : id;
}
export const UNTITLED_SESSION = '未命名会话';
export function displayTitle(title) {
    return title?.trim() ? oneLine(title) : UNTITLED_SESSION;
}
/** Bounded identifier without control characters, as WeCom IDs are. */
export function validIdentifier(value, maxBytes = 256) {
    return typeof value === 'string' && Boolean(value.trim())
        && byteLength(value) <= maxBytes && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
}
export function formatDuration(ms) {
    if (ms === undefined || !Number.isFinite(ms) || ms < 0)
        return '';
    const seconds = Math.round(ms / 1000);
    if (seconds < 60)
        return `${seconds} 秒`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60)
        return `${minutes} 分 ${seconds % 60} 秒`;
    return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
}
//# sourceMappingURL=format.js.map