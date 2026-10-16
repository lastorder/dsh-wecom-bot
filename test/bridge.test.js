import test from 'node:test';
import assert from 'node:assert/strict';
import { createBridge } from '../dist/host/bridge/index.js';
import { createCatalogService } from '../dist/host/catalog.js';
import { createObservationStore } from '../dist/host/observation.js';
import { createRoundTracker } from '../dist/host/rounds.js';
import { summarizeTurn } from '../dist/host/turns.js';
import {
  baseSettings, fakeClient, fakeHost, finishedSession, frame, memoryJournal, settle,
} from './helpers.js';

function harness(settings = {}, hostOptions = {}, extra = {}) {
  const ctx = fakeHost(hostOptions);
  const client = fakeClient();
  const journal = memoryJournal();
  const observations = extra.observations ?? createObservationStore();
  const rounds = createRoundTracker({ journal });
  const catalogs = createCatalogService({
    list: async signal => (await ctx.sessionController.list({}, signal)).items,
    registry: () => ctx.registry,
  }, { ttlMs: 0 });
  const bridge = createBridge({
    ctx, client, journal, observations, rounds, catalogs,
    settings: { ...baseSettings, ...settings },
    log: { warn() {}, error() {}, info() {} },
  });
  const stop = bridge.start();
  const send = async (content, options) => { client.emit('message', frame(content, options)); await settle(); };
  const endTurn = async (sessionId, options = {}) => {
    const { session, end } = finishedSession(sessionId, options);
    const chats = await bridge.onTurnEnd(session, end, () => summarizeTurn(session, end));
    rounds.onTurnEnd(summarizeTurn(session, end), chats);
    await settle();
    return chats;
  };
  return { ctx, client, journal, bridge, stop, send, endTurn, rounds, observations };
}

const lastReply = h => h.client.replies.at(-1)?.content ?? '';

test('turn completion is sent only to allowlisted conversations, after authentication, without reasoning', async () => {
  const h = harness({ chatIds: ['alice', 'group'], sessionIds: ['s1'] });
  const chats = await h.endTurn('s1', { text: '修复完成' });
  assert.deepEqual(chats, ['alice', 'group']);
  assert.equal(h.client.sends.length, 0, 'nothing is sent before authentication');
  h.client.emit('authenticated');
  await settle();
  assert.deepEqual(h.client.sends.map(s => s.chat), ['alice', 'group']);
  const text = h.client.sends[0].body.markdown.content;
  assert.match(text, /修复完成/);
  assert.match(text, /Alpha 任务/, 'notification names the Session title');
  assert.doesNotMatch(text, /private reasoning/);
  assert.equal(h.journal.find('wecom.send').length, 2);
  h.stop();
});

test('messages need both the user and the conversation allowlists, and the right Bot', async () => {
  const h = harness({ chatIds: ['alice', 'group'], allowedUserIds: ['alice'], sessionIds: ['s1'] });
  await h.send('hello', { chat: 'group', user: 'mallory' });
  await h.send('hello', { chat: 'unknown', user: 'alice' });
  await h.send('hello', { bot: 'other' });
  assert.equal(h.ctx.prompts.length, 0);
  assert.equal(h.client.replies.length, 0, 'rejected senders get no reply at all');
  const rejected = h.journal.find('round.complete').filter(r => r.outcome === 'rejected');
  assert.deepEqual(rejected.map(r => r.response.reason), ['user', 'chat']);
  h.stop();
});

test('/use then a plain message queues a prompt once; replays are ignored; /cancel targets the selection', async () => {
  const h = harness({ sessionIds: ['s1', 's2'] });
  await h.send('/use s2');
  assert.match(lastReply(h), /Beta 任务/);
  const f = frame('Do the work');
  h.client.emit('message', f);
  h.client.emit('message', f);
  await settle();
  assert.equal(h.ctx.prompts.length, 1);
  assert.equal(h.ctx.prompts[0].sessionId, 's2');
  assert.equal(h.ctx.prompts[0].mode, 'queue');
  assert.deepEqual(h.ctx.prompts[0].content, [{ type: 'text', text: 'Do the work' }]);
  assert.equal(h.client.replies.at(-1).frame.headers.req_id, f.headers.req_id);
  await h.send('/cancel');
  assert.deepEqual(h.ctx.cancels, [{ sessionId: 's2' }]);
  h.stop();
});

test('/sessions groups by Workspace, shows titles first, hides archived/subagent/blank, and /use accepts the index', async () => {
  const h = harness({}, {
    sessions: [
      { sessionId: 'aaaa1111-0000', updatedAt: 10, projections: { values: { title: '旧任务' } } },
      { sessionId: 'bbbb2222-0000', updatedAt: 30, projections: { values: { title: '新任务' } } },
      { sessionId: 'cccc3333-0000', updatedAt: 40, projections: { values: { title: '已归档任务' } } },
      { sessionId: 'dddd4444-0000', updatedAt: 50, origin: 'subagent' },
      { sessionId: 'eeee5555-0000', updatedAt: 60, blank: true },
      { sessionId: 'ffff6666-0000', updatedAt: 70 },
    ],
    workspaces: [{ id: 'w1', path: '/repo/app', title: 'App', sessionIds: ['aaaa1111-0000', 'bbbb2222-0000', 'cccc3333-0000', 'dddd4444-0000'] }],
    archived: ['cccc3333-0000'],
  });
  await h.send('/sessions');
  const text = lastReply(h);
  assert.match(text, /📁 App\n  1\. 新任务 .*\n  2\. 旧任务/);
  assert.match(text, /📁 未分组\n  3\. 未命名会话/);
  assert.doesNotMatch(text, /已归档任务|dddd4444|eeee5555/);
  assert.ok(text.indexOf('新任务') < text.indexOf('bbbb2222'), 'title precedes the id');
  await h.send('/use 2');
  assert.match(lastReply(h), /已选择《旧任务》/);
  await h.send('/use cccc3333-0000');
  assert.match(lastReply(h), /已归档/);
  await h.send('继续');
  assert.equal(h.ctx.prompts.at(-1).sessionId, 'aaaa1111-0000');
  h.stop();
});

test('a single-question request is answered with the short code and an option number', async () => {
  const h = harness({ sessionIds: ['s1'], chatIds: ['alice'] });
  h.client.emit('authenticated');
  let delegated = 0;
  const ask = h.bridge.onQuestion({
    agent: { id: 's1' }, questions: [{ id: 'choice', question: 'Pick one?', options: [{ label: 'yes' }, { label: 'no' }] }],
  }, async () => { delegated++; return { answers: [] }; });
  await settle();
  const notice = h.client.sends.at(-1).body.markdown.content;
  const code = notice.match(/\/answer ([a-z0-9]{6}) /)?.[1];
  assert.ok(code, notice);
  await h.send(`/answer ${code} 2`);
  assert.deepEqual(await ask, { answers: [{ id: 'choice', selected: ['no'] }] });
  assert.equal(delegated, 0);
  assert.match(lastReply(h), /已提交/);
  h.stop();
});

test('an unanswered question falls back to the DSH page', async () => {
  const h = harness({ sessionIds: ['s1'], chatIds: ['alice'], questionTimeoutMs: 20 });
  const result = await h.bridge.onQuestion({ agent: { id: 's1' }, questions: [{ id: 'q', question: 'Q?' }] },
    async () => ({ answers: [{ id: 'q', selected: [], custom: 'DSH' }] }));
  assert.equal(result.answers[0].custom, 'DSH');
  h.stop();
});

test('a stale code can never answer a newer question with the same id', async () => {
  const h = harness({ sessionIds: ['s1'], chatIds: ['alice'] });
  h.client.emit('authenticated');
  const request = { agent: { id: 's1' }, questions: [{ id: 'same', question: 'Again?' }] };
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
  assert.match(lastReply(h), /验证码无效/);
  await h.send(`/answer ${secondCode} fresh`);
  assert.equal((await second).answers[0].custom, 'fresh');
  h.stop();
});

test('plan reviews and hidden details stay in DSH and are only announced', async () => {
  const h = harness({ sessionIds: ['s1'], chatIds: ['alice'] });
  h.client.emit('authenticated');
  const result = await h.bridge.onQuestion({ agent: { id: 's1' },
    questions: [{ id: 'plan', question: 'Approve?', intent: { kind: 'plan-review', approve: 'yes' }, detail: 'secret plan content' }] },
  async () => ({ answers: [{ id: 'plan', selected: ['DSH'] }] }));
  assert.deepEqual(result.answers, [{ id: 'plan', selected: ['DSH'] }]);
  await settle();
  assert.match(h.client.sends.at(-1).body.markdown.content, /DSH 页面/);
  assert.doesNotMatch(h.client.sends.at(-1).body.markdown.content, /secret plan/);
  h.stop();
});

test('remote approval is off by default and never available to group chats', async () => {
  const off = harness({ sessionIds: ['s1'], chatIds: ['alice'] });
  assert.equal(await off.bridge.onApproval({ agent: { id: 's1' }, toolName: 'bash' }, async () => 'rejected'), 'rejected');
  off.stop();
  const group = harness({ sessionIds: ['s1'], chatIds: ['group'], remoteApprovals: true });
  assert.equal(await group.bridge.onApproval({ agent: { id: 's1' }, toolName: 'bash' }, async () => 'unavailable'), 'unavailable');
  group.stop();
});

test('each remote approval has a fresh code; an old code cannot approve a later call', async () => {
  const h = harness({ sessionIds: ['s1'], allowedUserIds: ['alice'], remoteApprovals: true });
  h.client.emit('authenticated');
  await h.send('hi'); // makes alice's single chat an eligible recipient
  const first = h.bridge.onApproval({ agent: { id: 's1' }, toolName: 'bash', callId: 'first' }, async () => 'unavailable');
  await settle();
  const firstCode = h.client.sends.at(-1).body.markdown.content.match(/\/approve ([a-z0-9]{6})/)[1];
  await h.send(`/deny ${firstCode}`);
  assert.equal(await first, 'rejected');
  const second = h.bridge.onApproval({ agent: { id: 's1' }, toolName: 'bash', callId: 'second' }, async () => 'unavailable');
  await settle();
  const secondCode = h.client.sends.at(-1).body.markdown.content.match(/\/approve ([a-z0-9]{6})/)[1];
  assert.notEqual(secondCode, firstCode);
  await h.send(`/approve ${firstCode}`);
  assert.match(lastReply(h), /验证码无效/);
  await h.send(`/approve ${secondCode}`, { chat: 'group', user: 'alice' });
  assert.match(lastReply(h), /没有可在此单聊审批/);
  await h.send(`/approve ${secondCode}`);
  assert.equal(await second, 'allowed-once');
  h.stop();
});

test('with chatIds empty a rejected-only conversation never receives notifications', async () => {
  const h = harness({ chatIds: [], sessionIds: ['s1'], allowedUserIds: ['alice'] });
  h.client.emit('authenticated');
  await h.send('unauthorized', { chat: 'rejected-group', user: 'mallory' });
  await h.send('/use s1', { chat: 'new-group', user: 'alice' });
  await h.send('accepted', { chat: 'new-group', user: 'alice' });
  assert.deepEqual(h.observations.snapshot().chats.map(c => c.id), ['new-group', 'rejected-group']);
  assert.equal(h.ctx.prompts.length, 1);
  await h.endTurn('s1');
  assert.deepEqual(h.client.sends.map(s => s.chat), ['new-group']);
  h.stop();
});

test('empty allowedUserIds accepts any sender in an allowed conversation', async () => {
  const h = harness({ chatIds: ['group'], sessionIds: ['s1'], allowedUserIds: [] });
  await h.send('any sender', { chat: 'group', user: 'mallory' });
  assert.equal(h.ctx.prompts.length, 1, 'a single allowlisted Session needs no /use');
  assert.equal(h.observations.snapshot().users[0].id, 'mallory');
  h.stop();
});

test('all filters empty: any conversation, every visible Session; subagent turns never notify', async () => {
  const h = harness({}, {
    sessions: [
      { sessionId: 's1', updatedAt: 2 },
      { sessionId: 'child', updatedAt: 3, origin: 'subagent' },
    ],
  });
  h.client.emit('authenticated');
  await h.send('/use s1', { chat: 'any-group', user: 'bob' });
  await h.send('work', { chat: 'any-group', user: 'bob' });
  assert.equal(h.ctx.prompts.at(-1).sessionId, 's1');
  assert.deepEqual(await h.endTurn('child'), []);
  assert.deepEqual(await h.endTurn('s1'), ['any-group']);
  assert.deepEqual(h.client.sends.map(s => s.chat), ['any-group']);
  h.stop();
});

test('a plain message without a selection answers with the numbered Session list', async () => {
  const h = harness();
  await h.send('hello');
  assert.equal(h.ctx.prompts.length, 0);
  assert.match(lastReply(h), /还没有选择会话/);
  assert.match(lastReply(h), /1\. Alpha 任务/);
  await h.send('/use 1');
  await h.send('hello again');
  assert.equal(h.ctx.prompts.at(-1).sessionId, 's1');
  h.stop();
});

test('rejected senders are observed with their decision, but message text is never kept in memory', async () => {
  const h = harness({ chatIds: ['allowed'], sessionIds: ['s1'], allowedUserIds: ['alice'] });
  await h.send('not stored', { chat: 'blocked', user: 'alice' });
  await h.send('not stored', { chat: 'allowed', user: 'mallory' });
  h.client.emit('message', { ...frame('x'), body: { ...frame('x').body, msgid: '' } });
  h.client.emit('message', frame('bad', { chat: 'bad\nroom', user: 'alice' }));
  h.client.emit('message', frame('bad', { user: 'x'.repeat(257), chat: 'allowed' }));
  await settle();
  const snapshot = h.observations.snapshot();
  assert.deepEqual(snapshot.users.map(u => [u.id, u.decision]), [['mallory', 'rejected'], ['alice', 'rejected']]);
  assert.deepEqual(snapshot.chats.map(c => [c.id, c.decision, c.reason]), [['allowed', 'rejected', 'user'], ['blocked', 'rejected', 'chat']]);
  assert.equal(JSON.stringify(snapshot).includes('not stored'), false);
  assert.equal(Object.isFrozen(snapshot.users), true);
  h.stop();
});

test('stopping during the passive reply prevents a stale prompt', async () => {
  const h = harness({ sessionIds: ['s1'] });
  let release;
  h.client.replyStream = () => new Promise(resolve => { release = resolve; });
  h.client.emit('message', frame('do not run after stop'));
  await settle();
  h.stop();
  release({});
  await settle();
  assert.equal(h.ctx.prompts.length, 0);
});

test('a prompt round records request, reply, DSH response and turn metadata in one round.complete line', async () => {
  const h = harness({ sessionIds: ['s1'], chatIds: ['alice'] });
  h.client.emit('authenticated');
  await h.send('请修复登录');
  const requestId = h.ctx.prompts[0].requestId;
  assert.equal(h.rounds.hasPending('s1'), true);
  await h.endTurn('s1', { text: '已修复', promptIds: [requestId] });
  const round = h.journal.find('round.complete').at(-1);
  assert.equal(round.outcome, 'turn-ended');
  assert.equal(round.sessionId, 's1');
  assert.equal(round.sessionTitle, 'Alpha 任务');
  assert.equal(round.request.text, '请修复登录');
  assert.equal(round.response.assistant, '已修复');
  assert.match(round.response.replies[0], /已提交到《Alpha 任务》/);
  assert.deepEqual(round.response.notifiedChats, ['alice']);
  assert.deepEqual(round.metadata.toolCalls, { bash: 1 });
  assert.deepEqual(round.metadata.model, { provider: 'p', model: 'm', reasoningEffort: 'high' });
  assert.equal(round.metadata.turnDurationMs, 3000);
  const inbound = h.journal.find('wecom.message')[0];
  assert.equal(inbound.frame.body.text.content, '请修复登录');
  assert.equal(inbound.frame.body.response_url, '[redacted]');
  assert.equal(h.journal.find('dsh.prompt')[0].request.requestId, requestId);
  assert.equal(h.rounds.hasPending('s1'), false);
  h.stop();
});
