import { displayTitle, formatDuration, limitBytes, MAX_NOTICE_BYTES, oneLine, sessionToken, shortId, } from './format.js';
/**
 * Message templates. Untrusted short strings (titles, ids, tool names) go
 * through {@link inline}, which swaps Markdown/HTML metacharacters for
 * look-alikes instead of backslash escapes, so nothing renders as a link,
 * mention or tag. Assistant text keeps its Markdown but loses HTML-like tags.
 */
const INLINE_SWAP = { '*': '＊', '_': '＿', '`': 'ˋ', '[': '［', ']': '］', '<': '‹', '>': '›', '#': '＃' };
export function inline(text, maxBytes = 300) {
    return limitBytes(oneLine(text).replace(/[*_`\[\]<>#]/g, char => INLINE_SWAP[char] ?? char), maxBytes);
}
/** Keep Markdown, but drop anything that could act as a tag or mention. */
export function markdownBody(text, maxBytes) {
    return limitBytes(text.replace(/<(?=[@a-zA-Z\/!])/g, '‹'), maxBytes);
}
export function sessionLabel(title) {
    return `《${inline(displayTitle(title), 120)}》`;
}
/**
 * Appended to every per-Session notice: quoting (reply-to) the message in
 * WeCom, or typing `/use` with this token, jumps straight to that Session —
 * overriding whatever was selected before. See
 * {@link extractSessionPointer} in `format.ts` for the matching parse.
 */
export function quotePointer(sessionId) {
    return `> 引用这条消息，或发送 /use ${sessionToken(sessionId)}，可直接定位到该会话（之后直接发消息即可继续）。`;
}
export const HELP_TEXT = [
    '可用命令：',
    '/sessions — 按工作区列出可操作的会话（带序号）',
    '/use <序号|会话ID前缀> — 选择会话，之后直接发消息即可继续对话',
    '引用（回复）DSH 发来的某条通知，也会把之后的消息定位到那条通知所属的会话',
    '/status — 查看当前选择与待处理请求',
    '/cancel — 停止当前会话正在运行的回合',
    '/answer <验证码> [题目ID] <选项序号或文字> — 回答 DSH 的提问',
    '/approve <验证码>、/deny <验证码> — 单聊审批工具调用（需在插件中开启）',
    '/whoami — 查看你的 userid 与当前会话 ID',
].join('\n');
export function sessionListText(groups, selected, limit = 30) {
    const listing = [];
    const lines = [];
    let truncated = 0;
    for (const group of groups) {
        const rows = [];
        for (const session of group.sessions) {
            if (listing.length >= limit) {
                truncated++;
                continue;
            }
            listing.push(session.sessionId);
            const marks = [session.running ? '运行中' : '', session.sessionId === selected ? '当前' : ''].filter(Boolean);
            rows.push(`  ${listing.length}. ${oneLine(displayTitle(session.title))}${marks.length ? `（${marks.join('·')}）` : ''}  ${shortId(session.sessionId)}`);
        }
        if (rows.length)
            lines.push(`📁 ${oneLine(group.title)}`, ...rows);
    }
    if (!listing.length)
        return { text: '暂无可操作的会话。请在 DSH 中创建会话，或检查插件的 Session 白名单。', listing };
    return {
        text: [`可操作的会话（共 ${listing.length + truncated} 个）：`, ...lines,
            ...(truncated ? [`… 还有 ${truncated} 个未显示`] : []),
            '', '发送 /use <序号> 选择会话。'].join('\n'),
        listing,
    };
}
export function turnCompleteNotice(summary, info) {
    const meta = [
        info.workspace ? `工作区 ${inline(info.workspace, 120)}` : '',
        summary.durationMs !== undefined ? `用时 ${formatDuration(summary.durationMs)}` : '',
        summary.steps ? `${summary.steps} 步` : '',
    ].filter(Boolean).join(' · ');
    const header = summary.reason === 'completed' ? '**DSH 本轮完成**' : `**DSH 本轮结束（${inline(summary.reason, 40)}）**`;
    const body = summary.assistantText
        ? markdownBody(summary.assistantText, MAX_NOTICE_BYTES - 700)
        : '本轮没有可展示的文本回复。';
    return [
        `${header} · ${sessionLabel(info.title)}`,
        ...(meta ? [`> ${meta}`] : []),
        '',
        body,
        '',
        quotePointer(summary.sessionId),
    ].join('\n');
}
export function questionNotice(sessionId, title, questions, nonce, timeoutMs) {
    const single = questions.length === 1;
    const blocks = questions.map((question, index) => {
        const options = (question.options ?? []).map((option, n) => `    ${n + 1}. ${inline(option.label, 200)}${option.description ? ` — ${inline(option.description, 300)}` : ''}`);
        const head = single ? '' : `${index + 1}) [${inline(question.id, 60)}] `;
        return [`${head}${inline(question.question, 600)}${question.multiSelect ? '（可多选）' : ''}`, ...options].join('\n');
    });
    const usage = single
        ? `回复 /answer ${nonce} <选项序号或文字>`
        : `逐题回复 /answer ${nonce} <题目ID> <选项序号或文字>`;
    return [
        `**DSH 等待你的回答** · ${sessionLabel(title)}`,
        '',
        ...blocks,
        '',
        `> ${usage}；${Math.round(timeoutMs / 1000)} 秒内未回答则回到 DSH 页面处理。`,
        quotePointer(sessionId),
    ].join('\n');
}
export function reviewNotice(sessionId, title) {
    return [
        `**DSH 等待审阅** · ${sessionLabel(title)}`,
        '> 这是计划审阅或含详细内容的提问，请到 DSH 页面查看并处理；企业微信不能代为确认。',
        quotePointer(sessionId),
    ].join('\n');
}
export function approvalNotice(sessionId, title, request, nonce, timeoutMs) {
    const reason = request.displayReason?.zh ?? request.displayReason?.en ?? request.reason ?? '';
    const lines = [
        `**DSH 权限请求** · ${sessionLabel(title)}`,
        `> 工具：${inline(request.toolName, 120)}`,
        ...(reason ? [`> 原因：${inline(reason, 600)}`] : []),
    ];
    lines.push(nonce
        ? `\n回复 /approve ${nonce} 允许本次调用，或 /deny ${nonce} 拒绝；${Math.round((timeoutMs ?? 0) / 1000)} 秒后回到 DSH 页面。`
        : '\n请到 DSH 页面审批。');
    lines.push(quotePointer(sessionId));
    return lines.join('\n');
}
export function promptFailedNotice(sessionId, title) {
    return [
        `**DSH 提交失败** · ${sessionLabel(title)}`,
        '> DSH 未接受这条消息，请到 DSH 页面查看详情后重试。',
        quotePointer(sessionId),
    ].join('\n');
}
//# sourceMappingURL=notices.js.map