import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply, Config, inject } from '../dist/host/index.js';
import { createRuntime } from '../dist/host/runtime.js';
import { fakeClient, fakeHost, finishedSession, frame, memoryJournal, settle } from './helpers.js';

function hostWithServices(overrides = {}) {
  const ctx = fakeHost({
    workspaces: [{ id: 'w1', path: '/w/alpha', title: 'Alpha', sessionIds: ['s1'] }],
  });
  let route;
  const reads = [];
  Object.assign(ctx, {
    logger: () => ({ info() {}, warn() {}, error() {} }),
    connection: { fetch: { register(value) { route = value; return async () => { route = undefined; }; } } },
    credentials: { async resolve(ref) { reads.push(ref); return { value: 'TOP-SECRET-VALUE' }; } },
    ...overrides,
  });
  return { ctx, reads, route: () => route };
}

test('Config keeps only a credential reference; Bot ID and Secret are the only inputs without defaults', () => {
  const config = Config({});
  assert.equal(config.botId.get(), '');
  assert.equal(config.secretEnv.get(), 'WECOM_BOT_SECRET');
  for (const key of ['chatIds', 'sessionIds', 'allowedUserIds']) assert.deepEqual(config[key].get(), []);
  assert.equal(config.remoteApprovals.get(), false);
  assert.equal(config.logEnabled.get(), true);
  assert.equal(config.logRetentionDays.get(), 14);
  assert.equal('secret' in config, false);
  assert.deepEqual(inject, ['credentials', 'sessionController', 'connection']);
});

test('a plaintext or credentialed WebSocket URL is refused before the Secret is read', async () => {
  const { ctx, reads } = hostWithServices();
  const journal = memoryJournal();
  const runtime = createRuntime({ ctx, journal, log: { info() {}, warn() {}, error() {} },
    config: Config({ botId: 'bot', wsUrl: 'ws://plaintext.example' }), createClient: () => assert.fail('must not connect') });
  await runtime.start();
  assert.deepEqual(reads, []);
  assert.equal(runtime.status.connection().phase, 'invalid');
  await runtime.stop();
});

test('runtime connects with the resolved Secret, never logs it, and serves the grouped state', async () => {
  const { ctx } = hostWithServices();
  const client = fakeClient();
  let options;
  const journal = memoryJournal(['TOP-SECRET-VALUE']);
  const runtime = createRuntime({ ctx, journal, log: { info() {}, warn() {}, error() {} },
    config: Config({ botId: 'bot', sessionIds: ['s1', 'gone'] }),
    createClient: value => { options = value; return client; } });
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
  assert.equal(JSON.stringify(journal.records).includes('TOP-SECRET-VALUE'), false);

  client.emit('message', frame('hi', { chat: 'alice', user: 'alice' }));
  await settle();
  const state = await runtime.state();
  assert.equal(state.observed.users[0].id, 'alice');
  assert.deepEqual(state.sessions.groups.map(g => g.title), ['Alpha', '未分组']);
  assert.deepEqual(state.sessions.hiddenSelections.map(h => h.sessionId), ['gone']);
  assert.equal(state.traffic.received, 1);
  assert.equal(state.traffic.prompts, 0, 'two allowlisted Sessions need an explicit /use');
  await runtime.stop();
});

test('the Host-level session listener completes rounds even across a bridge rebuild', async () => {
  const { ctx } = hostWithServices();
  const clients = [];
  const journal = memoryJournal();
  let botId = 'bot';
  const stored = Config({ sessionIds: ['s1'] });
  const config = new Proxy(stored, { get: (target, key) => (key === 'botId' ? { get: () => botId } : target[key]) });
  const runtime = createRuntime({ ctx, journal, log: { info() {}, warn() {}, error() {} }, config,
    createClient: () => { const client = fakeClient(); clients.push(client); return client; } });
  await runtime.start();
  clients[0].emit('message', frame('build it'));
  await settle();
  const requestId = ctx.prompts[0].requestId;
  botId = 'bot-2';
  ctx.handlers.get('app-boot/config-reload')();
  await settle();
  assert.equal(clients.length, 2, 'the bridge was rebuilt');
  const { session, end } = finishedSession('s1', { promptIds: [requestId], text: 'built' });
  ctx.handlers.get('session/event')(session, end);
  await settle();
  const round = journal.find('round.complete').find(r => r.requestId === requestId);
  assert.equal(round.outcome, 'turn-ended');
  assert.equal(round.response.assistant, 'built');
  assert.equal(journal.find('dsh.turn.end').length, 1);
  await runtime.stop();
});

test('apply registers the authenticated state route and writes the journal under DSH_HOME', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-home-'));
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    const { ctx, route } = hostWithServices();
    let setup;
    ctx.effect = fn => { setup = fn(); };
    apply(ctx, Config({}));
    const dispose = await setup;
    assert.equal(route().path, '/api/wecom-bot/state');
    assert.deepEqual(route().methods, ['GET']);
    const response = await route().fetch(new Request('http://localhost/api/wecom-bot/state?refresh=1'));
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.json();
    assert.equal(body.connection.phase, 'unconfigured');
    assert.equal(body.connection.detail, '缺少 Bot ID');
    assert.equal(body.journal.directory, join(home, 'wecom-bot', 'logs'));
    await dispose();
    assert.equal(route(), undefined);
    const lines = (await readFile(body.journal.file, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(lines.map(line => line.event).filter(e => e.startsWith('plugin.')), ['plugin.start', 'plugin.stop']);
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous;
  }
});
