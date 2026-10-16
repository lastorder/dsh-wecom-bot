// Imports the TypeScript source directly (Node strips the erasable types).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  accessSummary, bindingGroups, changedOperations, choiceLabel, displayPath, draftFrom,
  dshDefaultLabel, effortsFor, identityRows, isDirty, modelKey, modelLabel, parseModelKey,
  relativeTime, sessionOptions, setAll, storedFrom, toggle, validate,
} from '../src/client/model.ts';

test('drafts diff into minimal Config operations and never include the Secret', () => {
  const base = storedFrom({ botId: 'bot', allowedUserIds: ['a'], adminUserIds: ['root'] });
  const draft = {
    ...draftFrom(base),
    botId: ' bot-2 ',
    allowedUserIds: ['a', 'b', 'b', ' '],
    defaultWorkspace: ' /srv/ws ',
    secret: 'new-secret',
  };
  assert.deepEqual(changedOperations(draft, base), [
    { op: 'set', path: ['botId'], value: 'bot-2' },
    { op: 'set', path: ['defaultWorkspace'], value: '/srv/ws' },
    { op: 'set', path: ['allowedUserIds'], value: ['a', 'b'] },
  ]);
  assert.equal(isDirty(draft, base), true);
  assert.equal(isDirty(draftFrom(base), base), false);
  assert.equal(isDirty({ ...draftFrom(base), allowedUserIds: ['a', ' a '] }, base), false, 'normalization is not a change');
  assert.equal(isDirty({ ...draftFrom(base), secret: 'x' }, base), true, 'a new Secret alone is a change');
  assert.equal(isDirty({ ...draftFrom(base), adminWorkspaces: ['/w'] }, base), true, 'admin scope is Config too');
});

test('validation covers the credential, the connection URL, the Workspace and the model pair', () => {
  const empty = draftFrom(storedFrom({}));
  assert.deepEqual(Object.keys(validate(empty, false)).sort(), ['botId', 'secret']);
  assert.deepEqual(validate({ ...empty, botId: 'bot' }, true), {});
  assert.deepEqual(Object.keys(validate({ ...empty, botId: 'bot', wsUrl: 'ws://x' }, true)), ['wsUrl']);
  assert.deepEqual(Object.keys(validate({ ...empty, botId: 'bot', wsUrl: 'wss://u:p@x' }, true)), ['wsUrl']);
  assert.deepEqual(Object.keys(validate({ ...empty, botId: 'bot', questionTimeoutMs: 0, logRetentionDays: 0.5 }, true)).sort(), ['logRetentionDays', 'questionTimeoutMs']);
  assert.deepEqual(Object.keys(validate({ ...empty, botId: 'bot', defaultWorkspace: 'relative/dir' }, true)), ['defaultWorkspace']);
  assert.deepEqual(validate({ ...empty, botId: 'bot', defaultWorkspace: '/srv/ws' }, true), {});
  assert.deepEqual(validate({ ...empty, botId: 'bot', defaultWorkspace: 'C:\\ws' }, true), {});
  assert.deepEqual(Object.keys(validate({ ...empty, botId: 'bot', defaultProvider: 'p' }, true)), ['defaultModel'],
    'half a model selection is refused');
  assert.deepEqual(validate({ ...empty, botId: 'bot', defaultProvider: 'p', defaultModel: 'm' }, true), {});
});

test('access summary reports which allowlists are open', () => {
  assert.deepEqual(accessSummary({ chatIds: [], allowedUserIds: [] }), { level: 'open', unrestricted: ['chats', 'users'] });
  assert.deepEqual(accessSummary({ chatIds: ['c'], allowedUserIds: [] }), { level: 'partial', unrestricted: ['users'] });
  assert.equal(accessSummary({ chatIds: ['c'], allowedUserIds: ['u'] }).level, 'restricted');
});

const CATALOG = {
  choices: [
    { provider: 'p', providerName: 'Provider', model: 'm', name: 'Model' },
    { provider: 'p', providerName: 'Provider', model: 'r', name: 'Reasoner', efforts: [{ id: 'low', name: '低' }], defaultEffort: 'low' },
  ],
  dshDefault: { provider: 'p', model: 'm' },
  failures: [],
  fetchedAt: 1,
};

test('model helpers round-trip the provider/model key and label the default', () => {
  assert.equal(modelKey('p', 'm'), 'p\u0000m');
  assert.equal(modelKey('', 'm'), '');
  assert.deepEqual(parseModelKey(modelKey('p', 'm')), { provider: 'p', model: 'm' });
  assert.deepEqual(parseModelKey(''), { provider: '', model: '' });
  assert.equal(choiceLabel(CATALOG.choices[0]), 'Model（m）');
  assert.equal(modelLabel(CATALOG, { provider: 'p', model: 'r' }), 'Reasoner（r）');
  assert.equal(modelLabel(CATALOG, { provider: 'x', model: 'y' }), 'x/y');
  assert.equal(dshDefaultLabel(CATALOG), '跟随 DSH 默认模型（Model（m））');
  assert.equal(dshDefaultLabel(null), '跟随 DSH 默认模型');
  assert.deepEqual(effortsFor(CATALOG, 'p', 'r').map(effort => effort.id), ['low']);
  assert.deepEqual(effortsFor(CATALOG, 'p', 'm'), []);
});

const BINDINGS = {
  total: 3,
  full: false,
  items: [
    {
      key: 'user:alice', kind: 'user', id: 'alice', admin: false,
      workspace: '', workspaceTitle: '企业微信', workspacePath: '/home/.dsh/wecom-bot/workspace',
      sessionId: 'session-1', sessionTitle: '修复登录', sessionState: 'bound', sessionRunning: false,
      provider: '', model: '', effectiveProvider: 'p', effectiveModel: 'm',
      messages: 2, lastSeenAt: 5, createdAt: 1, updatedAt: 2,
    },
    {
      key: 'user:bob', kind: 'user', id: 'bob', admin: true,
      workspace: '', workspaceTitle: '企业微信', workspacePath: '/home/.dsh/wecom-bot/workspace',
      sessionId: '', sessionTitle: null, sessionState: 'auto', sessionRunning: false,
      provider: 'p', model: 'r', effectiveProvider: 'p', effectiveModel: 'r',
      messages: 0, createdAt: 1, updatedAt: 2,
    },
    {
      key: 'group:chat-1', kind: 'group', id: 'chat-1', admin: false,
      workspace: '/repo/app', workspaceTitle: 'App', workspacePath: '/repo/app',
      sessionId: '', sessionTitle: null, sessionState: 'auto', sessionRunning: false,
      provider: '', model: '', effectiveProvider: 'p', effectiveModel: 'm',
      messages: 0, createdAt: 1, updatedAt: 2,
    },
  ],
};

test('bindings group by their effective Workspace and can be searched', () => {
  const groups = bindingGroups(BINDINGS, '');
  assert.deepEqual(groups.map(group => [group.title, group.rows.map(row => row.id)]),
    [['App', ['chat-1']], ['企业微信', ['alice', 'bob']]]);
  assert.deepEqual(bindingGroups(BINDINGS, 'bob').map(group => group.rows.map(row => row.id)), [['bob']]);
  assert.deepEqual(bindingGroups(BINDINGS, '修复登录').map(group => group.rows.map(row => row.id)), [['alice']]);
  assert.deepEqual(bindingGroups(BINDINGS, '/repo/app').map(group => group.rows.map(row => row.id)), [['chat-1']]);
  assert.deepEqual(bindingGroups(BINDINGS, 'p/r').map(group => group.rows.map(row => row.id)), [['bob']],
    'the model override is searchable');
  assert.deepEqual(bindingGroups(null, ''), []);
});

test('session options list the binding Workspace Sessions and keep an unlisted bound one', () => {
  const groups = [
    { key: 'w1', kind: 'workspace', title: '企业微信', path: '/home/.dsh/wecom-bot/workspace', sessions: [
      { sessionId: 'session-1', title: '修复登录', running: false, pinned: false, updatedAt: 1 },
      { sessionId: 'session-2', title: null, running: true, pinned: false, updatedAt: 2 },
    ] },
    { key: 'w2', kind: 'workspace', title: 'App', path: '/repo/app', sessions: [
      { sessionId: 'other', title: '别的', running: false, pinned: false, updatedAt: 3 },
    ] },
  ];
  assert.deepEqual(sessionOptions(BINDINGS.items[0], groups).map(option => option.sessionId), ['session-1', 'session-2']);
  assert.deepEqual(sessionOptions(BINDINGS.items[1], groups).map(option => option.sessionId), ['session-1', 'session-2']);
  assert.deepEqual(sessionOptions({ ...BINDINGS.items[0], sessionId: 'gone', sessionTitle: '归档的' }, groups)
    .map(option => [option.sessionId, option.stale ?? false]),
  [['gone', true], ['session-1', false], ['session-2', false]]);
  assert.deepEqual(sessionOptions(BINDINGS.items[0], undefined).map(option => option.sessionId), ['session-1']);
});

test('list helpers toggle, select all and merge configured IDs with observed ones', () => {
  assert.deepEqual(toggle(['a'], 'b'), ['a', 'b']);
  assert.deepEqual(toggle(['a', 'b'], 'a', false), ['b']);
  assert.deepEqual(setAll(['a'], ['a', 'b', 'c'], true), ['a', 'b', 'c']);
  assert.deepEqual(setAll(['a', 'b', 'x'], ['a', 'b'], false), ['x']);
  assert.deepEqual(identityRows([{ id: 'seen' }], ['seen', 'manual']).map(row => [row.id, Boolean(row.observed)]), [['seen', true], ['manual', false]]);
  assert.equal(displayPath('/Users/me/work/app'), '~/work/app');
  assert.equal(displayPath('/srv/app'), '/srv/app');
  assert.equal(relativeTime(Date.now() - 10), '刚刚');
  assert.equal(relativeTime(undefined), '');
});
