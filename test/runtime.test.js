import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply, Config, inject } from '../dist/host/index.js';
import { createRuntime } from '../dist/host/runtime.js';
import { fakeClient, fakeHost, finishedSession, frame, memoryJournal, settle, until } from './helpers.js';

// Every runtime in this file must own a throwaway DSH home: the routing store
// writes <DSH home>/wecom-bot/bindings.json next to the real plugin's data.
// Tests that persist groups or members get one of their own, so they never see
// each other's file.
const HOME = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-home-')));
process.env.DSH_HOME = HOME;

/** Run one test against a private DSH home. */
async function withHome(run) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-home-')));
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    return await run(home);
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous;
  }
}

function hostWithServices(overrides = {}) {
  const ctx = fakeHost({
    workspaces: [{ id: 'w1', path: '/w/alpha', title: 'Alpha', sessionIds: ['s1'] }],
  });
  const routes = new Map();
  const reads = [];
  Object.assign(ctx, {
    logger: () => ({ info() {}, warn() {}, error() {} }),
    connection: {
      fetch: {
        register(route) { routes.set(route.path, route); return async () => { routes.delete(route.path); }; },
      },
    },
    credentials: { async resolve(ref) { reads.push(ref); return { value: 'TOP-SECRET-VALUE' }; } },
    ...overrides,
  });
  return { ctx, reads, routes };
}

const silent = { info() {}, warn() {}, error() {} };
const post = (ops) => new Request('http://localhost/api/wecom-bot/routing', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ops }),
});

test('Config carries policy only: connection, administrators and advanced knobs', () => {
  const config = Config({});
  assert.equal(config.botId.get(), '');
  assert.equal(config.secretEnv.get(), 'WECOM_BOT_SECRET');
  for (const key of ['adminUserIds', 'adminWorkspaces']) assert.deepEqual(config[key].get(), [], key);
  assert.equal(config.remoteApprovals.get(), false);
  assert.equal(config.logEnabled.get(), true);
  assert.equal(config.logRetentionDays.get(), 14);
  assert.equal('secret' in config, false);
  for (const gone of ['chatIds', 'allowedUserIds', 'defaultWorkspace', 'defaultProvider', 'defaultModel', 'defaultReasoningEffort']) {
    assert.equal(gone in config, false, `${gone} moved to the routing store`);
  }
  assert.deepEqual(inject, ['credentials', 'sessionController', 'connection']);
});

test('a plaintext or credentialed WebSocket URL is refused before the Secret is read', async () => {
  const { ctx, reads } = hostWithServices();
  const journal = memoryJournal();
  const runtime = createRuntime({
    ctx, journal, log: silent,
    config: Config({ botId: 'bot', wsUrl: 'ws://plaintext.example' }),
    createClient: () => assert.fail('must not connect'),
  });
  await runtime.start();
  assert.deepEqual(reads, []);
  assert.equal(runtime.status.connection().phase, 'invalid');
  await runtime.stop();
});

test('runtime connects with the resolved Secret, never logs it, and serves the full state', () => withHome(async home => {
  const { ctx } = hostWithServices();
  const client = fakeClient();
  let options;
  const journal = memoryJournal(['TOP-SECRET-VALUE']);
  const runtime = createRuntime({
    ctx, journal, log: silent,
    config: Config({ botId: 'bot', adminUserIds: ['root'] }),
    createClient: value => { options = value; return client; },
  });
  await runtime.start();
  await runtime.store.load();
  await runtime.store.updateGroup('default', { provider: 'deepseek-account', model: 'deepseek-reasoner' });
  await runtime.store.create('user', 'alice', { groupId: 'default' });
  assert.equal(options.secret, 'TOP-SECRET-VALUE');
  assert.equal(runtime.status.connection().phase, 'connecting');
  client.emit('authenticated');
  assert.equal(runtime.status.connection().phase, 'online');
  options.logger.error('Authentication failed: errcode=1, errmsg=bad TOP-SECRET-VALUE');
  assert.match(runtime.status.connection().detail, /认证失败/);
  assert.doesNotMatch(runtime.status.connection().detail, /TOP-SECRET-VALUE/);
  const applied = journal.find('config.applied')[0];
  assert.equal(applied.secretConfigured, true);
  assert.deepEqual(applied.adminUserIds, ['root']);
  assert.equal(JSON.stringify(journal.records).includes('TOP-SECRET-VALUE'), false);

  client.emit('message', frame('hi', { chat: 'alice', user: 'alice' }));
  await until(() => ctx.prompts.length > 0);
  // A Session is "blank" until its first turn starts, so DSH hides it from the
  // catalog; the page's first read (and its refresh button) force the rebuild.
  const cached = await runtime.state();
  assert.deepEqual(cached.sessions.groups.map(group => group.title), ['Alpha', '未分组'],
    'the blank Session is hidden until the turn starts');
  const state = await runtime.state({ refresh: true });
  assert.equal(state.version, 4);
  assert.deepEqual(state.sessions.groups.map(group => group.title).sort(), ['Alpha', '未分组', '企业微信'].sort());
  assert.deepEqual(state.rejected, []);
  assert.equal(state.traffic.prompts, 1, 'the first message created a Session and prompted it');
  const [group] = state.routing.groups;
  assert.equal(group.id, 'default');
  assert.equal(group.isDefault, true);
  assert.equal(group.name, '默认分组');
  assert.equal(group.memberCount, 1);
  assert.equal(group.workspacePath, join(home, 'wecom-bot', 'workspace'));
  assert.equal(group.effectiveModel, 'deepseek-reasoner');
  const [member] = group.members;
  assert.equal(member.key, 'user:alice');
  assert.equal(member.sessionState, 'bound');
  assert.equal(member.sessionId, ctx.prompts[0].sessionId);
  assert.equal(member.sessionModel.provider, 'deepseek-account');
  assert.deepEqual(state.models.choices.map(choice => choice.model), ['deepseek-chat', 'deepseek-reasoner']);
  assert.deepEqual(state.admins, [{ id: 'root', label: '', displayName: 'root' }]);
  assert.deepEqual(state.workspaces.map(workspace => workspace.title).sort(), ['Alpha', '企业微信'].sort());
  assert.deepEqual(state.notices, ['已配置管理员但未限定 Workspace：管理员会收到所有 Workspace 的会话通知。']);
  await runtime.stop();
}));

test('the routing route creates groups, authorizes senders and validates every edit', () => withHome(async home => {
  {
    const { ctx, routes } = hostWithServices();
    ctx.effect = fn => { void fn(); };
    // No Bot ID: this test exercises the routes, and an unconfigured plugin
    // never builds a client (a real one would dial the WeCom endpoint).
    apply(ctx, Config({}));
    await settle();
    const route = routes.get('/api/wecom-bot/routing');
    assert.ok(route, 'the routing route is registered');
    assert.deepEqual(route.methods, ['POST']);

    const created = await route.fetch(post([{ op: 'member.add', groupId: 'default', kind: 'user', id: 'ZhangSan', label: ' 张三 ' }]));
    assert.equal(created.status, 200);
    const body = await created.json();
    assert.equal(body.ok, true);
    assert.equal(body.routing.total, 1);
    const [member] = body.routing.groups[0].members;
    assert.equal(member.key, 'user:ZhangSan');
    assert.equal(member.displayName, '张三');
    assert.equal(member.sessionState, 'auto');
    assert.equal(body.routing.groups[0].workspaceTitle, '企业微信');
    assert.equal(body.routing.groups[0].workspacePath, join(home, 'wecom-bot', 'workspace'));

    // The default group's Workspace can be pointed at an existing directory.
    const moved = await route.fetch(post([{ op: 'group.update', id: 'default', patch: { workspace: home } }]));
    assert.equal(moved.status, 200);
    assert.equal((await moved.json()).routing.groups[0].workspacePath, home);
    assert.equal(ctx.registry.rows.at(-1).path, home, 'the Workspace was registered on demand');

    // A second group, and a member moved into it.
    const grouped = await route.fetch(post([{ op: 'group.add', name: '朋友' }]));
    const added = await grouped.json();
    const guests = added.routing.groups.find(item => item.name === '朋友');
    assert.ok(guests, 'the new group is in the response');
    const movedMember = await route.fetch(post([{ op: 'member.update', key: 'user:ZhangSan', patch: { groupId: guests.id } }]));
    assert.equal(movedMember.status, 200);
    const routing = (await movedMember.json()).routing;
    assert.deepEqual(routing.groups.map(item => [item.name, item.memberCount]), [['默认分组', 0], ['朋友', 1]]);

    // Unknown Workspaces, groups, members and models are refused with an explanation.
    const badWorkspace = await route.fetch(post([{ op: 'group.update', id: 'default', patch: { workspace: '/does/not/exist' } }]));
    assert.equal(badWorkspace.status, 422);
    assert.match((await badWorkspace.json()).error, /Workspace 目录不存在/);
    const unknownGroup = await route.fetch(post([{ op: 'member.update', key: 'user:ZhangSan', patch: { groupId: 'nope' } }]));
    assert.equal(unknownGroup.status, 422);
    assert.match((await unknownGroup.json()).error, /分组不存在/);
    const unknownMember = await route.fetch(post([{ op: 'member.update', key: 'user:nobody', patch: { sessionId: 'x' } }]));
    assert.equal(unknownMember.status, 422);
    assert.match((await unknownMember.json()).error, /成员不存在/);
    const unknownModel = await route.fetch(post([{ op: 'group.update', id: 'default', patch: { provider: 'nope', model: 'nope' } }]));
    assert.equal(unknownModel.status, 422);
    assert.match((await unknownModel.json()).error, /DSH 当前没有模型/);
    const halfModel = await route.fetch(post([{ op: 'group.update', id: 'default', patch: { provider: 'deepseek-account' } }]));
    assert.equal(halfModel.status, 422);
    assert.match((await halfModel.json()).error, /请同时选择服务商与模型/);
    const defaultDelete = await route.fetch(post([{ op: 'group.delete', id: 'default' }]));
    assert.equal(defaultDelete.status, 422);
    assert.match((await defaultDelete.json()).error, /默认分组不能删除/);

    // Malformed bodies never reach the store.
    assert.equal((await route.fetch(new Request('http://localhost/api/wecom-bot/routing', { method: 'POST', body: 'nope' }))).status, 400);
    assert.equal((await route.fetch(post([]))).status, 400);
    assert.equal((await route.fetch(post([{ op: 'explode' }]))).status, 400);

    const removed = await route.fetch(post([{ op: 'member.remove', key: 'user:ZhangSan' }]));
    assert.equal(removed.status, 200);
    assert.equal((await removed.json()).routing.total, 0);

    // Whatever the page did, it is durable.
    const stored = JSON.parse(await readFile(join(home, 'wecom-bot', 'bindings.json'), 'utf8'));
    assert.equal(stored.version, 4);
    assert.deepEqual(stored.groups.map(item => item.name), ['默认分组', '朋友']);
    assert.deepEqual(stored.bindings, []);
  }
}));

test('changing a group Workspace drops the Sessions it used to own', () => withHome(async home => {
  {
    const { ctx, routes } = hostWithServices();
    ctx.effect = fn => { void fn(); };
    apply(ctx, Config({}));
    await settle();
    const route = routes.get('/api/wecom-bot/routing');
    await route.fetch(post([
      { op: 'member.add', groupId: 'default', kind: 'user', id: 'alice' },
      { op: 'member.update', key: 'user:alice', patch: { sessionId: 'session-1' } },
    ]));
    const moved = await route.fetch(post([{ op: 'group.update', id: 'default', patch: { workspace: home } }]));
    assert.equal((await moved.json()).routing.groups[0].members[0].sessionId, '');
  }
}));

test('the Host-level session listener completes rounds even across a bridge rebuild', () => withHome(async () => {
  const { ctx } = hostWithServices();
  const clients = [];
  const journal = memoryJournal();
  let botId = 'bot';
  const stored = Config({});
  const config = new Proxy(stored, { get: (target, key) => (key === 'botId' ? { get: () => botId } : target[key]) });
  const runtime = createRuntime({
    ctx, journal, log: silent, config,
    createClient: () => { const client = fakeClient(); clients.push(client); return client; },
  });
  await runtime.start();
  await runtime.store.load();
  await runtime.store.create('user', 'alice', { groupId: 'default' });
  clients[0].emit('message', frame('build it', { chat: 'alice', user: 'alice' }));
  await until(() => ctx.prompts.length > 0);
  const requestId = ctx.prompts[0].requestId;
  const sessionId = ctx.prompts[0].sessionId;
  botId = 'bot-2';
  ctx.handlers.get('app-boot/config-reload')();
  await settle();
  assert.equal(clients.length, 2, 'the bridge was rebuilt');
  const { session, end } = finishedSession(sessionId, { promptIds: [requestId], text: 'built' });
  ctx.handlers.get('session/event')(session, end);
  await until(() => journal.find('round.complete').some(record => record.requestId === requestId));
  const round = journal.find('round.complete').find(record => record.requestId === requestId);
  assert.equal(round.outcome, 'turn-ended', 'the round survived the rebuild');
  assert.equal(round.response.assistant, 'built');
  await runtime.stop();}));

test('a finished turn reaches the conversation bound to the Session and lands in the journal', () => withHome(async () => {
  const { ctx } = hostWithServices();
  const client = fakeClient();
  const journal = memoryJournal();
  const runtime = createRuntime({ ctx, journal, log: silent, config: Config({ botId: 'bot' }), createClient: () => client });
  await runtime.start();
  await runtime.store.load();
  await runtime.store.create('user', 'alice', { groupId: 'default' });
  client.emit('authenticated');
  client.emit('message', frame('build it', { chat: 'alice', user: 'alice' }));
  await until(() => ctx.prompts.length > 0);
  const requestId = ctx.prompts[0].requestId;
  const sessionId = ctx.prompts[0].sessionId;
  const { session, end } = finishedSession(sessionId, { promptIds: [requestId], text: 'built' });
  ctx.handlers.get('session/event')(session, end);
  await until(() => client.sends.length > 0);
  await until(() => journal.find('round.complete').some(record => record.requestId === requestId));
  const round = journal.find('round.complete').find(record => record.requestId === requestId);
  assert.equal(round.outcome, 'turn-ended');
  assert.equal(round.response.assistant, 'built');
  assert.deepEqual(round.response.notifiedChats, ['alice']);
  assert.deepEqual(client.sends.map(send => send.chat), ['alice']);
  await runtime.stop();}));

test('a refused sender shows up in the state view until the page authorizes it', () => withHome(async () => {
  const { ctx } = hostWithServices();
  const client = fakeClient();
  const runtime = createRuntime({ ctx, journal: memoryJournal(), log: silent, config: Config({ botId: 'bot' }), createClient: () => client });
  await runtime.start();
  client.emit('authenticated');
  client.emit('message', frame('我是新来的', { chat: 'mallory', user: 'mallory' }));
  await until(() => runtime.observations.rejected(() => false).length > 0);
  const before = await runtime.state();
  assert.deepEqual(before.rejected.map(row => [row.key, row.text]), [['user:mallory', '我是新来的']]);
  assert.deepEqual(before.routing.groups[0].members, []);
  assert.deepEqual(before.notices, ['还没有任何成员：给机器人发消息的人会出现在「未授权用户」里，把它加入分组即可授权。']);

  await runtime.applyRouting([{ op: 'member.add', groupId: 'default', kind: 'user', id: 'mallory', label: '市场部小李' }]);
  const after = await runtime.state();
  assert.deepEqual(after.rejected, [], 'the row disappears once the sender is a member');
  assert.deepEqual(after.routing.groups[0].members.map(member => member.displayName), ['市场部小李']);
  assert.deepEqual(after.notices, []);
  await runtime.stop();}));

test('apply registers the authenticated routes and writes the journal under DSH_HOME', () => withHome(async home => {
  {
    const { ctx, routes } = hostWithServices();
    let setup;
    ctx.effect = fn => { setup = fn(); };
    apply(ctx, Config({}));
    const dispose = await setup;
    const state = routes.get('/api/wecom-bot/state');
    assert.equal(state.path, '/api/wecom-bot/state');
    assert.deepEqual(state.methods, ['GET']);
    assert.ok(routes.get('/api/wecom-bot/routing'), 'both routes are registered');
    const response = await state.fetch(new Request('http://localhost/api/wecom-bot/state?refresh=1'));
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.json();
    assert.equal(body.connection.phase, 'unconfigured');
    assert.equal(body.connection.detail, '缺少 Bot ID');
    assert.equal(body.journal.directory, join(home, 'wecom-bot', 'logs'));
    assert.equal(body.routing.total, 0);
    assert.deepEqual(body.routing.groups.map(group => group.name), ['默认分组']);
    assert.equal(body.routing.groups[0].workspacePath, join(home, 'wecom-bot', 'workspace'));
    assert.deepEqual(body.rejected, []);
    await dispose();
    assert.equal(routes.get('/api/wecom-bot/state'), undefined);
    assert.equal(routes.get('/api/wecom-bot/routing'), undefined);
    const lines = (await readFile(body.journal.file, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(lines.map(line => line.event).filter(event => event.startsWith('plugin.')), ['plugin.start', 'plugin.stop']);
  }
}));
