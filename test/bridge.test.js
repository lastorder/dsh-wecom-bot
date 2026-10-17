import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createBridge } from '../dist/host/bridge/index.js';
import { createCatalogService } from '../dist/host/catalog.js';
import { extractSessionPointer } from '../dist/host/bridge/format.js';
import { createModelService } from '../dist/host/models.js';
import { createObservationStore } from '../dist/host/observation.js';
import { createRoundTracker } from '../dist/host/rounds.js';
import { createRouter } from '../dist/host/routing.js';
import { createRoutingStore } from '../dist/host/routing-store.js';
import { createSessionProvisioner } from '../dist/host/sessions.js';
import { summarizeTurn } from '../dist/host/turns.js';
import { createWorkspaceService } from '../dist/host/workspaces.js';
import {
  baseSettings, fakeClient, fakeHost, finishedSession, frame, memoryJournal, scratchDirectory,
  settle, until, TEST_WORKSPACE_PATH,
} from './helpers.js';

const silent = { warn() {}, error() {}, info() {} };

/**
 * The whole Host stack below the socket: store → router → provisioner → bridge.
 *
 * `members` are the principals the settings page would have authorized before
 * the Bot ever received a message; `alice` (a private chat) is the default.
 * `group` overrides the default group's Workspace/model, which is what the
 * 「用户分组」 card edits.
 */
async function harness(settings = {}, hostOptions = {}, extra = {}) {
  const ctx = fakeHost({ workspaces: [], ...hostOptions });
  const client = fakeClient();
  const journal = memoryJournal();
  const observations = extra.observations ?? createObservationStore();
  const rounds = createRoundTracker({ journal });
  const catalogs = createCatalogService({
    list: async signal => (await ctx.sessionController.list({}, signal)).items,
    registry: () => ctx.registry,
  }, { ttlMs: 0 });
  const store = createRoutingStore({ directory: extra.directory ?? scratchDirectory(), onError: () => {} });
  const workspaces = createWorkspaceService({
    registry: () => ctx.registry,
    defaultPath: TEST_WORKSPACE_PATH,
    log: silent,
  });
  const models = createModelService({
    sessionController: ctx.sessionController,
    defaults: () => ctx.defaultModelService,
    ttlMs: 0,
    log: silent,
  });
  const provisioner = createSessionProvisioner({
    sessionController: ctx.sessionController, models, workspaces, catalogs, bindings: store,
    bindingKey: binding => `${binding.kind}:${binding.id}`, journal, log: silent,
  });
  const resolved = { ...baseSettings, ...settings };
  const router = createRouter({ store, provisioner, log: silent });

  await store.load();
  if (extra.group) await store.updateGroup('default', extra.group);
  for (const [kind, id, options] of extra.members ?? [['user', 'alice']]) {
    await store.create(kind, id, {
      groupId: options?.groupId ?? 'default',
      ...(options?.label ? { label: options.label } : {}),
    });
  }

  const bridge = createBridge({
    ctx, client, settings: resolved, router, journal, observations, rounds, catalogs, log: silent,
  });
  const stop = bridge.start();
  // `emit` is fire-and-forget, exactly like the socket in production — so wait
  // for the per-chat queue to drain before asserting, then give the outbox the
  // couple of turns it needs to deliver the reply.
  const send = async (content, options) => {
    client.emit('message', frame(content, options));
    await bridge.whenIdle();
    await settle();
  };
  const endTurn = async (sessionId, options = {}) => {
    const { session, end } = finishedSession(sessionId, options);
    const chats = await bridge.onTurnEnd(session, end, () => summarizeTurn(session, end));
    rounds.onTurnEnd(summarizeTurn(session, end), chats);
    await settle();
    return chats;
  };
  return {
    ctx, client, journal, bridge, stop, send, endTurn, rounds, observations,
    store, workspaces, models, provisioner, router, settings: resolved,
    /** Authorize a principal the way the settings page does, after start. */
    authorize: (kind, id, options = {}) => store.create(kind, id, {
      groupId: options.groupId ?? 'default', ...(options.label ? { label: options.label } : {}),
    }),
    addGroup: name => store.createGroup(name),
    setGroup: (patch, id = 'default') => store.updateGroup(id, patch),
  };
}

const lastReply = h => h.client.replies.at(-1)?.content ?? '';
const sentChats = h => h.client.sends.map(send => send.chat);

test('an authorized member gets a Session in their group Workspace on first contact', async () => {
  const h = await harness();
  await h.send('你好');
  assert.equal(h.ctx.creates.length, 1, 'exactly one DSH Session was created');
  const workspace = h.ctx.registry.list()[0];
  assert.equal(workspace.path, TEST_WORKSPACE_PATH, 'created in the plugin Workspace directory');
  assert.equal(workspace.title, '企业微信');
  assert.equal(h.ctx.creates[0].workspaceId, workspace.id, 'attached by Workspace id');
  assert.equal(h.ctx.prompts.at(-1).sessionId, 'session-created-1');
  assert.deepEqual(h.ctx.prompts.at(-1).content, [{ type: 'text', text: '你好' }]);

  const member = h.store.get('user:alice');
  assert.equal(member.kind, 'user');
  assert.equal(member.id, 'alice');
  assert.equal(member.groupId, 'default');
  assert.equal(member.sessionId, 'session-created-1');
  assert.match(lastReply(h), /已提交给 DSH/);
  assert.equal(h.journal.find('binding.session.created').length, 1);

  // Membership is durable: a second message reuses the same Session.
  await h.send('继续');
  assert.equal(h.ctx.creates.length, 1);
  assert.equal(h.ctx.prompts.at(-1).sessionId, 'session-created-1');
  await h.store.flush();
  const file = JSON.parse(await readFile(h.store.file, 'utf8'));
  assert.equal(file.version, 3);
  assert.equal(file.bindings[0].sessionId, 'session-created-1');
  h.stop();
});

test('two messages typed in a row share one Session instead of racing for it', async () => {
  const h = await harness();
  // No settle between them: this is what the socket does when someone types
  // fast. Before messages were serialized per chat, both saw a member with no
  // Session and each created one, so the two messages landed in two different
  // conversations and the first Session was left unbound.
  h.client.emit('message', frame('第一条'));
  h.client.emit('message', frame('第二条'));
  await h.bridge.whenIdle();
  await settle();
  assert.equal(h.ctx.creates.length, 1, 'the Session is created once, not once per message');
  assert.deepEqual(h.ctx.prompts.map(prompt => prompt.sessionId),
    ['session-created-1', 'session-created-1'], 'both messages arrive in order, in that Session');
  assert.equal(h.store.get('user:alice').sessionId, 'session-created-1');
  h.stop();
});

test('a message queued behind a stopped bridge is dropped, not routed', async () => {
  const h = await harness();
  h.client.emit('message', frame('第一条'));
  h.stop();
  h.client.emit('message', frame('第二条'));
  await h.bridge.whenIdle();
  await settle();
  assert.equal(h.ctx.creates.length, 0, 'nothing is submitted after stop()');
  assert.equal(h.client.replies.length, 0);
});

test('private chats are per user; one group shares a single Session for all its members', async () => {
  const h = await harness({}, {}, { members: [['user', 'alice'], ['user', 'bob'], ['group', 'group-1']] });
  await h.send('hi', { chat: 'alice', user: 'alice' });
  await h.send('hi', { chat: 'bob', user: 'bob' });
  await h.send('hi', { chat: 'group-1', user: 'alice' });
  await h.send('hi again', { chat: 'group-1', user: 'carol' });
  assert.deepEqual(h.ctx.prompts.map(prompt => prompt.sessionId),
    ['session-created-1', 'session-created-2', 'session-created-3', 'session-created-3']);
  assert.deepEqual(h.store.bindings().map(binding => `${binding.kind}:${binding.id}`),
    ['user:alice', 'user:bob', 'group:group-1']);
  h.stop();
});

test('a sender in no group is refused: no reply, no member, no prompt', async () => {
  const h = await harness({}, {}, { members: [] });
  await h.send('hello', { chat: 'mallory', user: 'mallory' });
  assert.equal(h.client.replies.length, 0, 'silence does not confirm the Bot is reachable');
  assert.equal(h.ctx.prompts.length, 0);
  assert.equal(h.ctx.creates.length, 0, 'no Session is created for an unauthorized sender');
  assert.deepEqual(h.store.bindings(), []);
  assert.equal(h.journal.find('round.complete').at(-1).outcome, 'rejected');
  assert.equal(h.journal.find('round.complete').at(-1).response.reason, 'unauthorized');
  h.stop();
});

test('a refused sender is listed with the message it sent, and authorizing it clears the row', async () => {
  const h = await harness({}, {}, { members: [] });
  await h.send('帮我改登录', { chat: 'mallory', user: 'mallory' });
  const rows = h.observations.rejected(key => Boolean(h.store.get(key)));
  assert.deepEqual(rows.map(row => [row.key, row.chatType, row.text]), [['user:mallory', 'single', '帮我改登录']]);

  // What the page does: assign the refused sender to a group.
  await h.authorize('user', 'mallory', { label: '市场部小李' });
  assert.deepEqual(h.observations.rejected(key => Boolean(h.store.get(key))), []);
  await h.send('现在可以了吗', { chat: 'mallory', user: 'mallory' });
  assert.equal(h.ctx.prompts.at(-1).sessionId, 'session-created-1');
  assert.equal(h.store.label('user:mallory'), '市场部小李');
  h.stop();
});

test('a group chat is refused until the group itself is added to a group', async () => {
  const h = await harness({}, {}, { members: [['user', 'alice']] });
  await h.send('大家好', { chat: 'group-1', user: 'alice' });
  assert.equal(h.client.replies.length, 0);
  assert.equal(h.ctx.prompts.length, 0);
  assert.deepEqual(h.observations.rejected(() => false).map(row => [row.key, row.chatType]),
    [['group:group-1', 'group']]);
  await h.authorize('group', 'group-1');
  await h.send('再试一次', { chat: 'group-1', user: 'bob' });
  assert.equal(h.ctx.prompts.at(-1).sessionId, 'session-created-1');
  h.stop();
});

test('an administrator may talk to the Bot without being added to a group', async () => {
  const h = await harness({ adminUserIds: ['root'] }, {}, { members: [] });
  await h.send('在吗', { chat: 'root', user: 'root' });
  assert.match(lastReply(h), /已提交给 DSH/);
  assert.equal(h.store.get('user:root').groupId, 'default', 'implicitly authorized into the default group');
  assert.equal(h.store.label('user:root'), '', 'with no note of its own');
  h.stop();
});

test('turn completion is delivered to the conversation bound to that Session', async () => {
  const h = await harness({}, { workspaces: [{ id: 'w1', path: '/w/alpha', title: 'Alpha', sessionIds: ['s1'] }] });
  h.client.emit('authenticated');
  await h.send('hi', { chat: 'alice', user: 'alice' });
  await h.authorize('group', 'group-9');
  await h.send('hi', { chat: 'group-9', user: 'bob' });
  const aliceSession = h.ctx.prompts[0].sessionId;
  const groupSession = h.ctx.prompts[1].sessionId;
  assert.deepEqual(await h.endTurn(aliceSession, { text: '完成啦' }), ['alice']);
  assert.deepEqual(await h.endTurn(groupSession, { text: '群里的' }), ['group-9']);
  assert.deepEqual(sentChats(h), ['alice', 'group-9']);
  assert.match(h.client.sends[0].body.markdown.content, /完成啦/);
  h.stop();
});

test('a Session nobody is bound to logs a warning instead of silently skipping its notice', async () => {
  const h = await harness({}, { workspaces: [{ id: 'w1', path: '/w/alpha', title: 'Alpha', sessionIds: ['s1'] }] });
  assert.deepEqual(await h.endTurn('s1', { text: '完成' }), []);
  const warning = h.journal.find('wecom.notify.skipped').at(-1);
  assert.equal(warning.level, 'warn');
  assert.equal(warning.sessionId, 's1');
  assert.equal(warning.reason, 'turn-complete');
  h.stop();
});

test('administrators receive notifications for their Workspace scope only', async () => {
  const everywhere = await harness({ adminUserIds: ['root'] });
  everywhere.client.emit('authenticated');
  await everywhere.send('hi');
  assert.deepEqual(await everywhere.endTurn('session-created-1', { text: '完成' }), ['alice', 'root']);
  assert.deepEqual(sentChats(everywhere), ['alice', 'root'], 'the admin is notified in their private chat');
  everywhere.stop();

  const scoped = await harness({ adminUserIds: ['root'], adminWorkspaces: ['/somewhere/else'] });
  scoped.client.emit('authenticated');
  await scoped.send('hi');
  assert.deepEqual(await scoped.endTurn('session-created-1', { text: '完成' }), ['alice'],
    'a Workspace outside the admin scope is not fanned out');
  scoped.stop();
});

test('only administrators may list or switch Sessions; everyone else stays on their own', async () => {
  const h = await harness({}, { workspaces: [{ id: 'w1', path: '/w/alpha', title: 'Alpha', sessionIds: ['s1', 's2'] }] });
  await h.send('/sessions');
  assert.match(lastReply(h), /只有插件配置里列出的管理员/);
  await h.send('/use s1');
  assert.match(lastReply(h), /只有插件配置里列出的管理员/);
  await h.send('继续自己的工作');
  assert.equal(h.ctx.prompts.at(-1).sessionId, 'session-created-1', 'still the personal Session');
  const quoted = '> 引用这条消息，或发送 /use s1，可直接定位到该会话。';
  await h.send('看看这个', { quote: quoted });
  assert.equal(h.ctx.prompts.at(-1).sessionId, 'session-created-1', 'a quote cannot move a non-admin');
  assert.equal(h.journal.find('wecom.quote').at(-1).outcome, 'not-admin');
  h.stop();
});

test('an administrator can switch Sessions, and /reset returns to their own membership', async () => {
  const h = await harness({ adminUserIds: ['root'] }, {
    workspaces: [{ id: 'w1', path: '/w/alpha', title: 'Alpha', sessionIds: ['s1', 's2'] }],
  }, { members: [] });
  await h.send('/sessions', { chat: 'root', user: 'root' });
  assert.match(lastReply(h), /可切换的会话/);
  assert.match(lastReply(h), /Alpha 任务/);
  await h.send('/use s1', { chat: 'root', user: 'root' });
  assert.match(lastReply(h), /已切换到《Alpha 任务》/);
  await h.send('操作别人的会话', { chat: 'root', user: 'root' });
  assert.equal(h.ctx.prompts.at(-1).sessionId, 's1');
  assert.equal(h.store.get('user:root').sessionId, '', 'their own row has no Session yet: the switch took precedence');
  assert.equal(h.ctx.creates.length, 0, 'no Session was created while they were switched elsewhere');
  await h.send('/reset', { chat: 'root', user: 'root' });
  assert.match(lastReply(h), /已放弃切换/);
  await h.send('回自己的会话', { chat: 'root', user: 'root' });
  assert.equal(h.ctx.prompts.at(-1).sessionId, 'session-created-1');
  assert.equal(h.store.get('user:root').sessionId, 'session-created-1');
  h.stop();
});

test('an administrator may quote a notice to jump to that Session; a bad quote changes nothing', async () => {
  const h = await harness({ adminUserIds: ['root'] }, {
    workspaces: [{ id: 'w1', path: '/w/alpha', title: 'Alpha', sessionIds: ['s1', 's2'] }],
  }, { members: [] });
  await h.send('/use s2', { chat: 'root', user: 'root' });
  assert.match(lastReply(h), /已切换到《Beta 任务》/);
  await h.send('继续', { chat: 'root', user: 'root' });
  assert.equal(h.ctx.prompts.at(-1).sessionId, 's2');
  await h.send('继续', { chat: 'root', user: 'root', quote: '> 发送 /use zzzzzz999999 可定位到该会话。' });
  assert.equal(h.ctx.prompts.at(-1).sessionId, 's2', 'an unresolvable quote keeps the selection');
  assert.equal(h.journal.find('wecom.quote').at(-1).outcome, 'not-found');
  h.stop();
});

test('/new drops the bound Session so the next message starts a fresh one', async () => {
  const h = await harness();
  await h.send('第一条');
  assert.equal(h.store.get('user:alice').sessionId, 'session-created-1');
  await h.send('/new');
  assert.match(lastReply(h), /新的专属会话/);
  assert.equal(h.store.get('user:alice').sessionId, '');
  assert.equal(h.ctx.creates.length, 1);
  await h.send('第二条');
  assert.equal(h.ctx.creates.length, 2);
  assert.equal(h.ctx.prompts.at(-1).sessionId, 'session-created-2');
  assert.equal(h.store.get('user:alice').sessionId, 'session-created-2');
  h.stop();
});

test('the group model is installed on a new Session and the DSH default is restored', async () => {
  const h = await harness({}, {}, {
    group: { provider: 'deepseek-account', model: 'deepseek-reasoner', reasoningEffort: 'low' },
  });
  await h.send('你好');
  assert.deepEqual(h.ctx.selections, [{
    sessionId: 'session-created-1',
    provider: 'deepseek-account', model: 'deepseek-reasoner', reasoningEffort: 'low',
  }]);
  assert.deepEqual(h.ctx.defaultSaves, [{ provider: 'deepseek-account', model: 'deepseek-chat' }],
    'the operator\'s own DSH default model is put back');
  h.stop();
});

test('every member of a group shares its Workspace and model', async () => {
  const h = await harness({}, {}, {
    group: { workspace: TEST_WORKSPACE_PATH, provider: 'deepseek-account', model: 'deepseek-reasoner' },
    members: [['user', 'alice'], ['user', 'bob']],
  });
  await h.send('你好');
  await h.send('你好', { chat: 'bob', user: 'bob' });
  assert.deepEqual(h.ctx.selections.map(selection => selection.model), ['deepseek-reasoner', 'deepseek-reasoner']);
  assert.deepEqual(h.ctx.creates.map(create => create.workspaceId), ['w1', 'w1']);

  // A later model change is applied to the Sessions the group already owns.
  await h.setGroup({ model: 'deepseek-chat' });
  await h.send('再来');
  assert.equal(h.ctx.selections.at(-1).model, 'deepseek-chat');
  assert.equal(h.ctx.selections.at(-1).sessionId, 'session-created-1');
  h.stop();
});

test('a group with no model leaves the DSH default alone', async () => {
  const h = await harness();
  await h.send('你好');
  assert.deepEqual(h.ctx.selections, []);
  assert.deepEqual(h.ctx.defaultSaves, []);
  h.stop();
});

test('a leading @mention in a group message is stripped before routing and prompting', async () => {
  const h = await harness({}, {}, { members: [['group', 'group-1']] });
  await h.send('@DSH 继续工作吧', { chat: 'group-1', user: 'alice' });
  assert.deepEqual(h.ctx.prompts.at(-1).content, [{ type: 'text', text: '继续工作吧' }]);
  await h.send('@DSH /new', { chat: 'group-1', user: 'alice' });
  assert.match(lastReply(h), /新的专属会话/);
  h.stop();
});

test('a group message that is only a mention has nothing left after stripping', async () => {
  const h = await harness({}, {}, { members: [['group', 'group-1']] });
  await h.send('@DSH', { chat: 'group-1', user: 'alice' });
  assert.match(lastReply(h), /消息内容为空/);
  h.stop();
});

test('a single question is answered from the bound chat with the short code', async () => {
  const h = await harness();
  h.client.emit('authenticated');
  await h.send('hi');
  let delegated = 0;
  const ask = h.bridge.onQuestion({
    agent: { id: 'session-created-1' },
    questions: [{ id: 'choice', question: 'Pick one?', options: [{ label: 'yes' }, { label: 'no' }] }],
  }, async () => { delegated++; return { answers: [] }; });
  await settle();
  const notice = h.client.sends.at(-1).body.markdown.content;
  const code = notice.match(/\/answer ([a-z0-9]{6}) /)?.[1];
  assert.ok(code, notice);
  await h.send(`/answer ${code} 2`);
  assert.deepEqual(await ask, { answers: [{ id: 'choice', selected: ['no'] }] });
  assert.equal(delegated, 0);
  h.stop();
});

test('an unanswered question falls back to the DSH page', async () => {
  const h = await harness({ questionTimeoutMs: 20 });
  await h.send('hi');
  const result = await h.bridge.onQuestion({
    agent: { id: 'session-created-1' }, questions: [{ id: 'q', question: 'Q?' }],
  }, async () => ({ answers: [{ id: 'q', selected: [], custom: 'DSH' }] }));
  assert.equal(result.answers[0].custom, 'DSH');
  h.stop();
});

test('a stale code can never answer a newer question with the same id', async () => {
  const h = await harness();
  h.client.emit('authenticated');
  await h.send('hi');
  const request = { agent: { id: 'session-created-1' }, questions: [{ id: 'same', question: 'Again?' }] };
  const first = h.bridge.onQuestion(request, async () => ({ answers: [] }));
  await settle();
  const firstCode = h.client.sends.at(-1).body.markdown.content.match(/\/answer ([a-z0-9]{6})/)[1];
  await h.send(`/answer ${firstCode} first answer`);
  assert.equal((await first).answers[0].custom, 'first answer');
  const second = h.bridge.onQuestion(request, async () => ({ answers: [] }));
  await settle();
  const secondCode = h.client.sends.at(-1).body.markdown.content.match(/\/answer ([a-z0-9]{6})/)[1];
  assert.notEqual(secondCode, firstCode);
  await h.send(`/answer ${firstCode} stale`);
  assert.match(lastReply(h), /没有对应的待回答提问/);
  await h.send(`/answer ${secondCode} fresh`);
  assert.equal((await second).answers[0].custom, 'fresh');
  h.stop();
});

test('plan reviews and hidden details stay in DSH and are only announced', async () => {
  const h = await harness();
  h.client.emit('authenticated');
  await h.send('hi');
  const result = await h.bridge.onQuestion({ agent: { id: 'session-created-1' },
    questions: [{ id: 'plan', question: 'Approve?', intent: { kind: 'plan-review', approve: 'yes' }, detail: 'secret plan content' }] },
  async () => ({ answers: [{ id: 'plan', selected: ['DSH'] }] }));
  assert.deepEqual(result.answers, [{ id: 'plan', selected: ['DSH'] }]);
  await settle();
  assert.match(h.client.sends.at(-1).body.markdown.content, /DSH 页面/);
  assert.doesNotMatch(h.client.sends.at(-1).body.markdown.content, /secret plan/);
  h.stop();
});

test('remote approval is off by default and never available to a group', async () => {
  const off = await harness();
  await off.send('hi');
  assert.equal(await off.bridge.onApproval({ agent: { id: 'session-created-1' }, toolName: 'bash' }, async () => 'rejected'), 'rejected');
  off.stop();

  const group = await harness({ remoteApprovals: true }, {}, { members: [['group', 'group-1']] });
  await group.send('hi', { chat: 'group-1', user: 'alice' });
  assert.equal(await group.bridge.onApproval(
    { agent: { id: 'session-created-1' }, toolName: 'bash' }, async () => 'unavailable',
  ), 'unavailable', 'a group is only told about the request');
  group.stop();
});

test('each remote approval has a fresh code; an old code cannot approve a later call', async () => {
  const h = await harness({ remoteApprovals: true });
  h.client.emit('authenticated');
  await h.send('hi');
  const first = h.bridge.onApproval({ agent: { id: 'session-created-1' }, toolName: 'bash', callId: 'first' }, async () => 'unavailable');
  await settle();
  const firstCode = h.client.sends.at(-1).body.markdown.content.match(/\/approve ([a-z0-9]{6})/)[1];
  await h.send(`/deny ${firstCode}`);
  assert.equal(await first, 'rejected');
  const second = h.bridge.onApproval({ agent: { id: 'session-created-1' }, toolName: 'bash', callId: 'second' }, async () => 'unavailable');
  await settle();
  const secondCode = h.client.sends.at(-1).body.markdown.content.match(/\/approve ([a-z0-9]{6})/)[1];
  assert.notEqual(secondCode, firstCode);
  await h.send(`/approve ${firstCode}`);
  assert.match(lastReply(h), /没有可在此单聊审批的请求/);
  await h.send(`/approve ${secondCode}`, { chat: 'group-1', user: 'alice' });
  assert.match(lastReply(h), /没有可在此单聊审批/);
  await h.send(`/approve ${secondCode}`);
  assert.equal(await second, 'allowed-once');
  h.stop();
});

test('every per-Session notice carries a /use token that resolves back to it', async () => {
  const h = await harness({ adminUserIds: ['root'] }, {
    workspaces: [{ id: 'w1', path: '/w/alpha', title: 'Alpha', sessionIds: ['s2'] }],
  });
  h.client.emit('authenticated');
  await h.endTurn('s2', { text: '完成' });
  const text = h.client.sends.at(-1).body.markdown.content;
  const token = extractSessionPointer(text);
  assert.ok(token, 'the notice carries a /use hint');
  assert.notEqual(token, 'session-');
  h.stop();
});

test('a prompt round records the request, the reply, the DSH response and the turn metadata', async () => {
  const h = await harness();
  h.client.emit('authenticated');
  await h.send('请修复登录');
  const requestId = h.ctx.prompts[0].requestId;
  assert.equal(h.rounds.hasPending('session-created-1'), true);
  await h.endTurn('session-created-1', { text: '已修复', promptIds: [requestId] });
  const round = h.journal.find('round.complete').at(-1);
  assert.equal(round.outcome, 'turn-ended');
  assert.equal(round.sessionId, 'session-created-1');
  assert.equal(round.request.text, '请修复登录');
  assert.equal(round.response.assistant, '已修复');
  assert.match(round.response.replies[0], /已提交给 DSH/);
  assert.deepEqual(round.response.notifiedChats, ['alice']);
  assert.deepEqual(round.metadata.toolCalls, { bash: 1 });
  assert.equal(round.metadata.turnDurationMs, 3000);
  const inbound = h.journal.find('wecom.message')[0];
  assert.equal(inbound.frame.body.response_url, '[redacted]');
  assert.equal(h.rounds.hasPending('session-created-1'), false);
  h.stop();
});

test('an accepted message is never kept in memory, and refused text is bounded', async () => {
  const h = await harness();
  await h.send('secret accepted text');
  assert.equal(JSON.stringify(h.observations.rejected(() => false)).includes('secret accepted text'), false);
  await h.send('x'.repeat(500), { chat: 'mallory', user: 'mallory' });
  const [row] = h.observations.rejected(() => false);
  assert.equal(row.id, 'mallory');
  assert.equal(row.text.length, 121, 'a bounded excerpt plus the ellipsis');
  assert.equal(Object.isFrozen(row), true);
  h.stop();
});

test('stopping during the passive reply prevents a stale prompt', async () => {
  const h = await harness();
  let release;
  h.client.replyStream = () => new Promise(resolve => { release = resolve; });
  h.client.emit('message', frame('do not run after stop'));
  // Wait for the bridge to actually be mid-reply instead of guessing a tick
  // count: a slower filesystem needs more turns to get there.
  assert.ok(await until(() => typeof release === 'function'), 'the bridge is holding the reply');
  h.stop();
  release({});
  await h.bridge.whenIdle();
  await settle();
  assert.equal(h.ctx.prompts.length, 0);
});

test('a group Workspace that cannot be resolved answers with an explanation instead of prompting', async () => {
  const h = await harness({}, {}, { group: { workspace: '/definitely/not/here' } });
  await h.send('你好');
  assert.equal(h.ctx.prompts.length, 0);
  assert.equal(h.ctx.creates.length, 0);
  assert.match(lastReply(h), /无法在分组「默认分组」的 Workspace 中创建会话/);
  assert.equal(h.journal.find('round.complete').at(-1).outcome, 'blocked');
  h.stop();
});

test('/whoami reports the group a sender belongs to', async () => {
  const h = await harness({}, {}, { members: [['user', 'alice', { label: '爱丽丝' }]] });
  await h.send('/whoami');
  assert.match(lastReply(h), /- \*\*分组\*\*：默认分组/);
  assert.match(lastReply(h), /alice/);
  h.stop();
});
