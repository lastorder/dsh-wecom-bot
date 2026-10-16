import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalog, catalogView, createCatalogService } from '../dist/host/catalog.js';
import { createObservationStore } from '../dist/host/observation.js';

const row = (sessionId, updatedAt, extra = {}) => ({ sessionId, updatedAt, running: false, blank: false, ...extra });
const titled = title => ({ projections: { values: { title } } });

test('catalog follows the DSH sidebar: Workspace order, pinned first, then most recent; ungrouped last', () => {
  const items = [
    row('a', 10, titled('A')), row('b', 30, titled('B')), row('c', 20, titled('C')),
    row('arch', 99, titled('Archived')), row('sub', 98, { origin: 'subagent' }), row('blank', 97, { blank: true }),
    row('loose', 5, titled('Loose')), row('other', 50, titled('Other')),
  ];
  const registry = {
    list: () => [
      { id: 'w2', path: '/r/two', title: 'default-workspace', sessionIds: ['other'] },
      { id: 'w1', path: '/r/one', title: '', sessionIds: ['a', 'b', 'c', 'arch', 'sub', 'blank'] },
      { id: 'w3', path: '/r/empty', title: 'Empty', sessionIds: [] },
    ],
    archivedSessionIds: ['arch'],
    pinnedSessionIds: ['a'],
  };
  const catalog = buildCatalog(items, registry, 1);
  assert.deepEqual(catalog.groups.map(g => [g.title, g.sessions.map(s => s.sessionId)]), [
    ['默认工作区', ['other']],
    ['one', ['a', 'b', 'c']],
    ['未分组', ['loose']],
  ]);
  assert.equal(catalog.get('a').pinned, true);
  assert.equal(catalog.get('a').title, 'A');
  assert.equal(catalog.get('arch'), undefined);
  assert.equal(catalog.hiddenReason('arch'), 'archived');
  assert.equal(catalog.hiddenReason('sub'), 'subagent');
  assert.equal(catalog.hiddenReason('blank'), 'blank');
  assert.equal(catalog.hiddenReason('gone'), 'missing');
  assert.equal(catalog.archivedCount, 1);
  const view = catalogView(catalog, ['a', 'arch', 'gone']);
  assert.deepEqual(view.hiddenSelections, [
    { sessionId: 'arch', title: 'Archived', reason: 'archived' },
    { sessionId: 'gone', title: null, reason: 'missing' },
  ]);
  assert.equal(view.total, 5);
});

test('without a Workspace registry the catalog groups by working directory', () => {
  const catalog = buildCatalog([row('x', 1, { cwd: '/p/old' }), row('y', 9, { cwd: '/p/new' }), row('z', 5)], undefined);
  assert.deepEqual(catalog.groups.map(g => [g.kind, g.title]), [['directory', 'new'], ['directory', 'old'], ['ungrouped', '未分组']]);
});

test('catalog service caches for its TTL, shares in-flight reads and supports forced refresh', async () => {
  let calls = 0;
  let clock = 0;
  const service = createCatalogService({
    list: async () => { calls++; return [row('s', 1)]; },
    registry: () => undefined,
  }, { ttlMs: 100, now: () => clock });
  await Promise.all([service.load(), service.load()]);
  assert.equal(calls, 1);
  clock = 50; await service.load();
  assert.equal(calls, 1);
  await service.load({ force: true });
  assert.equal(calls, 2);
  clock = 500; await service.load();
  assert.equal(calls, 3);
  service.invalidate(); await service.load();
  assert.equal(calls, 4);
});

test('observations are bounded, expire, keep decisions, and track eligible sources separately', () => {
  let clock = 1000;
  const store = createObservationStore({ maxEntries: 3, ttlMs: 100, now: () => clock });
  for (let i = 0; i < 5; i++) store.record({ chat: `room-${i}`, user: `user-${i}`, chatType: 'group', decision: i % 2 ? 'rejected' : 'accepted', ...(i % 2 ? { reason: 'user' } : {}) });
  let snapshot = store.snapshot();
  assert.deepEqual(snapshot.users.map(u => u.id), ['user-4', 'user-3', 'user-2']);
  assert.deepEqual(snapshot.chats[1], { id: 'room-3', firstSeenAt: 1000, lastSeenAt: 1000, messages: 1, decision: 'rejected', reason: 'user', chatType: 'group', via: 'user-3' });
  store.record({ chat: 'user-4', user: 'user-4', chatType: 'single', decision: 'accepted' });
  assert.equal(store.snapshot().users[0].messages, 2);
  store.markEligible('user-4', 'user-4');
  assert.deepEqual(store.eligibleSources(), [{ chat: 'user-4', user: 'user-4' }]);
  clock += 101;
  snapshot = store.snapshot();
  assert.deepEqual(snapshot, { users: [], chats: [] });
  assert.deepEqual(store.eligibleSources(), []);
});
