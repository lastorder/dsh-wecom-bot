// Imports the TypeScript source directly (Node strips the erasable types).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  accessSummary, changedOperations, draftFrom, filterGroups, identityRows, isDirty, setAll, storedFrom, toggle, validate,
} from '../src/client/model.ts';

test('drafts diff into minimal Config operations and never include the Secret', () => {
  const base = storedFrom({ botId: 'bot', sessionIds: ['a'] });
  const draft = { ...draftFrom(base), botId: ' bot-2 ', sessionIds: ['a', 'b', 'b', ' '], secret: 'new-secret' };
  assert.deepEqual(changedOperations(draft, base), [
    { op: 'set', path: ['botId'], value: 'bot-2' },
    { op: 'set', path: ['sessionIds'], value: ['a', 'b'] },
  ]);
  assert.equal(isDirty(draft, base), true);
  assert.equal(isDirty(draftFrom(base), base), false);
  assert.equal(isDirty({ ...draftFrom(base), sessionIds: ['a', ' a '] }, base), false, 'normalization is not a change');
  assert.equal(isDirty({ ...draftFrom(base), secret: 'x' }, base), true, 'a new Secret alone is a change');
});

test('only Bot ID and (on first setup) the Secret are required', () => {
  const empty = draftFrom(storedFrom({}));
  assert.deepEqual(Object.keys(validate(empty, false)).sort(), ['botId', 'secret']);
  assert.deepEqual(validate({ ...empty, botId: 'bot' }, true), {});
  assert.deepEqual(Object.keys(validate({ ...empty, botId: 'bot', wsUrl: 'ws://x' }, true)), ['wsUrl']);
  assert.deepEqual(Object.keys(validate({ ...empty, botId: 'bot', wsUrl: 'wss://u:p@x' }, true)), ['wsUrl']);
  assert.deepEqual(Object.keys(validate({ ...empty, botId: 'bot', questionTimeoutMs: 0, logRetentionDays: 0.5 }, true)).sort(), ['logRetentionDays', 'questionTimeoutMs']);
});

test('access summary reports which allowlists are open', () => {
  assert.deepEqual(accessSummary({ sessionIds: [], chatIds: [], allowedUserIds: [] }), { level: 'open', unrestricted: ['sessions', 'chats', 'users'] });
  assert.deepEqual(accessSummary({ sessionIds: ['s'], chatIds: [], allowedUserIds: ['u'] }), { level: 'partial', unrestricted: ['chats'] });
  assert.equal(accessSummary({ sessionIds: ['s'], chatIds: ['c'], allowedUserIds: ['u'] }).level, 'restricted');
});

test('session filtering matches title, id and Workspace, and can show only the selection', () => {
  const groups = [
    { key: 'w1', kind: 'workspace', title: 'Repo', path: '/src/repo', sessions: [
      { sessionId: 'aaa', title: '修复登录', running: false, pinned: false, updatedAt: 1 },
      { sessionId: 'bbb', title: null, running: false, pinned: false, updatedAt: 2 },
    ] },
    { key: 'ungrouped', kind: 'ungrouped', title: '未分组', sessions: [{ sessionId: 'ccc', title: 'Other', running: true, pinned: false, updatedAt: 3 }] },
  ];
  assert.deepEqual(filterGroups(groups, '登录').map(g => g.sessions.map(s => s.sessionId)), [['aaa']]);
  assert.deepEqual(filterGroups(groups, 'repo').flatMap(g => g.sessions.map(s => s.sessionId)), ['aaa', 'bbb']);
  assert.deepEqual(filterGroups(groups, '', new Set(['ccc'])).map(g => g.key), ['ungrouped']);
  assert.deepEqual(toggle(['a'], 'b'), ['a', 'b']);
  assert.deepEqual(toggle(['a', 'b'], 'a', false), ['b']);
  assert.deepEqual(setAll(['a'], ['a', 'b', 'c'], true), ['a', 'b', 'c']);
  assert.deepEqual(setAll(['a', 'b', 'x'], ['a', 'b'], false), ['x']);
  assert.deepEqual(identityRows([{ id: 'seen' }], ['seen', 'manual']).map(r => [r.id, Boolean(r.observed)]), [['seen', true], ['manual', false]]);
});
