import type { ApprovalRequest, Question } from '../dsh.js';
import type { TurnSummary } from '../turns.js';
import type { OperableGroup } from './directory.js';
import {
  displayTitle, formatDuration, limitBytes, MAX_NOTICE_BYTES, oneLine, sessionToken, shortId,
} from './format.js';

/**
 * Message templates.
 *
 * Untrusted short strings (titles, ids, tool names) go through {@link inline},
 * which swaps Markdown/HTML metacharacters for look-alikes instead of
 * backslash escapes, so nothing renders as a link, mention or tag. Assistant
 * text keeps its Markdown but loses HTML-like tags.
 *
 * Every notice and every command reply uses the same flat shape, so one chat
 * stays scannable:
 *
 *   **🏷 标题** · 《会话》        what happened, and to which Session
 *   > 上下文 / 操作提示            one line of grey context
 *
 *   - **字段**：值                 details, one per line
 *
 *   > 引用这条消息即可回到该会话
 *
 * Enterprise WeChat renders a Markdown subset (bold, inline code and quotes);
 * tables and nested lists come out as raw text, so nothing here is tabular or
 * nested — and every line still reads correctly if the styling is dropped.
 */

const INLINE_SWAP: Record<string, string> = { '*': '＊', '_': '＿', '`': 'ˋ', '[': '［', ']': '］', '<': '‹', '>': '›', '#': '＃' };

export function inline(text: string, maxBytes = 300): string {
  return limitBytes(oneLine(text).replace(/[*_`\[\]<>#]/g, char => INLINE_SWAP[char] ?? char), maxBytes);
}

/** Keep Markdown, but drop anything that could act as a tag or mention. */
export function markdownBody(text: string, maxBytes: number): string {
  return limitBytes(text.replace(/<(?=[@a-zA-Z\/!])/g, '‹'), maxBytes);
}

/** Bold text. Only ever called with the templates' own literals. */
export function bold(text: string): string {
  return `**${text}**`;
}

/** Inline code, for ids and commands the reader may want to copy verbatim. */
export function code(text: string): string {
  return `\`${text}\``;
}

/** `**🏷 标题**` — the first line of a notice or of a long command reply. */
export function title(emoji: string, text: string): string {
  return bold(`${emoji} ${text}`);
}

/** `**标签**：值` — one labelled detail line. */
export function field(label: string, value: string): string {
  return `${bold(label)}：${value}`;
}

export function sessionLabel(title: string | null | undefined): string {
  return `《${inline(displayTitle(title), 120)}》`;
}

/** `《标题》 · session-abc123…` — a Session named and identified in one line. */
export function sessionRef(title: string | null | undefined, sessionId: string): string {
  return `${sessionLabel(title)} · ${code(shortId(sessionId))}`;
}

/**
 * Appended to every per-Session notice: quoting (reply-to) the message in
 * WeCom, or typing `/use` with this token, jumps straight to that Session —
 * overriding whatever was selected before. See
 * {@link extractSessionPointer} in `format.ts` for the matching parse: the
 * token stays outside any inline-code span so the parser always sees it.
 */
export function quotePointer(sessionId: string): string {
  return `> 引用（回复）这条消息，或发送 /use ${sessionToken(sessionId)}，之后直接发消息即可继续这个会话。`;
}

export const HELP_TEXT = [
  title('📖', '企业微信 · DSH 机器人'),
  '',
  '直接把消息发给我，就会进入你的专属 DSH 会话；本轮结束后，我会把结果发回这里。',
  '',
  bold('💬 常用命令'),
  '- **/status** — 查看当前会话、分组、Workspace 与模型',
  '- **/whoami** — 查看你的 userid、所属分组与管理员身份',
  '- **/new** — 换一个全新的专属会话（旧会话仍保留在 DSH 中）',
  '- **/cancel** — 停止你的会话正在运行的回合',
  `- **/answer** — 回答 DSH 的提问：${code('/answer 验证码 选项序号或文字')}`,
  `- **/approve** — 允许本次工具调用：${code('/approve 验证码')}（需开启远程审批）`,
  `- **/deny** — 拒绝本次工具调用：${code('/deny 验证码')}`,
  '- **/help** — 显示这份说明',
  '',
  bold('🔗 引用定位'),
  '引用（回复）我发出的某条通知，之后的消息就会继续那条通知所属的会话。',
  '',
  bold('🔒 管理员命令'),
  '只有插件配置中列出的管理员可用：',
  '- **/sessions** — 按 Workspace 列出可切换的会话',
  `- **/use** — 切换要操作的会话：${code('/use 序号')} 或 ${code('/use 会话ID前缀')}`,
  '- **/reset** — 放弃切换，回到自己的专属会话',
].join('\n');

export function adminOnlyText(): string {
  return [
    title('🔒', '需要管理员权限'),
    '',
    '只有插件配置里列出的管理员可以切换会话。你的消息始终路由到自己的专属会话；如需新的会话请发送 **/new**。',
  ].join('\n');
}

export function sessionListText(groups: readonly OperableGroup[], selected: string | undefined, limit = 30): { text: string; listing: string[] } {
  const listing: string[] = [];
  const blocks: string[] = [];
  let truncated = 0;
  for (const group of groups) {
    const rows: string[] = [];
    for (const session of group.sessions) {
      if (listing.length >= limit) { truncated++; continue; }
      listing.push(session.sessionId);
      const marks = [session.running ? '运行中' : '', session.sessionId === selected ? '当前' : ''].filter(Boolean);
      rows.push(`${listing.length}. ${inline(displayTitle(session.title), 60)} · ${shortId(session.sessionId)}${marks.length ? `（${marks.join(' · ')}）` : ''}`);
    }
    if (rows.length) blocks.push([bold(`📁 ${inline(group.title, 60)}`), ...rows].join('\n'));
  }
  if (!listing.length) {
    return {
      text: [
        title('🗂', '可切换的会话'),
        '',
        '没有找到可切换的会话。请在 DSH 中创建会话，或检查管理员的 Workspace 范围。',
      ].join('\n'),
      listing,
    };
  }
  return {
    text: [
      `${title('🗂', '可切换的会话')} · 共 ${listing.length + truncated} 个`,
      '',
      blocks.join('\n\n'),
      '',
      ...(truncated ? [`… 另有 ${truncated} 个未显示`, ''] : []),
      `发送 ${code('/use 序号')} 切换会话；发送 ${code('/reset')} 回到自己的专属会话。`,
    ].join('\n'),
    listing,
  };
}

export function turnCompleteNotice(summary: TurnSummary, info: { readonly title: string | null; readonly workspace?: string }): string {
  const meta = [
    info.workspace ? `Workspace ${inline(info.workspace, 120)}` : '',
    summary.durationMs !== undefined ? `用时 ${formatDuration(summary.durationMs)}` : '',
    summary.steps ? `${summary.steps} 步` : '',
  ].filter(Boolean).join(' · ');
  const header = summary.reason === 'completed'
    ? `${title('✅', 'DSH 本轮完成')} · ${sessionLabel(info.title)}`
    : `${title('⚠️', `DSH 本轮结束（${inline(summary.reason, 40)}）`)} · ${sessionLabel(info.title)}`;
  const body = summary.assistantText
    ? markdownBody(summary.assistantText, MAX_NOTICE_BYTES - 700)
    : '本轮没有可展示的文本回复。';
  return [
    header,
    ...(meta ? [`> ${meta}`] : []),
    '',
    body,
    '',
    quotePointer(summary.sessionId),
  ].join('\n');
}

export function questionNotice(sessionId: string, sessionTitle: string | null, questions: readonly Question[], nonce: string, timeoutMs: number): string {
  const single = questions.length === 1;
  const blocks = questions.map((question, index) => {
    const options = (question.options ?? []).map((option, n) =>
      `   ${n + 1}. ${inline(option.label, 200)}${option.description ? ` — ${inline(option.description, 300)}` : ''}`);
    const head = single ? '' : `${index + 1}. `;
    return [`${head}${inline(question.question, 600)}${question.multiSelect ? '（可多选）' : ''}`, ...options].join('\n');
  });
  const usage = single
    ? `回复 /answer ${nonce} 选项序号或文字`
    : `逐题回复 /answer ${nonce} 题目ID 选项序号或文字`;
  return [
    `${title('❓', 'DSH 等待你的回答')} · ${sessionLabel(sessionTitle)}`,
    '',
    blocks.join('\n\n'),
    '',
    `> ${usage}；${Math.round(timeoutMs / 1000)} 秒内未回答则回到 DSH 页面处理。`,
    quotePointer(sessionId),
  ].join('\n');
}

export function reviewNotice(sessionId: string, sessionTitle: string | null): string {
  return [
    `${title('👀', 'DSH 等待审阅')} · ${sessionLabel(sessionTitle)}`,
    '> 这是计划审阅或含详细内容的提问，请到 DSH 页面查看并处理；企业微信不能代为确认。',
    quotePointer(sessionId),
  ].join('\n');
}

export function approvalNotice(sessionId: string, sessionTitle: string | null, request: ApprovalRequest, nonce?: string, timeoutMs?: number): string {
  const reason = request.displayReason?.zh ?? request.displayReason?.en ?? request.reason ?? '';
  const lines = [
    `${title('🔐', 'DSH 权限请求')} · ${sessionLabel(sessionTitle)}`,
    '',
    `- ${field('工具', code(inline(request.toolName, 120)))}`,
    ...(reason ? [`- ${field('原因', inline(reason, 600))}`] : []),
  ];
  lines.push('');
  lines.push(nonce
    ? `回复 /approve ${nonce} 允许本次调用，或 /deny ${nonce} 拒绝；${Math.round((timeoutMs ?? 0) / 1000)} 秒后回到 DSH 页面。`
    : '请到 DSH 页面审批。');
  lines.push('', quotePointer(sessionId));
  return lines.join('\n');
}

export function promptFailedNotice(sessionId: string, sessionTitle: string | null): string {
  return [
    `${title('⚠️', 'DSH 提交失败')} · ${sessionLabel(sessionTitle)}`,
    '> DSH 未接受这条消息，请到 DSH 页面查看详情后重试。',
    quotePointer(sessionId),
  ].join('\n');
}
