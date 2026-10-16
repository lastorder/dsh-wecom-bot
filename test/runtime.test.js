import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply, Config, inject } from '../dist/host/index.js';
import { createRuntime } from '../dist/host/runtime.js';
import { fakeClient, fakeHost, finishedSession, frame, memoryJournal, settle } from './helpers.js';

// Every runtime in this file must own a throwaway DSH home: the binding store
// writes <DSH home>/wecom-bot/bindings.json next to the real plugin's data.
const HOME = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-home-')));
process.env.DSH_HOME = HOME;

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
const post = (ops) => new Request('http://localhost/api/wecom-bot/bindings', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ops }),
});

test('Config carries policy only: connection, Workspace/model defaults and administrators', () => {
  const config = Config({});
  assert.equal(config.botId.get(), '');
  assert.equal(config.secretEnv.get(), 'WECOM_BOT_SECRET');
  for (const key of ['chatIds', 'allowedUserIds', 'adminUserIds', 'adminWorkspaces']) {
    assert.deepEqual(config[key].get(), [], key);
  }
  assert.equal(config.defaultWorkspace.get(), '');
  assert.equal(config.defaultProvider.get(), '');
  assert.equal(config.defaultModel.get(), '');
  assert.equal(config.defaultReasoningEffort.get(), '');
  assert.equal(config.remoteApprovals.get(), false);
  assert.equal(config.logEnabled.get(), true);
  assert.equal(config.logRetentionDays.get(), 14);
  assert.equal('secret' in config, false);
  assert.equal('sessionIds' in config, false, 'the Session allowlist was replaced by bindings');
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

test('runtime connects with the resolved Secret, never logs it, and serves the full state', async () => {
  const { ctx } = hostWithServices();
  const client = fakeClient();
  let options;
  const journal = memoryJournal(['TOP-SECRET-VALUE']);
  const runtime = createRuntime({
    ctx, journal, log: silent,
    config: Config({ botId: 'bot', adminUserIds: ['root'], defaultModel: 'deepseek-reasoner', defaultProvider: 'deepseek-account' }),
    createClient: value => { options = value; return client; },
  });
  await runtime.start();
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
  assert.equal(applied.defaultWorkspace, join(HOME, 'wecom-bot', 'workspace'));
  assert.equal(JSON.stringify(journal.records).includes('TOP-SECRET-VALUE'), false);

  client.emit('message', frame('hi', { chat: 'alice', user: 'alice' }));
  await settle();
  // A Session is "blank" until its first turn starts, so DSH hides it from the
  // catalog; the page's first read (and its refresh button) force the rebuild.
  const cached = await runtime.state();
  assert.deepEqual(cached.sessions.groups.map(group => group.title), ['Alpha', '未分组'],
    'the blank Session is hidden until the turn starts');
  const state = await runtime.state({ refresh: true });
  assert.equal(state.version, 2);
  assert.equal(state.observed.users[0].id, 'alice');
  assert.deepEqual(state.sessions.groups.map(group => group.title).sort(), ['Alpha', '未分组', '企业微信'].sort());
  assert.deepEqual(state.observed.users.map(user => user.id), ['alice']);
  assert.equal(state.traffic.prompts, 1, 'the first message created a Session and prompted it');
  assert.deepEqual(state.bindings.items.map(binding => binding.key), ['user:alice']);
  const binding = state.bindings.items[0];
  assert.equal(binding.sessionState, 'bound');
  assert.equal(binding.sessionId, ctx.prompts[0].sessionId);
  assert.equal(binding.effectiveModel, 'deepseek-reasoner', 'the plugin default is what the binding uses');
  assert.equal(binding.sessionModel.provider, 'deepseek-account');
  assert.deepEqual(state.models.choices.map(choice => choice.model), ['deepseek-chat', 'deepseek-reasoner']);
  assert.deepEqual(state.defaults, {
    workspace: '', workspacePath: join(HOME, 'wecom-bot', 'workspace'), workspaceTitle: '企业微信',
    provider: 'deepseek-account', model: 'deepseek-reasoner',
  });
  assert.deepEqual(state.admins, ['root']);
  assert.deepEqual(state.workspaces.map(workspace => workspace.title).sort(), ['Alpha', '企业微信'].sort());
  assert.deepEqual(state.notices, ['已配置管理员但未限定 Workspace：管理员会收到所有 Workspace 的会话通知。']);
  await runtime.stop();
});

test('the bindings route creates, edits and validates bindings for the settings page', async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-home-bind-')));
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    const { ctx, routes } = hostWithServices();
    ctx.effect = fn => { void fn(); };
    apply(ctx, Config({ botId: 'bot' }));
    await settle();
    const route = routes.get('/api/wecom-bot/bindings');
    assert.ok(route, 'the bindings route is registered');
    assert.deepEqual(route.methods, ['POST']);

    const created = await route.fetch(post([{ op: 'create', kind: 'user', id: 'ZhangSan' }]));
    assert.equal(created.status, 200);
    const body = await created.json();
    assert.equal(body.ok, true);
    assert.deepEqual(body.bindings.items.map(binding => binding.key), ['user:ZhangSan']);
    assert.equal(body.bindings.items[0].sessionState, 'auto');
    assert.equal(body.bindings.items[0].workspaceTitle, '企业微信');
    assert.equal(body.bindings.items[0].workspacePath, join(home, 'wecom-bot', 'workspace'));

    // A registered Workspace can be chosen and is registered on demand.
    const moved = await route.fetch(post([{ op: 'set', key: 'user:ZhangSan', patch: { workspace: home } }]));
    assert.equal(moved.status, 200);
    assert.equal((await moved.json()).bindings.items[0].workspacePath, home);
    assert.equal(ctx.registry.rows.at(-1).path, home, 'the Workspace was registered on demand');

    // Unknown Workspaces and unknown bindings are refused with an explanation.
    const badWorkspace = await route.fetch(post([{ op: 'set', key: 'user:ZhangSan', patch: { workspace: '/does/not/exist' } }]));
    assert.equal(badWorkspace.status, 422);
    assert.match((await badWorkspace.json()).error, /Workspace 目录不存在/);
    const unknown = await route.fetch(post([{ op: 'set', key: 'user:nobody', patch: { model: 'x' } }]));
    assert.equal(unknown.status, 422);
    assert.match((await unknown.json()).error, /绑定不存在/);
    const unknownModel = await route.fetch(post([{ op: 'set', key: 'user:ZhangSan', patch: { provider: 'nope', model: 'nope' } }]));
    assert.equal(unknownModel.status, 422);
    assert.match((await unknownModel.json()).error, /DSH 当前没有模型/);

    // Malformed bodies never reach the store.
    assert.equal((await route.fetch(new Request('http://localhost/api/wecom-bot/bindings', { method: 'POST', body: 'nope' }))).status, 400);
    assert.equal((await route.fetch(post([]))).status, 400);
    assert.equal((await route.fetch(post([{ op: 'explode' }]))).status, 400);

    const removed = await route.fetch(post([{ op: 'delete', key: 'user:ZhangSan' }]));
    assert.equal(removed.status, 200);
    assert.deepEqual((await removed.json()).bindings.items, []);

    // Whatever the page did, it is durable.
    const stored = JSON.parse(await readFile(join(home, 'wecom-bot', 'bindings.json'), 'utf8'));
    assert.equal(stored.version, 1);
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous;
  }
});

test('the Host-level session listener completes rounds even across a bridge rebuild', async () => {
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
  clients[0].emit('message', frame('build it', { chat: 'alice', user: 'alice' }));
  await settle();
  const requestId = ctx.prompts[0].requestId;
  const sessionId = ctx.prompts[0].sessionId;
  botId = 'bot-2';
  ctx.handlers.get('app-boot/config-reload')();
  await settle();
  assert.equal(clients.length, 2, 'the bridge was rebuilt');
  const { session, end } = finishedSession(sessionId, { promptIds: [requestId], text: 'built' });
  ctx.handlers.get('session/event')(session, end);
  await settle();
  const round = journal.find('round.complete').find(record => record.requestId === requestId);
  assert.equal(round.outcome, 'turn-ended', 'the round survived the rebuild');
  assert.equal(round.response.assistant, 'built');
  await runtime.stop();
});

test('a finished turn reaches the conversation bound to the Session and lands in the journal', async () => {
  const { ctx } = hostWithServices();
  const client = fakeClient();
  const journal = memoryJournal();
  const runtime = createRuntime({ ctx, journal, log: silent, config: Config({ botId: 'bot' }), createClient: () => client });
  await runtime.start();
  client.emit('authenticated');
  client.emit('message', frame('build it', { chat: 'alice', user: 'alice' }));
  await settle();
  const requestId = ctx.prompts[0].requestId;
  const sessionId = ctx.prompts[0].sessionId;
  const { session, end } = finishedSession(sessionId, { promptIds: [requestId], text: 'built' });
  ctx.handlers.get('session/event')(session, end);
  await settle();
  const round = journal.find('round.complete').find(record => record.requestId === requestId);
  assert.equal(round.outcome, 'turn-ended');
  assert.equal(round.response.assistant, 'built');
  assert.deepEqual(round.response.notifiedChats, ['alice']);
  assert.deepEqual(client.sends.map(send => send.chat), ['alice']);
  await runtime.stop();
});

test('apply registers the authenticated routes and writes the journal under DSH_HOME', async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-home-apply-')));
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    const { ctx, routes } = hostWithServices();
    let setup;
    ctx.effect = fn => { setup = fn(); };
    apply(ctx, Config({}));
    const dispose = await setup;
    const state = routes.get('/api/wecom-bot/state');
    assert.equal(state.path, '/api/wecom-bot/state');
    assert.deepEqual(state.methods, ['GET']);
    assert.ok(routes.get('/api/wecom-bot/bindings'), 'both routes are registered');
    const response = await state.fetch(new Request('http://localhost/api/wecom-bot/state?refresh=1'));
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.json();
    assert.equal(body.connection.phase, 'unconfigured');
    assert.equal(body.connection.detail, '缺少 Bot ID');
    assert.equal(body.journal.directory, join(home, 'wecom-bot', 'logs'));
    assert.deepEqual(body.bindings.items, []);
    assert.equal(body.defaults.workspacePath, join(home, 'wecom-bot', 'workspace'));
    await dispose();
    assert.equal(routes.get('/api/wecom-bot/state'), undefined);
    const lines = (await readFile(body.journal.file, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(lines.map(line => line.event).filter(event => event.startsWith('plugin.')), ['plugin.start', 'plugin.stop']);
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous;
  }
});
