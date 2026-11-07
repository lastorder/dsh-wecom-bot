import test from 'node:test';
import assert from 'node:assert/strict';
import { byteLength, extractSessionPointer, MAX_NOTICE_BYTES, MAX_REPLY_BYTES } from '../dist/host/bridge/format.js';
import {
  adminGrantedNotice, adminOnlyText, adminPrivateOnlyText, adminUnassignedText, approvalNotice, authorizedNotice, compactedText,
  deleteWarningText, deletedText, groupAssignedNotice, groupSessionRefusalText, HELP_TEXT, newSessionText,
  nothingToCompactText, promptFailedNotice, questionNotice, quotePointer, reviewNotice, sessionListText,
  questionAccessRefusalText, routingChangedText, turnCompleteNotice, unauthorizedText, workspaceListText,
} from '../dist/host/bridge/notices.js';

/**
 * The WeCom-facing copy is Markdown-rendered: these tests pin the *shape* of
 * every template (one header, flat lines, no tables) and the two things that
 * silently break if the copy is edited carelessly — a template exceeding the
 * reply budget, and a `/use` hint that no longer parses back to its Session.
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
    routingChangedText(),
    questionAccessRefusalText(),
    deleteWarningText('修复登录 Bug', 'session-9f3a1c7b2d4e'),
    deletedText(),
    nothingToCompactText(),
    newSessionText('企业微信', 'session-9f3a1c7b2d4e'),
    workspaceListText(Array.from({ length: 40 }, (_, index) => ({
      id: `w${index}`, path: `/Users/me/workspace-${index}`, title: `Workspace ${index}`,
      pluginOwned: false, sessionCount: index, archivedSessionCount: 0,
    })), '/Users/me/workspace-3').text,
    sessionListText(groups, 'session-9f3a1c7b2d4e').text,
    turnCompleteNotice(summary({ assistantText: long }), { title: '修复登录 Bug', workspace: '企业微信' }),
    questionNotice('session-9f3a1c7b2d4e', '修复登录 Bug', [
      { id: 'q1', question: '问题一'.repeat(200), options: [{ label: '选项'.repeat(100), description: '说明'.repeat(200) }] },
      { id: 'q2', question: '问题二', multiSelect: true, options: [{ label: 'a' }] },
    ], 'a1b2c3', 60000),
    reviewNotice('session-9f3a1c7b2d4e', '修复登录 Bug'),
    approvalNotice('session-9f3a1c7b2d4e', '修复登录 Bug', { toolName: 'bash', reason: 'x'.repeat(2000) }, 'a1b2c3', 60000),
    promptFailedNotice('session-9f3a1c7b2d4e', '修复登录 Bug'),
  ];
  for (const text of texts) {
    assert.ok(byteLength(text) <= MAX_NOTICE_BYTES, `notice within ${MAX_NOTICE_BYTES} bytes: ${text.slice(0, 60)}…`);
  }
});

test('every per-Session notice carries a /use hint that resolves back to it', () => {
  const notices = [
    turnCompleteNotice(summary(), { title: '修复登录 Bug', workspace: '企业微信' }),
    questionNotice('session-9f3a1c7b2d4e', '修复登录 Bug', [{ id: 'q', question: 'Q?' }], 'a1b2c3', 60000),
    reviewNotice('session-9f3a1c7b2d4e', '修复登录 Bug'),
    approvalNotice('session-9f3a1c7b2d4e', '修复登录 Bug', { toolName: 'bash' }, 'a1b2c3', 60000),
    promptFailedNotice('session-9f3a1c7b2d4e', '修复登录 Bug'),
  ];
  for (const text of notices) {
    const token = extractSessionPointer(text);
    assert.ok(token, 'the notice carries a /use hint');
    assert.ok('session-9f3a1c7b2d4e'.startsWith(token), `the hint is a prefix of the Session id: ${token}`);
  }
});

test('a hint is the only /use occurrence the quote parser can pick up', () => {
  // The footer of /sessions must never read like `/use <something resolvable>`,
  // or quoting a session list would silently switch the administrator.
  const listing = sessionListText(groups, undefined);
  assert.deepEqual(listing.listing, ['session-9f3a1c7b2d4e', 'session-77aa88bb99cc']);
  assert.equal(extractSessionPointer(listing.text), undefined);
  for (const text of [
    HELP_TEXT, adminOnlyText(), adminPrivateOnlyText(), unauthorizedText(), authorizedNotice('默认分组'),
    groupAssignedNotice('朋友'), adminGrantedNotice(), adminUnassignedText(), routingChangedText(), questionAccessRefusalText(),
  ]) {
    assert.equal(extractSessionPointer(text), undefined);
  }
  // A group refusal names the command in inline code — `/delete`, never `/use`.
  assert.equal(extractSessionPointer(groupSessionRefusalText('delete')), undefined);
  // A member's /sessions footer and every refusal name `序号`, never `/use <word>`.
  assert.match(HELP_TEXT, /\/use/);
  assert.equal(extractSessionPointer(quotePointer('session-9f3a1c7b2d4e')), 'session-9f3a1c7b2d4e');
  assert.equal(extractSessionPointer(quotePointer('session-abcdefghijklmnop')), 'session-abcdefghijkl');
});

test('the session list numbers rows across Workspaces and marks the current one', () => {
  const { text } = sessionListText(groups, 'session-77aa88bb99cc');
  assert.match(text, /^\*\*🗂 可切换的会话\*\* · 共 2 个$/m);
  assert.match(text, /^\*\*📁 企业微信\*\*$/m);
  assert.match(text, /^\*\*📁 dsh-workpet\*\*$/m);
  assert.match(text, /^1\. 修复登录 Bug · session-9f3a1c7b2d…$/m);
  assert.match(text, /^2\. 未命名会话 · session-77aa88bb99…（运行中 · 当前）$/m);
});

test('untrusted titles cannot inject Markdown, mentions or tags', () => {
  const hostile = '**bold** <@all> [link](https://x) `code`';
  const { text } = sessionListText([group('企业微信', [{ sessionId: 'session-aaa111bbb222', title: hostile }])], undefined);
  assert.doesNotMatch(text, /\*\*bold\*\*/);
  assert.doesNotMatch(text, /<@all>/);
  assert.doesNotMatch(text, /\]\(https:\/\/x\)/);
  assert.doesNotMatch(text, /`code`/);

  const notice = turnCompleteNotice(summary(), { title: hostile, workspace: '企业微信' });
  assert.doesNotMatch(notice.split('\n')[0], /\*\*bold\*\*/);
});

test('/help documents every command the bridge answers to', () => {
  for (const command of ['/help', '/status', '/whoami', '/compact', '/delete', '/cancel', '/answer', '/approve', '/deny',
    '/new', '/workspaces', '/sessions', '/use', '/reset']) {
    assert.ok(HELP_TEXT.includes(command), `/help mentions ${command}`);
  }
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
  assert.match(promoted, /`\/sessions`/);
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

test('/workspaces numbers every Workspace and marks the chosen one', () => {
  const list = Array.from({ length: 3 }, (_, index) => ({
    id: `w${index}`, path: `/Users/me/ws-${index}`, title: `WS ${index}`,
    pluginOwned: false, sessionCount: 0, archivedSessionCount: 0,
  }));
  const { text, listing } = workspaceListText(list, '/Users/me/ws-1');
  assert.deepEqual(listing, list.map(workspace => workspace.path));
  assert.match(text, /1\. WS 0/);
  assert.match(text, /2\. WS 1 — ~\/ws-1（当前默认）/);
  assert.match(text, /\/workspaces 序号/);
  assert.match(workspaceListText([], '').text, /还没有注册任何 Workspace/);
});

test('a long session list is truncated but still reports the real total', () => {
  const many = Array.from({ length: 40 }, (_, index) => ({ sessionId: `session-${String(index).padStart(4, '0')}aaaaaa`, title: `任务 ${index}` }));
  const { text, listing } = sessionListText([group('企业微信', many)], undefined);
  assert.equal(listing.length, 30);
  assert.match(text, /共 40 个/);
  assert.match(text, /… 另有 10 个未显示/);
  assert.equal(text.split('\n').length <= 45, true);
  assert.ok(byteLength(text) <= MAX_REPLY_BYTES);
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
