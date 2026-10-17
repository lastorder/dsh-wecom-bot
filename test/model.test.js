// Imports the TypeScript source directly (Node strips the erasable types).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  changedOperations, choiceLabel, contextLabel, displayPath, dshDefaultLabel, effortLabel,
  effortsFor, formatTokens, groupModelSummary, modelKey, modelLabel, modelName, parseModelKey, personKey,
  presetLabel, presetName, presetSummaryLabel, relativeTime, scopeIncludes, setLabel, storedFrom, toggle, toggleScope,
  updateMember, validateAdvanced, validateCredentials,
} from '../src/client/model.ts';

test('one section diffs into minimal Config operations and never includes the Secret', () => {
  const base = storedFrom({ botId: 'bot', adminUserIds: ['root'] });
  const draft = {
    ...base,
    botId: ' bot-2 ',
    adminUserIds: ['root', 'second', 'second', ' '],
  };
  assert.deepEqual(changedOperations(draft, base), [
    { op: 'set', path: ['botId'], value: 'bot-2' },
    { op: 'set', path: ['adminUserIds'], value: ['root', 'second'] },
  ]);
  // Normalization alone is not a change, so 保存 stays disabled.
  assert.deepEqual(changedOperations({ ...base, adminUserIds: ['root', ' root '] }, base), []);
  assert.deepEqual(changedOperations({ ...base, adminWorkspaces: ['/w'] }, base),
    [{ op: 'set', path: ['adminWorkspaces'], value: ['/w'] }], 'the admin scope is Config too');
});

test('each Config card validates only its own fields', () => {
  assert.deepEqual(Object.keys(validateCredentials({ botId: '', secret: '' }, false)).sort(), ['botId', 'secret']);
  assert.deepEqual(validateCredentials({ botId: 'bot', secret: 's' }, false), {});
  assert.deepEqual(validateCredentials({ botId: 'bot', secret: '' }, true), {}, 'a stored Secret may be kept');

  const advanced = { wsUrl: '', questionTimeoutMs: 60000, logRetentionDays: 14 };
  assert.deepEqual(validateAdvanced(advanced), {});
  assert.deepEqual(Object.keys(validateAdvanced({ ...advanced, wsUrl: 'ws://x' })), ['wsUrl']);
  assert.deepEqual(Object.keys(validateAdvanced({ ...advanced, wsUrl: 'wss://u:p@x' })), ['wsUrl']);
  assert.deepEqual(validateAdvanced({ ...advanced, wsUrl: 'wss://openws.example' }), {});
  assert.deepEqual(Object.keys(validateAdvanced({ ...advanced, questionTimeoutMs: 0, logRetentionDays: 0.5 })).sort(),
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
  assert.equal(dshDefaultLabel(CATALOG), '跟随 DSH 默认模型（Model）', 'the id is left out where space is tight');
  assert.equal(modelName(CATALOG, { provider: 'p', model: 'r' }), 'Reasoner');
  assert.equal(modelName(CATALOG, { provider: 'x', model: 'y' }), 'y');
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

test('a group summary names the model it runs, and a member falls back to its WeCom id', () => {
  assert.equal(groupModelSummary(CATALOG, GROUP), 'Reasoner', 'the name alone fits the one-line overview');
  assert.equal(groupModelSummary(CATALOG, { ...GROUP, effectiveProvider: '', effectiveModel: '' }), 'Model（DSH 默认）');
  assert.equal(groupModelSummary(null, { ...GROUP, effectiveProvider: '', effectiveModel: '' }), 'DSH 默认');
  assert.equal(personKey('user', 'alice'), 'user:alice');
  assert.deepEqual(setLabel('user:alice', '爱丽丝'), { op: 'label.set', key: 'user:alice', label: '爱丽丝' });
  assert.deepEqual(updateMember('user:alice', { groupId: 'g1' }), {
    op: 'member.update', key: 'user:alice', patch: { groupId: 'g1' },
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

test('a summary names the preset a group actually runs, marking the DSH default', () => {
  assert.equal(presetSummaryLabel(PRESETS, 'ptc'), 'PTC 模式');
  assert.equal(presetSummaryLabel(PRESETS, ''), '标准（DSH 默认）', 'the fallback is named, not spelled out');
  assert.equal(presetSummaryLabel(PRESETS, 'gone'), 'gone');
  assert.equal(presetSummaryLabel(null, ''), 'DSH 默认');
  assert.equal(presetSummaryLabel({ presets: [], fetchedAt: 1 }, ''), 'DSH 默认');
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

test('the notification scope is all-or-nothing: checking everything stores an empty list', () => {
  const all = ['/w/a', '/w/b'];
  assert.equal(scopeIncludes([], '/w/a'), true, 'empty means every Workspace');
  assert.equal(scopeIncludes(['/w/a'], '/w/a'), true);
  assert.equal(scopeIncludes(['/w/a'], '/w/b'), false, 'an explicit list excludes the rest');
  // Unchecking one of two stores the remaining path; rechecking collapses to [].
  assert.deepEqual(toggleScope([], all, '/w/a', false), ['/w/b']);
  assert.deepEqual(toggleScope(['/w/b'], all, '/w/a', true), []);
  assert.deepEqual(toggleScope(['/w/a'], all, '/w/b', true), [], 'a list covering everything is the default');
  assert.deepEqual(toggleScope([], all, '/w/b', false), ['/w/a']);
});

test('list helpers toggle and shorten paths and times', () => {
  assert.deepEqual(toggle(['a'], 'b'), ['a', 'b']);
  assert.deepEqual(toggle(['a', 'b'], 'a', false), ['b']);
  assert.equal(displayPath('/Users/me/work/app'), '~/work/app');
  assert.equal(displayPath('/srv/app'), '/srv/app');
  assert.equal(relativeTime(Date.now() - 10), '刚刚');
  assert.equal(relativeTime(undefined), '');
});
