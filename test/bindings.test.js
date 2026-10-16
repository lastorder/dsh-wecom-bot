import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  bindingKey, bindingKeyFor, createBindingStore, parseBindingKey, validBindingId,
} from '../dist/host/bindings.js';

const silent = { onError() {} };
const directory = async () => await mkdtemp(join(tmpdir(), 'wecom-bindings-'));

test('keys are namespaced by kind, and only valid WeCom ids are accepted', () => {
  assert.equal(bindingKey('user', 'alice'), 'user:alice');
  assert.equal(bindingKey('group', 'chat-1'), 'group:chat-1');
  assert.equal(bindingKeyFor({ chat: 'alice', user: 'alice', chatType: 'single' }), 'user:alice');
  assert.equal(bindingKeyFor({ chat: 'chat-1', user: 'alice', chatType: 'group' }), 'group:chat-1');
  assert.deepEqual(parseBindingKey('group:chat-1'), { kind: 'group', id: 'chat-1' });
  assert.deepEqual(parseBindingKey('user:a:b'), { kind: 'user', id: 'a:b' });
  assert.equal(parseBindingKey('nope:1'), undefined);
  assert.equal(parseBindingKey(''), undefined);
  assert.equal(validBindingId('alice'), true);
  assert.equal(validBindingId('  '), false);
  assert.equal(validBindingId('bad\nid'), false);
  assert.equal(validBindingId('x'.repeat(513)), false);
  assert.equal(validBindingId(42), false);
});

test('a binding is created once per conversation and survives a reload', async () => {
  const dir = await directory();
  const store = createBindingStore({ directory: dir, onError: () => assert.fail('no error expected') });
  const first = await store.ensure({ chat: 'alice', user: 'alice', chatType: 'single' });
  assert.equal(first.kind, 'user');
  assert.equal(first.id, 'alice');
  assert.equal(first.sessionId, '');
  const again = await store.ensure({ chat: 'alice', user: 'alice', chatType: 'single' });
  assert.equal(again, first, 'the same record is returned, with no second write');
  await store.ensure({ chat: 'chat-1', user: 'alice', chatType: 'group' });
  await store.update('user:alice', { sessionId: 'session-1', provider: 'p', model: 'm', reasoningEffort: 'low', note: ' 备注 ' });
  await store.flush();
  assert.deepEqual(store.list().map(record => `${record.kind}:${record.id}`), ['user:alice', 'group:chat-1']);
  assert.equal(store.get('user:alice').note, '备注');
  const raw = await readFile(store.file, 'utf8');
  assert.match(raw, /\n$/, 'the file ends with a newline');
  const parsed = JSON.parse(raw);
  assert.equal(parsed.version, 1);
  assert.equal(parsed.bindings.length, 2);
  const mode = (await stat(store.file)).mode & 0o777;
  assert.equal(mode, 0o600, 'the file is private to the user');

  const reloaded = createBindingStore({ directory: dir, onError: () => assert.fail('no error expected') });
  await reloaded.load();
  assert.deepEqual(reloaded.list().map(record => record.sessionId), ['session-1', '']);
  assert.deepEqual(reloaded.forSession('session-1').map(record => record.id), ['alice']);
  assert.equal(reloaded.full(), false);
});

test('the store refuses to grow past its cap instead of dropping the oldest silently', async () => {
  const dir = await directory();
  const errors = [];
  const store = createBindingStore({ directory: dir, maxEntries: 2, onError: (error, stage) => errors.push(stage) });
  await store.ensure({ chat: 'a', user: 'a', chatType: 'single' });
  await store.ensure({ chat: 'b', user: 'b', chatType: 'single' });
  assert.equal(store.full(), true);
  await assert.rejects(store.ensure({ chat: 'c', user: 'c', chatType: 'single' }), /limit/);
  assert.deepEqual(store.list().map(record => record.id), ['a', 'b']);
  assert.deepEqual(errors, ['limit']);
  assert.equal(store.get('user:c'), undefined);
});

test('an unreadable file is quarantined instead of being overwritten', async () => {
  const dir = await directory();
  await writeFile(join(dir, 'bindings.json'), '{ not json', { mode: 0o600 });
  const stages = [];
  const store = createBindingStore({ directory: dir, onError: (error, stage) => stages.push(stage) });
  await store.load();
  assert.deepEqual(store.list(), []);
  assert.deepEqual(stages, ['parse']);
  // The damaged file is kept for inspection…
  await stat(join(dir, 'bindings.json.corrupt'));
  // …and the store still works afterwards.
  await store.ensure({ chat: 'alice', user: 'alice', chatType: 'single' });
  assert.equal(store.list().length, 1);
});

test('a file from a future version is ignored rather than half-read', async () => {
  const dir = await directory();
  await writeFile(join(dir, 'bindings.json'), JSON.stringify({ version: 99, bindings: [{ kind: 'user', id: 'alice' }] }));
  const stages = [];
  const store = createBindingStore({ directory: dir, onError: (error, stage) => stages.push(stage) });
  await store.load();
  assert.deepEqual(store.list(), []);
  assert.deepEqual(stages, ['version']);
});

test('corrupt entries and duplicates are dropped while loading', async () => {
  const dir = await directory();
  await writeFile(join(dir, 'bindings.json'), JSON.stringify({
    version: 1,
    bindings: [
      { kind: 'user', id: 'alice', sessionId: 'session-1', createdAt: 1, updatedAt: 2 },
      { kind: 'user', id: 'alice', sessionId: 'session-2', createdAt: 3, updatedAt: 4 },
      { kind: 'nonsense', id: 'x', createdAt: 1, updatedAt: 2 },
      { kind: 'group', id: 'bad\nid', createdAt: 1, updatedAt: 2 },
      null,
      { kind: 'group', id: ' chat-1 ', workspace: ' /srv/app ', createdAt: 'x', updatedAt: 2 },
    ],
  }));
  const store = createBindingStore({ directory: dir, onError: () => assert.fail('malformed entries are not an error') });
  await store.load();
  assert.deepEqual(store.list().map(record => `${record.kind}:${record.id}`), ['user:alice', 'group:chat-1']);
  assert.equal(store.get('user:alice').sessionId, 'session-1', 'the first record wins');
  assert.equal(store.get('group:chat-1').workspace, '/srv/app', 'values are trimmed');
  assert.equal(store.get('group:chat-1').createdAt, 0, 'an unusable timestamp becomes 0');
  assert.equal(await store.remove('user:alice'), true);
  assert.equal(await store.remove('user:alice'), false);
  assert.equal(await store.update('user:nobody', { sessionId: 'x' }), undefined);
  assert.deepEqual(store.list().map(record => record.id), ['chat-1']);
});

test('a fresh store tolerates a missing directory and creates it privately', async () => {
  const dir = await directory();
  await chmod(dir, 0o700);
  const store = createBindingStore({ directory: join(dir, 'nested', 'here'), onError: () => assert.fail('no error expected') });
  await store.ensure({ chat: 'alice', user: 'alice', chatType: 'single' });
  await store.flush();
  const parsed = JSON.parse(await readFile(store.file, 'utf8'));
  assert.equal(parsed.bindings.length, 1);
});
