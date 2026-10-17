// Imports the TypeScript source directly (Node strips the erasable types).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  changedOperations, choiceLabel, contextLabel, displayPath, draftFrom, dshDefaultLabel, effortLabel,
  effortsFor, formatTokens, groupModelLabel, isDirty, modelKey, modelLabel, parseModelKey, personKey, personTitle,
  presetLabel, presetName, relativeTime, setLabel, updateMember,
  sessionOptions, setAll, storedFrom, toggle, validate,
} from '../src/client/model.ts';

test('drafts diff into minimal Config operations and never include the Secret', () => {
  const base = storedFrom({ botId: 'bot', adminUserIds: ['root'] });
  const draft = {
    ...draftFrom(base),
    botId: ' bot-2 ',
    adminUserIds: ['root', 'second', 'second', ' '],
    secret: 'new-secret',
  };
  assert.deepEqual(changedOperations(draft, base), [
    { op: 'set', path: ['botId'], value: 'bot-2' },
    { op: 'set', path: ['adminUserIds'], value: ['root', 'second'] },
  ]);
  assert.equal(isDirty(draft, base), true);
  assert.equal(isDirty(draftFrom(base), base), false);
  assert.equal(isDirty({ ...draftFrom(base), adminUserIds: ['root', ' root '] }, base), false, 'normalization is not a change');
  assert.equal(isDirty({ ...draftFrom(base), secret: 'x' }, base), true, 'a new Secret alone is a change');
  assert.equal(isDirty({ ...draftFrom(base), adminWorkspaces: ['/w'] }, base), true, 'admin scope is Config too');
});

test('validation covers the credential, the connection URL and the advanced numbers', () => {
  const empty = draftFrom(storedFrom({}));
  assert.deepEqual(Object.keys(validate(empty, false)).sort(), ['botId', 'secret']);
  assert.deepEqual(validate({ ...empty, botId: 'bot' }, true), {});
  assert.deepEqual(Object.keys(validate({ ...empty, botId: 'bot', wsUrl: 'ws://x' }, true)), ['wsUrl']);
  assert.deepEqual(Object.keys(validate({ ...empty, botId: 'bot', wsUrl: 'wss://u:p@x' }, true)), ['wsUrl']);
  assert.deepEqual(validate({ ...empty, botId: 'bot', wsUrl: 'wss://openws.example' }, true), {});
  assert.deepEqual(Object.keys(validate({ ...empty, botId: 'bot', questionTimeoutMs: 0, logRetentionDays: 0.5 }, true)).sort(),
    ['logRetentionDays', 'questionTimeoutMs']);
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

const GROUP = {
  id: 'g1', name: '朋友', isDefault: false, workspace: '', workspaceTitle: '企业微信',
  workspacePath: '/home/.dsh/wecom-bot/workspace', provider: 'p', model: 'r',
  effectiveProvider: 'p', effectiveModel: 'r', members: [], memberCount: 0, messages: 0,
};
const MEMBER = {
  key: 'user:alice', kind: 'user', id: 'alice', label: '', displayName: 'alice', admin: false,
  sessionId: 'session-1', sessionTitle: '修复登录', sessionState: 'bound', sessionRunning: false,
  messages: 2, lastSeenAt: 5, createdAt: 1,
};

test('a group label falls back to the DSH default, and a member to its WeCom id', () => {
  assert.equal(groupModelLabel(CATALOG, GROUP), 'Reasoner（r）');
  assert.equal(groupModelLabel(CATALOG, { ...GROUP, effectiveProvider: '', effectiveModel: '' }), '跟随 DSH 默认模型（Model（m））');
  assert.equal(personTitle({ label: '爱丽丝', id: 'alice' }), '爱丽丝');
  assert.equal(personTitle({ label: '', id: 'alice' }), 'alice');
  assert.equal(personKey('user', 'alice'), 'user:alice');
  assert.deepEqual(setLabel('user:alice', '爱丽丝'), { op: 'label.set', key: 'user:alice', label: '爱丽丝' });
  assert.deepEqual(updateMember('user:alice', { sessionId: 's1' }), {
    op: 'member.update', key: 'user:alice', patch: { sessionId: 's1' },
  });
});

const PRESETS = {
  presets: [
    { id: 'standard', isDefault: true },
    { id: 'ptc', name: 'PTC 模式' },
    { id: 'custom' },
  ],
  fetchedAt: 1,
};

test('presets are named by their published name, the shipped one, or the id', () => {
  assert.equal(presetName(PRESETS.presets[0]), '标准', 'a shipped preset has no name of its own');
  assert.equal(presetName(PRESETS.presets[1]), 'PTC 模式');
  assert.equal(presetName(PRESETS.presets[2]), 'custom', 'an unknown id names itself');
  assert.equal(presetLabel(PRESETS, 'ptc'), 'PTC 模式');
  assert.equal(presetLabel(PRESETS, 'gone'), 'gone');
  assert.equal(presetLabel(PRESETS, ''), '跟随 DSH 默认（标准）');
  assert.equal(presetLabel(null, ''), '跟随 DSH 默认');
  assert.equal(presetLabel({ presets: [], fetchedAt: 1 }, ''), '跟随 DSH 默认');
});

test('an effort is named from the catalog, and context occupancy is compact', () => {
  assert.equal(effortLabel(CATALOG, { provider: 'p', model: 'r', reasoningEffort: 'low' }), '低');
  assert.equal(effortLabel(CATALOG, { provider: 'p', model: 'r', reasoningEffort: 'gone' }), 'gone');
  assert.equal(effortLabel(CATALOG, { provider: 'p', model: 'm' }), '');
  assert.equal(effortLabel(CATALOG, undefined), '');
  assert.equal(formatTokens(812), '812');
  assert.equal(formatTokens(12_300), '12.3k');
  assert.equal(formatTokens(200_000), '200k');
  assert.equal(formatTokens(1_200_000), '1.2M');
  assert.equal(contextLabel({ used: 12_300, window: 200_000 }), '12.3k / 200k（6%）');
  assert.equal(contextLabel({ used: 900 }), '900');
  assert.equal(contextLabel(undefined), '');
});

test('session options list the group Workspace Sessions and keep an unlisted bound one', () => {
  const groups = [
    { key: 'w1', kind: 'workspace', title: '企业微信', path: '/home/.dsh/wecom-bot/workspace', sessions: [
      { sessionId: 'session-1', title: '修复登录', running: false, pinned: false, updatedAt: 1 },
      { sessionId: 'session-2', title: null, running: true, pinned: false, updatedAt: 2 },
    ] },
    { key: 'w2', kind: 'workspace', title: 'App', path: '/repo/app', sessions: [
      { sessionId: 'other', title: '别的', running: false, pinned: false, updatedAt: 3 },
    ] },
  ];
  assert.deepEqual(sessionOptions(MEMBER, GROUP, groups).map(option => option.sessionId), ['session-1', 'session-2']);
  assert.deepEqual(sessionOptions({ ...MEMBER, sessionId: '', sessionTitle: null }, GROUP, groups).map(option => option.sessionId),
    ['session-1', 'session-2']);
  assert.deepEqual(sessionOptions({ ...MEMBER, sessionId: 'gone', sessionTitle: '归档的' }, GROUP, groups)
    .map(option => [option.sessionId, option.stale ?? false]),
  [['gone', true], ['session-1', false], ['session-2', false]]);
  assert.deepEqual(sessionOptions(MEMBER, GROUP, undefined).map(option => option.sessionId), ['session-1']);
  assert.deepEqual(sessionOptions(MEMBER, { ...GROUP, workspacePath: '/repo/app' }, groups).map(option => option.sessionId),
    ['session-1', 'other'], 'a member Session outside its group Workspace is offered first');
});

test('list helpers toggle, select all and shorten paths and times', () => {
  assert.deepEqual(toggle(['a'], 'b'), ['a', 'b']);
  assert.deepEqual(toggle(['a', 'b'], 'a', false), ['b']);
  assert.deepEqual(setAll(['a'], ['a', 'b', 'c'], true), ['a', 'b', 'c']);
  assert.deepEqual(setAll(['a', 'b', 'x'], ['a', 'b'], false), ['x']);
  assert.equal(displayPath('/Users/me/work/app'), '~/work/app');
  assert.equal(displayPath('/srv/app'), '/srv/app');
  assert.equal(relativeTime(Date.now() - 10), '刚刚');
  assert.equal(relativeTime(undefined), '');
});
