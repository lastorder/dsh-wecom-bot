import test from 'node:test';
import assert from 'node:assert/strict';
import { byteLength, extractSessionPointer, MAX_NOTICE_BYTES, MAX_REPLY_BYTES } from '../dist/host/bridge/format.js';
import {
  adminGrantedNotice, adminOnlyText, adminPrivateOnlyText, adminSelectionHintText, adminSettledCards, adminUnassignedText,
  approvalNotice, approvalWaitingNotice, authorizedNotice, compactedText, currentSessionText,
  deleteWarningText, deletedText, groupAssignedNotice, groupSessionRefusalText, HELP_TEXT, newSessionText,
  nothingToCompactText, pickerSummaryText, promptFailedNotice, questionNotice, quotePointer, retiredCommandText, reviewNotice,
  sessionPickerCard, sessionPickerText, sessionSwitchedText, questionAccessRefusalText, routingChangedText,
  turnCompleteNotice, unauthorizedText, workspacePickerCard, workspacePickerText,
} from '../dist/host/bridge/notices.js';

/**
 * The WeCom-facing copy is Markdown-rendered: these tests pin the *shape* of
 * every template (one header, flat lines, no tables) and the two things that
 * silently break if the copy is edited carelessly — a template exceeding the
 * reply budget, and a locator code that no longer parses back to its Session.
 */

const group = (title, sessions) => ({ title, sessions: sessions.map(session => ({
  workspace: title, workspacePath: `/w/${title}`, groupKey: title, running: false, pinned: false, title: null, ...session,
})) });

const groups = [
  group('企业微信', [{ sessionId: 'session-9f3a1c7b2d4e', title: '修复登录 Bug' }]),
  group('dsh-workpet', [{ sessionId: 'session-77aa88bb99cc', running: true }]),
];

const summary = (overrides = {}) => ({
  sessionId: 'session-9f3a1c7b2d4e', reason: 'completed', steps: 3, toolCalls: {}, omittedBlocks: {},
  promptIds: [], assistantText: '改好了。', ...overrides,
});

test('every template fits the reply budget', () => {
  const long = '很长的助手回复。'.repeat(2000);
  const manyWorkspaces = Array.from({ length: 40 }, (_, index) => ({
    id: `w${index}`, path: `/Users/me/workspace-${index}`, title: `Workspace ${index}`,
    pluginOwned: false, sessionCount: index, archivedSessionCount: 0,
  }));
  const manySessions = [group('企业微信', Array.from({ length: 40 }, (_, index) => ({
    sessionId: `session-${String(index).padStart(4, '0')}aaaaaa`, title: `任务 ${index}`,
  })))];
  const texts = [
    HELP_TEXT,
    adminOnlyText(),
    adminPrivateOnlyText(),
    groupSessionRefusalText('delete'),
    groupSessionRefusalText('compact'),
    unauthorizedText(),
    authorizedNotice('默认分组'),
    groupAssignedNotice('朋友'),
    adminGrantedNotice(),
    adminUnassignedText(),
    retiredCommandText(),
    adminSelectionHintText('unreadable'),
    adminSelectionHintText('none'),
    adminSelectionHintText('many'),
    currentSessionText(undefined, undefined),
    currentSessionText({ title: '修复登录 Bug', workspace: '企业微信', model: { provider: 'p', model: 'm' }, context: { used: 12_300, window: 128_000 } }, 'session-9f3a1c7b2d4e'),
    sessionSwitchedText('修复登录 Bug', '企业微信', 'session-9f3a1c7b2d4e'),
    routingChangedText(),
    questionAccessRefusalText(),
    deleteWarningText('修复登录 Bug', 'session-9f3a1c7b2d4e'),
    deletedText(),
    nothingToCompactText(),
    newSessionText('企业微信', 'session-9f3a1c7b2d4e'),
    workspacePickerText('new', manyWorkspaces, '/Users/me/workspace-3'),
    workspacePickerText('session', manyWorkspaces, ''),
    sessionPickerText(groups, 'session-9f3a1c7b2d4e').text,
    sessionPickerText(manySessions, undefined).text,
    turnCompleteNotice(summary({ assistantText: long }), { title: '修复登录 Bug', workspace: '企业微信' }),
    questionNotice('session-9f3a1c7b2d4e', '修复登录 Bug', [
      { id: 'q1', question: '问题一'.repeat(200), options: [{ label: '选项'.repeat(100), description: '说明'.repeat(200) }] },
      { id: 'q2', question: '问题二', multiSelect: true, options: [{ label: 'a' }] },
    ], 'a1b2c3', 60000),
    reviewNotice('session-9f3a1c7b2d4e', '修复登录 Bug'),
    approvalNotice('session-9f3a1c7b2d4e', '修复登录 Bug', { toolName: 'bash', reason: 'x'.repeat(2000) }, 'a1b2c3', 60000),
    approvalWaitingNotice('修复登录 Bug', { toolName: 'bash', reason: 'x'.repeat(2000) }),
    promptFailedNotice('session-9f3a1c7b2d4e', '修复登录 Bug'),
  ];
  for (const text of texts) {
    assert.ok(byteLength(text) <= MAX_NOTICE_BYTES, `notice within ${MAX_NOTICE_BYTES} bytes: ${text.slice(0, 60)}…`);
  }
});

test('every per-Session notice carries a locator code that resolves back to it', () => {
  const notices = [
    turnCompleteNotice(summary(), { title: '修复登录 Bug', workspace: '企业微信' }),
    questionNotice('session-9f3a1c7b2d4e', '修复登录 Bug', [{ id: 'q', question: 'Q?' }], 'a1b2c3', 60000),
    reviewNotice('session-9f3a1c7b2d4e', '修复登录 Bug'),
    approvalNotice('session-9f3a1c7b2d4e', '修复登录 Bug', { toolName: 'bash' }, 'a1b2c3', 60000),
    promptFailedNotice('session-9f3a1c7b2d4e', '修复登录 Bug'),
  ];
  for (const text of notices) {
    const token = extractSessionPointer(text);
    assert.ok(token, 'the notice carries a locator code');
    assert.ok('session-9f3a1c7b2d4e'.startsWith(token), `the locator is a prefix of the Session id: ${token}`);
    assert.match(text, /定位码/);
    assert.doesNotMatch(text, /\/use/);
  }
});

test('a locator is the only pointer the quote parser can pick up', () => {
  // The footers of /session must never read like a jump hint, or quoting a
  // list would silently switch the administrator.
  const listing = sessionPickerText(groups, undefined);
  assert.deepEqual(listing.sessions.map(session => session.sessionId), ['session-9f3a1c7b2d4e', 'session-77aa88bb99cc']);
  assert.equal(extractSessionPointer(listing.text), undefined);
  for (const text of [
    HELP_TEXT, adminOnlyText(), adminPrivateOnlyText(), approvalWaitingNotice('修复登录 Bug', { toolName: 'bash' }), unauthorizedText(),
    authorizedNotice('默认分组'), groupAssignedNotice('朋友'), adminGrantedNotice(), adminUnassignedText(), routingChangedText(),
    questionAccessRefusalText(), retiredCommandText(), workspacePickerText('new', [], ''),
  ]) {
    assert.equal(extractSessionPointer(text), undefined);
  }
  // A group refusal names the command in inline code — `/delete`, never `/use`.
  assert.equal(extractSessionPointer(groupSessionRefusalText('delete')), undefined);
  assert.doesNotMatch(HELP_TEXT, /\/use/);
  assert.match(HELP_TEXT, /定位码/);
  assert.equal(extractSessionPointer(quotePointer('session-9f3a1c7b2d4e')), 'session-9f3a1c7b2d4e');
  assert.equal(extractSessionPointer(quotePointer('session-abcdefghijklmnop')), 'session-abcdefghijkl');
  // Notices sent before the rename keep working when quoted across an upgrade.
  assert.equal(extractSessionPointer('> 引用这条消息，或发送 /use session-9f3a1c7b2d4e，可直接定位到该会话。'), 'session-9f3a1c7b2d4e');
});

test('the session list numbers rows across Workspaces and marks the current one', () => {
  const { text } = sessionPickerText(groups, 'session-77aa88bb99cc');
  assert.match(text, /^\*\*🗂 可切换的会话\*\* · 共 2 个$/m);
  assert.match(text, /^\*\*📁 企业微信\*\*$/m);
  assert.match(text, /^\*\*📁 dsh-workpet\*\*$/m);
  assert.match(text, /^1\. 修复登录 Bug · session-9f3a1c7b2d…$/m);
  assert.match(text, /^2\. 未命名会话 · session-77aa88bb99…（运行中 · 当前）$/m);
  assert.match(text, /\/session 序号/);
});

test('untrusted titles cannot inject Markdown, mentions or tags', () => {
  const hostile = '**bold** <@all> [link](https://x) `code`';
  const { text } = sessionPickerText([group('企业微信', [{ sessionId: 'session-aaa111bbb222', title: hostile }])], undefined);
  assert.doesNotMatch(text, /\*\*bold\*\*/);
  assert.doesNotMatch(text, /<@all>/);
  assert.doesNotMatch(text, /\]\(https:\/\/x\)/);
  assert.doesNotMatch(text, /`code`/);

  const notice = turnCompleteNotice(summary(), { title: hostile, workspace: '企业微信' });
  assert.doesNotMatch(notice.split('\n')[0], /\*\*bold\*\*/);
});

test('/help documents every command the bridge answers to and forgets the retired ones', () => {
  for (const command of ['/help', '/status', '/whoami', '/compact', '/delete', '/cancel', '/answer', '/approve', '/deny',
    '/new', '/session', '/reset']) {
    assert.ok(HELP_TEXT.includes(command), `/help mentions ${command}`);
  }
  for (const retired of ['/workspaces', '/sessions', '/use']) {
    assert.equal(HELP_TEXT.includes(retired), false, `/help no longer mentions ${retired}`);
  }
  assert.match(retiredCommandText(), /\/new/);
  assert.match(retiredCommandText(), /\/session/);
});

test('a refused sender is told to ask an operator, and an operator greeting names the group', () => {
  assert.match(unauthorizedText(), /\*\*🔒 用户未授权\*\*/);
  assert.match(unauthorizedText(), /请联系管理员/);
  assert.match(authorizedNotice('默认分组'), /管理员已授权，可以开始使用了/);
  assert.match(authorizedNotice('默认分组'), /默认分组/);
  assert.match(authorizedNotice('默认分组'), /`\/help`/);
});

test('a promotion and a group move each say what changed, without a jump hint', () => {
  const promoted = adminGrantedNotice();
  assert.match(promoted, /\*\*🔑 你已被设为管理员\*\*/);
  assert.match(promoted, /审批/);
  assert.match(promoted, /只能在单聊里发送/);
  assert.match(promoted, /`\/session`/);
  assert.equal(extractSessionPointer(promoted), undefined);

  const moved = groupAssignedNotice('朋友');
  assert.match(moved, /\*\*🔀 你已被调整到新的分组\*\*/);
  assert.match(moved, /朋友/);
  assert.match(moved, /之前分组的会话绑定已解除/);
  assert.match(moved, /恢复那个会话/);
  assert.match(moved, /否则下一条消息.*新建会话/);
  assert.equal(extractSessionPointer(moved), undefined);
});

test('/delete warns what it clears and how to confirm', () => {
  const warning = deleteWarningText('修复登录 Bug', 'session-9f3a1c7b2d4e');
  assert.match(warning, /归档会话会清空它的记忆/);
  assert.match(warning, /\/delete confirm/);
  assert.match(warning, /《修复登录 Bug》/);
  assert.equal(extractSessionPointer(warning), undefined, 'it must not double as a jump hint');
  assert.match(deletedText(), /会话已归档/);
  assert.match(deletedText(), /下一条消息.*新/);
});

test('/compact reports what it folded, and says when there was nothing', () => {
  assert.match(compactedText(3, 1234), /3 条历史/);
  assert.match(compactedText(3, 1234), /1234 tokens/);
  assert.match(nothingToCompactText(), /没有可压缩的历史/);
});

test('an administrator command sent in a group says why it is refused there', () => {
  assert.match(adminPrivateOnlyText(), /\*\*🔒 管理员命令只能在单聊中使用\*\*/);
  assert.match(adminPrivateOnlyText(), /群聊里的会话是所有人共用的/);
  assert.match(adminPrivateOnlyText(), /请在与机器人的单聊里发送/);
  assert.match(adminOnlyText(), /只有插件配置里列出的管理员可以使用/);
  // /help says the same thing up front, instead of letting the reader find out.
  assert.match(HELP_TEXT, /只能在单聊里发送/);
});

test('a Session command refused in a group names the shared Session and the private chat', () => {
  const deleting = groupSessionRefusalText('delete');
  assert.match(deleting, /\*\*🔒 群聊的会话记录只有管理员可以归档\*\*/);
  assert.match(deleting, /所有人共用/);
  assert.match(deleting, /`\/delete`/);
  assert.match(deleting, /自己的专属会话/);
  const compacting = groupSessionRefusalText('compact');
  assert.match(compacting, /只有管理员可以压缩/);
  assert.match(compacting, /`\/compact`/);
});

test('the Workspace picker numbers every option, marks the remembered one, and points at the typed fallback', () => {
  const list = Array.from({ length: 3 }, (_, index) => ({
    id: `w${index}`, path: `/Users/me/ws-${index}`, title: `WS ${index}`,
    pluginOwned: false, sessionCount: 0, archivedSessionCount: 0,
  }));
  const forNew = workspacePickerText('new', list, '/Users/me/ws-1');
  assert.match(forNew, /新建会话/);
  assert.match(forNew, /1\. WS 0/);
  assert.match(forNew, /2\. WS 1 — ~\/ws-1（上次使用）/);
  assert.match(forNew, /\/new 序号/);
  const forSession = workspacePickerText('session', list, '/Users/me/ws-2');
  assert.match(forSession, /3\. WS 2 — ~\/ws-2（当前）/);
  assert.match(forSession, /\/session 序号/);
  assert.match(workspacePickerText('new', [], ''), /通知范围没有覆盖任何 Workspace/);
});

test('a long session list is truncated but still reports the real total', () => {
  const many = Array.from({ length: 40 }, (_, index) => ({ sessionId: `session-${String(index).padStart(4, '0')}aaaaaa`, title: `任务 ${index}` }));
  const { text, sessions, total } = sessionPickerText([group('企业微信', many)], undefined);
  assert.equal(sessions.length, 30);
  assert.equal(total, 40);
  assert.match(text, /共 40 个/);
  assert.match(text, /… 另有 10 个未显示/);
  assert.equal(text.split('\n').length <= 45, true);
  assert.ok(byteLength(text) <= MAX_REPLY_BYTES);
});

test('a picker card is buttons up to five and a single-select checkbox otherwise', () => {
  const list = Array.from({ length: 5 }, (_, index) => ({
    id: `w${index}`, path: `/Users/me/ws-${index}`, title: `WS ${index}`,
    pluginOwned: false, sessionCount: 0, archivedSessionCount: 0,
  }));
  const button = workspacePickerCard(list, { nonce: 'abc123', offset: 0, total: 5 }, 'new');
  assert.equal(button.card_type, 'button_interaction');
  assert.equal(button.task_id, 'adm_abc123');
  assert.deepEqual(button.button_list.map(item => item.key), ['opt_0', 'opt_1', 'opt_2', 'opt_3', 'opt_4', 'cancel']);
  assert.deepEqual(button.button_list.at(-1), { text: '取消', key: 'cancel', style: 4 });
  assert.deepEqual(button.horizontal_content_list.map(row => row.keyname), ['选项1', '选项2', '选项3', '选项4', '选项5']);

  const six = Array.from({ length: 6 }, (_, index) => ({
    id: `w${index}`, path: `/Users/me/ws-${index}`, title: `WS ${index}`,
    pluginOwned: false, sessionCount: 0, archivedSessionCount: 0,
  }));
  const check = workspacePickerCard(six, { nonce: 'def456', offset: 0, total: 6 }, 'session');
  assert.equal(check.card_type, 'vote_interaction');
  assert.equal(check.checkbox.mode, 0, 'one Workspace only');
  assert.deepEqual(check.checkbox.option_list.map(item => item.id), ['opt_0', 'opt_1', 'opt_2', 'opt_3', 'opt_4', 'opt_5']);
  assert.deepEqual(check.submit_button, { text: '选择', key: 'submit' });
  assert.match(check.main_title.desc, /5 分钟内有效/);

  const twenty = Array.from({ length: 20 }, (_, index) => ({
    id: `w${index}`, path: `/Users/me/ws-${index}`, title: `WS ${index}`,
    pluginOwned: false, sessionCount: 0, archivedSessionCount: 0,
  }));
  const second = workspacePickerCard(twenty, { nonce: 'ghi789', offset: 19, total: 20 }, 'new');
  assert.deepEqual(second.checkbox.option_list.map(item => item.id), ['opt_19']);
  assert.match(second.main_title.desc, /第 2\/2 组/);

  // The card is the whole answer: it carries the remembered mark and the
  // current Session, since no text list precedes it any more.
  const marked = workspacePickerCard(list, { nonce: 'jkl012', offset: 0, total: 5 }, 'new', {
    selectedPath: '/Users/me/ws-1', summary: '当前：WS 1 · 空闲',
  });
  assert.match(marked.sub_title_text, /^当前：WS 1/);
  assert.match(marked.horizontal_content_list[1].value, /WS 1（上次使用）/);
  assert.match(marked.main_title.desc, /当前：WS 1/);
  const markedCheck = workspacePickerCard(six, { nonce: 'mno345', offset: 0, total: 6 }, 'session', {
    selectedPath: '/Users/me/ws-2', summary: '当前：WS 2',
  });
  assert.match(markedCheck.checkbox.option_list[2].text, /WS 2（当前）/);
});

test('a session picker numbers options globally and marks the current one in the rows', () => {
  const sessions = Array.from({ length: 3 }, (_, index) => ({
    sessionId: `session-${index}aaaaaa`, title: `任务 ${index}`,
    workspace: '企业微信', workspacePath: '/w', groupKey: 'g', running: index === 1, pinned: false,
  }));
  const card = sessionPickerCard(sessions, { nonce: 'abc123', offset: 0, total: 3 }, sessions[1].sessionId);
  assert.equal(card.card_type, 'button_interaction');
  assert.deepEqual(card.button_list.map(item => item.key), ['opt_0', 'opt_1', 'opt_2', 'cancel']);
  assert.match(card.horizontal_content_list[1].value, /任务 1（运行中 · 当前）/);

  const withSummary = sessionPickerCard(sessions, { nonce: 'abc123', offset: 0, total: 3 }, sessions[1].sessionId, {
    summary: '当前：任务 1 · 运行中',
  });
  assert.match(withSummary.sub_title_text, /^当前：任务 1/);

  const many = Array.from({ length: 6 }, (_, index) => ({
    sessionId: `session-${index}bbbbbb`, title: `任务 ${index}`,
    workspace: '企业微信', workspacePath: '/w', groupKey: 'g', running: false, pinned: false,
  }));
  const check = sessionPickerCard(many, { nonce: 'def456', offset: 0, total: 6 }, many[2].sessionId);
  assert.match(check.checkbox.option_list[2].text, /任务 2（当前）/, 'the current Session is marked on a checkbox card too');
});

test('a settled picker card says how it ended and keeps no live action', () => {
  const [created] = adminSettledCards('created', '企业微信', 'adm_abc123');
  assert.equal(created.main_title.title, '✅ 已创建会话');
  assert.match(created.main_title.desc, /企业微信/);
  assert.ok(created.card_action, 'a replaced card needs card_action or WeCom answers 42045');
  const [switched] = adminSettledCards('switched', '修复登录 Bug', 'adm_abc123');
  assert.equal(switched.main_title.title, '✅ 已切换会话');
  const [cancelled] = adminSettledCards('cancelled', undefined, 'adm_abc123');
  assert.equal(cancelled.main_title.title, '↩️ 已取消');
  const [expired] = adminSettledCards('expired', undefined, 'adm_abc123');
  assert.equal(expired.main_title.title, '⌛ 已失效');
  assert.equal(expired.button_list, undefined, 'the first card has no live button');
});

test('the current-session summary and the switch confirmation name the facts', () => {
  const text = currentSessionText({
    title: '修复登录 Bug', workspace: '企业微信',
    model: { provider: 'deepseek-account', model: 'deepseek-reasoner' },
    context: { used: 12_300, window: 128_000 }, running: true,
  }, 'session-9f3a1c7b2d4e');
  assert.match(text, /当前会话/);
  assert.match(text, /《修复登录 Bug》/);
  assert.match(text, /Workspace 企业微信/);
  assert.match(text, /12\.3k \/ 128k/);
  assert.match(text, /运行中/);
  assert.match(currentSessionText(undefined, undefined), /尚未选择/);
  assert.equal(
    pickerSummaryText({
      title: '修复登录 Bug',
      model: { provider: 'deepseek-account', model: 'deepseek-reasoner' },
      running: true,
    }, 'session-9f3a1c7b2d4e'),
    '当前：修复登录 Bug · deepseek-account/deepseek-reasoner · 运行中',
    'the card line is plain text: no Markdown and no locator code',
  );
  assert.match(pickerSummaryText(undefined, undefined), /尚未选择/);
  assert.match(sessionSwitchedText('修复登录 Bug', '企业微信', 'session-9f3a1c7b2d4e'), /已切换到《修复登录 Bug》/);
  assert.match(adminSelectionHintText('none'), /还没有选择/);
  assert.match(adminSelectionHintText('many'), /只能选择一个/);
  assert.match(adminSelectionHintText('unreadable'), /没能读取/);
});

test('the approval card shows the decision on its own lines, not one crammed description', async () => {
  const { approvalCard, approvalSettledCards } = await import('../dist/host/bridge/notices.js');
  const card = approvalCard('mock 一个权限审批，我来从手机端测试一下', {
    toolName: 'bash', reason: '允许本次操作使用 danger-full-access 权限：这是你要求的审批模拟：需要在工作区外写入并删除临时文件',
  }, '85cc9p', 60000);
  assert.equal(card.main_title.title, '🔐 权限请求 · bash');
  assert.match(card.sub_title_text, /^这是你要求的审批模拟/, 'the why is the headline sentence');
  assert.match(card.sub_title_text, /临时文件$/, 'and is not cut short');
  const rows = Object.fromEntries(card.horizontal_content_list.map(row => [row.keyname, row.value]));
  assert.equal(rows['权限'], '允许本次操作使用 danger-full-access 权限');
  assert.match(rows['会话'], /^mock 一个权限审批/);
  assert.equal(rows['验证码'], '85cc9p · 1 分钟内有效');
  for (const row of card.horizontal_content_list) assert.ok([...row.keyname].length <= 5);
  const bare = approvalCard(null, { toolName: 'bash' }, 'abc123', 60000);
  assert.equal(bare.sub_title_text, undefined);
  const [settled] = approvalSettledCards('allowed-once', 'plugin_manager', 'apv_x');
  assert.equal(settled.main_title.title, '✅ 已批准 · plugin_manager', 'tool names keep their underscores');
});

test('validity is said the way a person says it', async () => {
  const { validityText, approvalNotice } = await import('../dist/host/bridge/notices.js');
  assert.equal(validityText(45_000), '45 秒');
  assert.equal(validityText(1_800_000), '30 分钟');
  assert.equal(validityText(3_600_000), '1 小时');
  assert.equal(validityText(5_400_000), '1 小时 30 分钟');
  assert.match(approvalNotice('session-1', 't', { toolName: 'bash' }, 'a1b2c3', 1_800_000), /最长有效 30 分钟/);
});

test('a question card is only built for one question with options, buttons up to five', async () => {
  const { questionCardKind, questionCard, questionSettledCards } = await import('../dist/host/bridge/notices.js');
  const { parseCardEvent } = await import('../dist/host/bridge/cards.js');
  const option = n => ({ label: `o${n}` });
  const six = { id: 'q', question: 'Q?', options: Array.from({ length: 5 }, (_, n) => option(n)) };
  assert.equal(questionCardKind([six]), 'buttons');
  assert.equal(questionCardKind([{ ...six, options: [...six.options, option(7)] }]), 'checkbox', 'a card carries six buttons, one is 「自己回答」; more become a list');
  assert.equal(questionCardKind([{ ...six, multiSelect: true }]), 'checkbox', 'a tap cannot pick several');
  assert.equal(questionCardKind([{ ...six, options: Array.from({ length: 20 }, (_, n) => option(n)) }]), undefined, 'a checkbox card carries twenty entries, one is 「自己回答」');
  assert.equal(questionCardKind([{ ...six, options: Array.from({ length: 19 }, (_, n) => option(n)) }]), 'checkbox');
  assert.equal(questionCardKind([{ id: 'q', question: 'Q?' }]), undefined, 'free text cannot be typed into a card');
  assert.equal(questionCardKind([six, six]), 'dropdowns', 'several single-choice questions share one card');
  assert.equal(questionCardKind([six, six, six, six]), undefined, 'a card carries three dropdowns');
  assert.equal(questionCardKind([six, { ...six, multiSelect: true }]), undefined, 'a dropdown cannot take several');
  assert.equal(questionCardKind([six, { id: 'f', question: 'Q?' }]), undefined, 'nor free text');
  assert.equal(questionCardKind([six, { ...six, options: Array.from({ length: 9 }, (_, n) => option(n)) }]), undefined, 'a dropdown carries ten entries: 请选择, the options, 自己回答');
  assert.equal(questionCardKind([six, { ...six, options: Array.from({ length: 8 }, (_, n) => option(n)) }]), 'dropdowns');

  const card = questionCard('《会话》', six, 'abc123', 1_800_000);
  assert.equal(card.task_id, 'qst_abc123');
  assert.equal(card.button_list.length, 6, 'five options and 「自己回答」');
  assert.deepEqual(card.button_list.at(-1), { text: '✏️ 自己回答', key: 'other', style: 2 });
  assert.match(card.main_title.desc, /30 分钟内有效 · 验证码 abc123/);
  assert.deepEqual(card.horizontal_content_list.map(row => row.keyname), ['会话'], 'short bare options need no list: the buttons say it all');
  const long = questionCard('《会话》', { ...six, options: six.options.map((o, n) => ({ ...o, label: `一个很长很长的选项名称${n}` })) }, 'abc123', 1_800_000);
  assert.deepEqual(long.horizontal_content_list.map(row => row.keyname), ['选项1', '选项2', '选项3', '选项4', '选项5', '会话']);
  assert.deepEqual(long.button_list.map(b => b.text), ['选项 1', '选项 2', '选项 3', '选项 4', '选项 5', '✏️ 自己回答']);
  const [notice] = questionSettledCards('answered', 'o2', 'qst_abc123');
  assert.equal(notice.main_title.title, '✅ 已回答');
  assert.match(notice.main_title.desc, /o2/);
  assert.ok(notice.card_action, 'a replaced card needs card_action or WeCom answers 42045');

  const click = (taskId, key) => parseCardEvent({ headers: {}, body: { from: { userid: 'u' }, event: { event_key: key, task_id: taskId } } });
  assert.deepEqual([click('qst_abc123', 'opt_2').kind, click('qst_abc123', 'opt_2').action, click('qst_abc123', 'opt_2').option], ['question', 'option', 2]);
  assert.equal(click('qst_abc123', 'approve').action, undefined, 'an approval button means nothing on a question card');
  assert.equal(click('apv_abc123', 'opt_1').action, undefined, 'and an option button means nothing on an approval card');
  assert.equal(click('apv_abc123', 'approve').action, 'approve');
  assert.equal(click('foreign', 'opt_1').nonce, '');
});

test('an administrator card is parsed as admin, and its keys mean nothing on other cards', async () => {
  const { parseCardEvent } = await import('../dist/host/bridge/cards.js');
  const click = (taskId, key, extra = {}) => parseCardEvent({
    headers: {}, body: { from: { userid: 'u' }, event: { event_key: key, task_id: taskId, ...extra } },
  });
  const option = click('adm_abc123', 'opt_1');
  assert.deepEqual([option.kind, option.action, option.option, option.nonce], ['admin', 'option', 1, 'abc123']);
  assert.equal(click('adm_abc123', 'cancel').action, 'cancel');
  const submit = click('adm_abc123', 'submit', {
    selected_items: { selected_item: [{ question_key: 'pick', option_ids: { option_id: ['opt_19'] } }] },
  });
  assert.deepEqual([submit.kind, submit.action, submit.selected], ['admin', 'submit', [19]]);
  assert.equal(click('qst_abc123', 'cancel').action, undefined, 'cancel only belongs to an admin card');
  assert.equal(click('apv_abc123', 'cancel').action, undefined);
});

test('an option row keeps the option name whole and drops a description that would be clipped', async () => {
  const { questionCard } = await import('../dist/host/bridge/notices.js');
  const card = questionCard(null, { id: 'q', question: 'Q?', options: [
    { label: '这是一个特别特别长的选项乙', description: '长标签，按钮应显示为选项二，后面还有很多很多说明文字' },
    { label: '短', description: '说明' },
  ] }, 'abc123', 60_000);
  const rows = Object.fromEntries(card.horizontal_content_list.map(row => [row.keyname, row.value]));
  assert.equal(rows['选项1'], '这是一个特别特别长的选项乙', 'the description that does not fit is left out');
  assert.equal(rows['选项2'], '短 — 说明', 'one that fits is kept');
});

test('the ticked options are read from the shape WeCom really sends, and never guessed otherwise', async () => {
  const { parseCardEvent, selectedOptions } = await import('../dist/host/bridge/cards.js');
  // Captured from a real vote_interaction submit.
  const real = { eventtype: 'template_card_event', template_card_event: {
    card_type: 'vote_interaction', event_key: 'submit', task_id: 'qst_zgqfs4',
    selected_items: { selected_item: [{ question_key: 'pick', option_ids: { option_id: ['opt_0', 'opt_2', 'opt_3'] } }] },
  } };
  const event = parseCardEvent({ headers: {}, body: { from: { userid: 'u' }, event: real } });
  assert.deepEqual([event.kind, event.action, event.selected], ['question', 'submit', [0, 2, 3]]);
  assert.deepEqual(selectedOptions({ selected_item: [{ question_key: 'pick', option_ids: { option_id: [] } }] }), [], 'nothing ticked is empty, not unreadable');
  assert.deepEqual(selectedOptions({ selected_item: [{ question_key: 'pick', option_ids: { option_id: 'opt_1' } }] }), [1], 'a lone id may arrive as a string');
  assert.equal(selectedOptions(undefined), undefined);
  assert.equal(selectedOptions({ selected_item: [{ option_ids: { option_id: ['x1'] } }] }), undefined, 'ids this plugin never sent are not believed');
  const bare = parseCardEvent({ headers: {}, body: { from: { userid: 'u' }, event: { template_card_event: { event_key: 'submit', task_id: 'qst_a' } } } });
  assert.equal(bare.selected, undefined, 'no selection field means cannot read');
});

test('a dropdown card starts every question on 请选择, so an untouched one is never an answer', async () => {
  const { questionCard } = await import('../dist/host/bridge/notices.js');
  const { chosenOptions } = await import('../dist/host/bridge/cards.js');
  const ask = [
    { id: 'a', question: '先选哪个？', options: [{ label: 'x' }, { label: 'y' }] },
    { id: 'b', question: '再选哪个？', options: [{ label: 'p' }] },
  ];
  const card = questionCard('《会话》', ask, 'abc123', 1_800_000);
  assert.equal(card.card_type, 'multiple_interaction');
  assert.deepEqual(card.select_list.map(item => item.question_key), ['q0', 'q1']);
  assert.deepEqual(card.select_list[0].option_list.map(o => o.id), ['none', 'opt_0', 'opt_1', 'other'], 'each dropdown can be told to type the answer');
  assert.ok(card.select_list.every(item => item.selected_id === 'none'));
  // This card type shows only title, description and controls: the questions
  // must be in the description, or they are not readable at all.
  assert.equal(card.sub_title_text, undefined);
  assert.equal(card.horizontal_content_list, undefined);
  assert.match(card.main_title.desc, /1\. 先选哪个？\n2\. 再选哪个？\n/);
  assert.match(card.main_title.desc, /每题选一项 · 会话：《会话》 · 30 分钟内有效 · 验证码 abc123\n自己写答案：选「✏️ 自己回答」，或 \/answer abc123 题号 答案$/, 'and says how to write an answer instead');
  assert.match(card.select_list[0].title, /^1\. 先选哪个/, 'each dropdown repeats the start of its question');

  const items = { selected_item: [
    { question_key: 'q0', option_ids: { option_id: ['opt_1'] } },
    { question_key: 'q1', option_ids: { option_id: ['none'] } },
  ] };
  assert.deepEqual(chosenOptions(items), { q0: 1, q1: undefined });
  // Captured from a real multiple_interaction submit.
  assert.deepEqual(chosenOptions({ selected_item: [
    { question_key: 'q0', option_ids: { option_id: ['opt_0'] } },
    { question_key: 'q1', option_ids: { option_id: ['opt_2'] } },
  ] }), { q0: 0, q1: 2 });
  // Every question keeps a fair share of the subtitle.
  const long = { id: 'l', question: '很长'.repeat(80), options: [{ label: 'x' }] };
  const wide = questionCard(null, [long, long, long], 'abc123', 60_000);
  const lines = wide.main_title.desc.split('\n');
  assert.equal(lines.length, 5, 'three questions, the line about the Session and how to type an answer');
  assert.ok(lines.slice(0, 3).every(line => line.endsWith('…')), 'each is cut, and each equally');
  assert.ok(byteLength(wide.main_title.desc) <= 290, 'the whole description stays within what WeCom shows');
  assert.match(lines.at(-1), /^自己写答案：/, 'so the last line is never the one that is lost');
  assert.equal(chosenOptions(undefined), undefined);
  assert.equal(chosenOptions({}), undefined);
});
