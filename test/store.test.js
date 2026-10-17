import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  bindingKey, bindingKeyFor, createStore, normalizeLabel, parseBindingKey, validBindingId,
} from '../dist/host/store.js';

const directory = async () => await mkdtemp(join(tmpdir(), 'wecom-store-'));
const fail = () => assert.fail('no error expected');

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

test('a note is one bounded line, or nothing at all', () => {
  assert.equal(normalizeLabel('  张三  '), '张三');
  assert.equal(normalizeLabel('张\n三'), '张 三');
  assert.equal(normalizeLabel('a'.repeat(200)).length, 60);
  assert.equal(normalizeLabel('bad\u0000note'), '');
  assert.equal(normalizeLabel(42), '');
  assert.equal(normalizeLabel(null), '');
});

test('the default group always exists and cannot be removed', async () => {
  const dir = await directory();
  const store = createStore({ directory: dir, onError: fail });
  await store.load();
  assert.deepEqual(store.groups().map(group => group.id), ['default']);
  assert.equal(store.group('default').name, '默认分组');
  assert.deepEqual(await store.removeGroup('default'), { ok: false, removed: 0 });
  assert.equal(store.group('default').id, 'default');
  // It is created in memory, so a file only appears once something is written.
  assert.equal(await store.updateGroup('default', { workspace: '/srv/app' }) !== undefined, true);
  await store.flush();
  const parsed = JSON.parse(await readFile(store.file, 'utf8'));
  assert.equal(parsed.version, '0.5');
  assert.deepEqual(parsed.groups.map(group => group.id), ['default']);
});

test('groups are created, renamed and described', async () => {
  const dir = await directory();
  const store = createStore({ directory: dir, now: () => 1000, onError: fail });
  await store.load();
  const created = await store.createGroup('  朋友  ');
  assert.equal(created.name, '朋友');
  assert.equal(created.workspace, '');
  assert.notEqual(created.id, 'default');
  assert.equal(store.groups().length, 2);
  assert.equal(await store.updateGroup('default', { name: '  默认  ' }).then(group => group.name), '默认');
  assert.equal(await store.updateGroup('default', { name: '   ' }).then(group => group.name), '默认', 'a blank rename keeps the old name');
  assert.equal(await store.updateGroup('nope', { name: 'x' }), undefined);
  assert.deepEqual(store.groups().map(group => group.name).sort(), ['朋友', '默认'].sort());
});

test('a member is created once per principal and survives a reload', async () => {
  const dir = await directory();
  const store = createStore({ directory: dir, onError: fail });
  await store.load();
  const group = await store.createGroup('客人');
  const first = await store.create('user', 'alice', { groupId: group.id, label: '爱丽丝' });
  assert.equal(first.kind, 'user');
  assert.equal(first.id, 'alice');
  assert.equal(first.groupId, group.id);
  assert.equal(first.sessionId, '');
  assert.equal(store.label('user:alice'), '爱丽丝', 'a note typed while authorizing belongs to the person');
  const again = await store.create('user', 'alice', { groupId: 'default', label: '爱丽丝' });
  assert.equal(again.sessionId, '', 'the same row, moved rather than duplicated');
  assert.equal(again.groupId, 'default');
  await store.create('group', 'chat-1', { groupId: 'default' });
  await store.update('user:alice', { sessionId: 'session-1' });
  await store.setLabel('user:alice', ' 新备注 ');
  await store.flush();
  assert.deepEqual(store.bindings().map(record => `${record.kind}:${record.id}`), ['user:alice', 'group:chat-1']);
  assert.equal(store.label('user:alice'), '新备注');
  assert.deepEqual(store.inGroup('default').map(record => record.id), ['alice', 'chat-1']);
  const raw = await readFile(store.file, 'utf8');
  assert.match(raw, /\n$/, 'the file ends with a newline');
  assert.equal((await stat(store.file)).mode & 0o777, 0o600, 'the file is private to the user');

  const reloaded = createStore({ directory: dir, onError: fail });
  await reloaded.load();
  assert.deepEqual(reloaded.bindings().map(record => record.sessionId), ['session-1', '']);
  assert.equal(reloaded.label('user:alice'), '新备注', 'notes are durable');
  assert.deepEqual(reloaded.forSession('session-1').map(record => record.id), ['alice']);
  assert.deepEqual(reloaded.groups().map(group => group.name).sort(), ['客人', '默认分组'].sort());
  assert.equal(reloaded.full(), false);
});

test('deleting a group de-authorizes its members and keeps the others', async () => {
  const dir = await directory();
  const store = createStore({ directory: dir, onError: fail });
  await store.load();
  const guests = await store.createGroup('客人');
  await store.create('user', 'alice', { groupId: 'default' });
  await store.create('user', 'bob', { groupId: guests.id });
  await store.create('group', 'chat-1', { groupId: guests.id });
  assert.deepEqual(await store.removeGroup(guests.id), { ok: true, removed: 2 });
  assert.deepEqual(store.bindings().map(record => record.id), ['alice']);
  assert.deepEqual(store.groups().map(group => group.id), ['default']);
});

test('the store refuses to grow past its cap instead of dropping the oldest silently', async () => {
  const dir = await directory();
  const errors = [];
  const store = createStore({ directory: dir, maxEntries: 2, onError: (error, stage) => errors.push(stage) });
  await store.load();
  await store.create('user', 'a', { groupId: 'default' });
  await store.create('user', 'b', { groupId: 'default' });
  assert.equal(store.full(), true);
  await assert.rejects(store.create('user', 'c', { groupId: 'default' }), /limit/);
  assert.deepEqual(store.bindings().map(record => record.id), ['a', 'b']);
  assert.deepEqual(errors, ['limit']);
  assert.equal(store.get('user:c'), undefined);
});

test('group creation is capped too', async () => {
  const dir = await directory();
  const store = createStore({ directory: dir, maxGroups: 2, onError: fail });
  await store.load();
  await store.createGroup('a');
  await assert.rejects(store.createGroup('b'), /group limit/);
  assert.equal(store.groups().length, 2);
});

test('an unreadable file is quarantined instead of being overwritten', async () => {
  const dir = await directory();
  await writeFile(join(dir, 'settings.json'), '{ not json', { mode: 0o600 });
  const stages = [];
  const store = createStore({ directory: dir, onError: (error, stage) => stages.push(stage) });
  await store.load();
  assert.deepEqual(store.bindings(), []);
  assert.deepEqual(stages, ['parse']);
  await stat(join(dir, 'settings.json.corrupt'));
  await store.create('user', 'alice', { groupId: 'default' });
  assert.equal(store.bindings().length, 1);
  assert.equal(store.group('default').id, 'default');
});

test('a file of another version is set aside instead of being read or overwritten', async () => {
  const dir = await directory();
  await writeFile(join(dir, 'settings.json'), JSON.stringify({
    version: 5,
    groups: [{ id: 'default', name: '默认分组' }],
    bindings: [{ kind: 'user', id: 'alice', groupId: 'default', sessionId: 's1' }],
    labels: { 'user:alice': '爱丽丝' },
  }));
  const stages = [];
  const store = createStore({ directory: dir, onError: (error, stage) => stages.push(stage) });
  await store.load();
  assert.deepEqual(store.bindings(), [], 'nothing from an unread file is trusted');
  assert.equal(store.group('default').name, '默认分组');
  assert.deepEqual(stages, ['version']);
  // The old integer counter is exactly the file v0.4.1 wrote, so it must be
  // parked under its own name rather than read as the current layout.
  await stat(join(dir, 'settings.json.v5'));
  await assert.rejects(stat(join(dir, 'settings.json')), 'the old file is moved, not clobbered');

  // Starting fresh writes the current version and keeps the old file around.
  await store.create('user', 'bob', { groupId: 'default' });
  await store.flush();
  const parsed = JSON.parse(await readFile(store.file, 'utf8'));
  assert.equal(parsed.version, '0.5');
  assert.deepEqual(parsed.bindings.map(record => record.id), ['bob']);
  await stat(join(dir, 'settings.json.v5'));
});

test('a version string is never allowed to choose the path it is parked under', async () => {
  const dir = await directory();
  await writeFile(join(dir, 'settings.json'), JSON.stringify({ version: '../../escape', bindings: [] }));
  const store = createStore({ directory: dir, onError: () => {} });
  await store.load();
  assert.deepEqual(store.bindings(), []);
  assert.deepEqual((await readdir(dir)).filter(name => name !== 'settings.json'), ['settings.json.v.._.._escape']);
});

test("an administrator's default Workspace is stored as a { workspace } object", async () => {
  const dir = await directory();
  const store = createStore({ directory: dir, onError: fail });
  await store.load();
  await store.setAdminWorkspace('root', '/srv/orion');
  await store.flush();
  const parsed = JSON.parse(await readFile(store.file, 'utf8'));
  assert.deepEqual(parsed.adminDefaults, { root: { workspace: '/srv/orion' } }, 'an object, so more can join later');

  const reloaded = createStore({ directory: dir, onError: fail });
  await reloaded.load();
  assert.equal(reloaded.adminWorkspace('root'), '/srv/orion');

  await reloaded.setAdminWorkspace('root', '');
  await reloaded.flush();
  assert.deepEqual(JSON.parse(await readFile(store.file, 'utf8')).adminDefaults, {}, 'clearing drops the entry');

  // A bare string is the shape this layout never shipped with; it is ignored
  // rather than half-guessed, exactly like an unknown file version.
  await writeFile(store.file, JSON.stringify({
    version: '0.5', adminDefaults: { alice: '/srv/old' }, groups: [], bindings: [], labels: {},
  }));
  const strict = createStore({ directory: dir, onError: fail });
  await strict.load();
  assert.equal(strict.adminWorkspace('alice'), '');
});

test('a group keeps its Workspace, model, effort and preset across a reload', async () => {
  const dir = await directory();
  const store = createStore({ directory: dir, onError: fail });
  await store.load();
  const guests = await store.createGroup('客人');
  await store.updateGroup(guests.id, {
    workspace: '/srv/app', provider: 'p', model: 'm', reasoningEffort: 'low', preset: 'standard',
  });
  await store.flush();

  const reloaded = createStore({ directory: dir, onError: fail });
  await reloaded.load();
  const group = reloaded.group(guests.id);
  assert.deepEqual(
    [group.workspace, group.provider, group.model, group.reasoningEffort, group.preset],
    ['/srv/app', 'p', 'm', 'low', 'standard'],
  );
  assert.equal(reloaded.group('default').preset, '', 'a group that picks none follows the DSH default');
  // The preset is trimmed like every other group field.
  assert.equal((await reloaded.updateGroup(guests.id, { preset: '  ptc  ' })).preset, 'ptc');
  await reloaded.createGroup('空');
  assert.equal(reloaded.groups().at(-1).preset, '');
});

test('corrupt entries and duplicates are dropped while loading', async () => {
  const dir = await directory();
  await writeFile(join(dir, 'settings.json'), JSON.stringify({
    version: '0.5',
    groups: [{ id: 'g1', name: ' 朋友 ' }, { id: 'g1', name: '重复' }, null, { id: 'x'.repeat(80) }, { name: '没有 id' }],
    bindings: [
      { kind: 'user', id: 'alice', groupId: 'missing', sessionId: 'session-1', createdAt: 1, updatedAt: 2 },
      { kind: 'user', id: 'alice', groupId: 'g1', sessionId: 'session-2', createdAt: 3, updatedAt: 4 },
      { kind: 'nonsense', id: 'x', createdAt: 1, updatedAt: 2 },
      { kind: 'group', id: 'bad\nid', createdAt: 1, updatedAt: 2 },
      null,
      { kind: 'group', id: ' chat-1 ', groupId: 'g1', createdAt: 'x', updatedAt: 2 },
      { kind: 'user', id: 'nobody', groupId: 'g1' },
    ],
  }));
  const store = createStore({ directory: dir, onError: fail });
  await store.load();
  assert.deepEqual(store.bindings().map(record => `${record.kind}:${record.id}`),
    ['user:alice', 'group:chat-1', 'user:nobody']);
  assert.equal(store.get('user:alice').sessionId, 'session-1', 'the first record wins');
  assert.equal(store.get('user:alice').groupId, 'default', 'a member never points at a missing group');
  assert.equal(store.get('group:chat-1').createdAt, 0, 'an unusable timestamp becomes 0');
  assert.deepEqual(store.groups().map(group => group.name).sort(), ['朋友', '默认分组'].sort(), 'a duplicate group id is ignored');
  assert.equal(await store.remove('user:alice'), true);
  assert.equal(await store.remove('user:alice'), false);
  assert.equal(await store.update('user:nonexistent', { sessionId: 'x' }), undefined);
  assert.deepEqual(store.bindings().map(record => record.id), ['chat-1', 'nobody']);
});

test('a note belongs to the person: it survives removal, deletion and having no group', async () => {
  const dir = await directory();
  const store = createStore({ directory: dir, onError: fail });
  await store.load();
  const guests = await store.createGroup('客人');
  await store.create('user', 'alice', { groupId: guests.id, label: '爱丽丝' });
  assert.equal(await store.setLabel('user:alice', '  爱丽丝  '), '爱丽丝');

  // Removing the membership (or deleting the whole group) must not forget who
  // Alice is: the settings page still shows her under her note.
  assert.equal(await store.remove('user:alice'), true);
  assert.equal(store.label('user:alice'), '爱丽丝');
  await store.create('user', 'bob', { groupId: guests.id, label: '鲍勃' });
  await store.removeGroup(guests.id);
  assert.equal(store.label('user:bob'), '鲍勃');

  // An administrator who belongs to no group has a note too.
  await store.setLabel('user:root', '运维');
  await store.setLabel('user:root', '   ');
  assert.equal(store.label('user:root'), '', 'a blank note clears it');
  assert.equal(store.label('user:nobody'), '');

  await store.setLabel('user:root', '运维');
  const reloaded = createStore({ directory: dir, onError: fail });
  await reloaded.load();
  assert.equal(reloaded.label('user:alice'), '爱丽丝');
  assert.equal(reloaded.label('user:bob'), '鲍勃');
  assert.equal(reloaded.label('user:root'), '运维');
  assert.deepEqual(reloaded.bindings(), [], 'notes outlive every membership');
});

test('a move to an unknown group keeps the current membership', async () => {
  const dir = await directory();
  const store = createStore({ directory: dir, onError: fail });
  await store.load();
  const guests = await store.createGroup('客人');
  await store.create('user', 'alice', { groupId: guests.id });
  assert.equal((await store.update('user:alice', { groupId: 'nope' })).groupId, guests.id);
  assert.equal((await store.create('user', 'bob', { groupId: 'nope' })).groupId, 'default');
});

test('a fresh store tolerates a missing directory and creates it privately', async () => {
  const dir = await directory();
  await chmod(dir, 0o700);
  const store = createStore({ directory: join(dir, 'nested', 'here'), onError: fail });
  await store.load();
  await store.create('user', 'alice', { groupId: 'default' });
  await store.flush();
  const parsed = JSON.parse(await readFile(store.file, 'utf8'));
  assert.equal(parsed.bindings.length, 1);
  assert.equal(parsed.groups.length, 1);
});

/* ------------------------------------------------------------------ *
 * The settings block: everything the operator edits but the           *
 * connection identity, in the same document as the groups             *
 * ------------------------------------------------------------------ */

test('a fresh store starts from the documented settings defaults', async () => {
  const store = createStore({ directory: await directory(), onError: fail });
  await store.load();
  assert.deepEqual(store.settings(), {
    wsUrl: '',
    adminUserIds: [],
    adminWorkspaces: [],
    questionTimeoutMs: 60000,
    remoteApprovals: false,
    logEnabled: true,
    logRetentionDays: 14,
  });
  assert.equal(store.file.endsWith('settings.json'), true, 'the plugin owns one document');
});

test('a settings edit merges, and an explicit empty list clears a list', async () => {
  const store = createStore({ directory: await directory(), onError: fail });
  await store.load();
  await store.setSettings({ adminUserIds: ['root'] });
  await store.setSettings({ remoteApprovals: true });
  await store.setSettings({ adminWorkspaces: ['/w/a', '/w/a', ' '] });
  const settings = store.settings();
  assert.deepEqual(settings.adminUserIds, ['root'], 'an earlier patch survives a later one');
  assert.equal(settings.remoteApprovals, true);
  assert.deepEqual(settings.adminWorkspaces, ['/w/a']);
  // `[]` is a value the operator chose, not a missing field.
  await store.setSettings({ adminUserIds: [] });
  assert.deepEqual(store.settings().adminUserIds, []);
  assert.equal(store.settings().remoteApprovals, true, 'the fields the patch omitted are untouched');
});

test('settings share the file with the groups and survive a reload', async () => {
  const dir = await directory();
  const store = createStore({ directory: dir, onError: fail });
  await store.load();
  await store.setSettings({ wsUrl: 'wss://openws.example', questionTimeoutMs: 120000, logRetentionDays: 3 });
  await store.createGroup('朋友');
  await store.flush();
  const parsed = JSON.parse(await readFile(store.file, 'utf8'));
  assert.equal(parsed.settings.wsUrl, 'wss://openws.example');
  assert.equal(parsed.settings.questionTimeoutMs, 120000);
  assert.equal(parsed.groups.length, 2, 'one document holds both');
  const reloaded = createStore({ directory: dir, onError: fail });
  await reloaded.load();
  assert.equal(reloaded.settings().wsUrl, 'wss://openws.example');
  assert.equal(reloaded.settings().logRetentionDays, 3);
  assert.equal(reloaded.groups().length, 2);
});

test('hand-edited settings are re-typed and clamped, never trusted', async () => {
  const dir = await directory();
  await writeFile(join(dir, 'settings.json'), JSON.stringify({
    version: '0.5',
    settings: {
      wsUrl: 42,
      adminUserIds: ['root', 'root', '', 7, '  root2  '],
      adminWorkspaces: 'not-an-array',
      questionTimeoutMs: 10 ** 9,
      remoteApprovals: 'yes',
      logEnabled: 0,
      logRetentionDays: 0,
    },
    groups: [], bindings: [], labels: {}, adminDefaults: {},
  }));
  const store = createStore({ directory: dir, onError: fail });
  await store.load();
  const settings = store.settings();
  assert.equal(settings.wsUrl, '', 'a non-string endpoint is not an endpoint');
  assert.deepEqual(settings.adminUserIds, ['root', 'root2']);
  assert.deepEqual(settings.adminWorkspaces, []);
  assert.equal(settings.questionTimeoutMs, 300000, 'clamped to the documented maximum');
  assert.equal(settings.remoteApprovals, false, 'only a real true is true');
  assert.equal(settings.logEnabled, true, 'only a real false turns the journal off');
  assert.equal(settings.logRetentionDays, 1, 'clamped to the documented minimum');
});

test('a file without a settings block keeps its groups and gets the defaults', async () => {
  const dir = await directory();
  await writeFile(join(dir, 'settings.json'), JSON.stringify({
    version: '0.5',
    groups: [{ id: 'g1', name: '朋友', workspace: '/srv/app' }],
    bindings: [{ kind: 'user', id: 'alice', groupId: 'g1', sessionId: 's1' }],
    labels: { 'user:alice': '爱丽丝' },
    adminDefaults: {},
  }));
  const store = createStore({ directory: dir, onError: fail });
  await store.load();
  assert.deepEqual(store.settings(), {
    wsUrl: '',
    adminUserIds: [],
    adminWorkspaces: [],
    questionTimeoutMs: 60000,
    remoteApprovals: false,
    logEnabled: true,
    logRetentionDays: 14,
  });
  assert.equal(store.group('g1').name, '朋友');
  assert.equal(store.label('user:alice'), '爱丽丝');
});
