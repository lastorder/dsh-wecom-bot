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

test('observations are bounded, expire, and keep only refused text', () => {
  let clock = 1000;
  const store = createObservationStore({ ttlMs: 100, maxTextChars: 8, now: () => clock });
  const long = '消息 3 的内容很长很长';
  for (let i = 0; i < 4; i++) {
    store.record({ chat: `room-${i}`, user: `user-${i}`, chatType: 'group', accepted: i % 2 === 0, text: `消息 ${i} 的内容很长很长` });
  }
  // A group message is remembered as its conversation; only refusals are
  // listed, newest first, each with a bounded single-line excerpt.
  assert.deepEqual(store.rejected(() => false).map(row => row.id), ['room-3', 'room-1']);
  assert.equal(store.rejected(() => false)[0].text, `${long.slice(0, 8)}…`);
  assert.equal(store.rejected(() => false)[0].chatType, 'group');
  assert.deepEqual(store.stats('group', 'room-2'), { messages: 1, lastSeenAt: 1000 }, 'accepted traffic is counted');

  // An accepted sender's text is dropped but its counters survive.
  store.record({ chat: 'room-3', user: 'user-3', chatType: 'group', accepted: true, text: '这次通过了' });
  assert.deepEqual(store.stats('group', 'room-3'), { messages: 2, lastSeenAt: 1000 });
  assert.deepEqual(store.rejected(() => false).map(row => row.id), ['room-1']);

  // A private chat is remembered by its sender.
  assert.equal(store.isPrivateChat('user-9'), false);
  store.record({ chat: 'user-9', user: 'user-9', chatType: 'single', accepted: false, text: '你好' });
  assert.equal(store.isPrivateChat('user-9'), true);
  assert.deepEqual(store.stats('user', 'user-9'), { messages: 1, lastSeenAt: 1000 });
  assert.deepEqual(store.rejected(() => false).map(row => row.key), ['user:user-9', 'group:room-1']);

  // An authorized sender disappears from the refusal list without being forgotten.
  assert.deepEqual(store.rejected(key => key === 'user:user-9').map(row => row.key), ['group:room-1']);

  // Nothing survives its TTL.
  clock += 101;
  assert.deepEqual(store.rejected(() => false), []);
  assert.deepEqual(store.stats('group', 'room-3'), { messages: 0 });
  assert.equal(store.isPrivateChat('user-9'), false);

  // The oldest principals are evicted once the cap is reached.
  const small = createObservationStore({ maxEntries: 2, now: () => clock });
  for (let i = 0; i < 3; i++) small.record({ chat: `r${i}`, user: `u${i}`, chatType: 'group', accepted: false });
  assert.deepEqual(small.rejected(() => false).map(row => row.id), ['r2', 'r1']);
});
