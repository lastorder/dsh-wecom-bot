import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdminActionRegistry, pickerPages } from '../dist/host/bridge/admin-actions.js';

const workspace = index => ({
  id: `w${index}`, path: `/w/${index}`, title: `Workspace ${index}`,
  pluginOwned: false, sessionCount: 0, archivedSessionCount: 0,
});

const session = index => ({
  sessionId: `session-${String(index).padStart(4, '0')}aaaaaa`,
  title: `任务 ${index}`, workspace: 'Workspace 1', workspacePath: '/w/1',
  groupKey: 'g1', running: false, pinned: false,
});

test('picker pages stay buttons up to five and split long lists into 19', () => {
  assert.deepEqual(pickerPages(0), []);
  assert.deepEqual(pickerPages(3), [{ offset: 0, size: 3 }]);
  assert.deepEqual(pickerPages(5), [{ offset: 0, size: 5 }]);
  assert.deepEqual(pickerPages(6), [{ offset: 0, size: 6 }]);
  assert.deepEqual(pickerPages(19), [{ offset: 0, size: 19 }]);
  assert.deepEqual(pickerPages(20), [{ offset: 0, size: 19 }, { offset: 19, size: 1 }]);
  assert.deepEqual(pickerPages(30), [{ offset: 0, size: 19 }, { offset: 19, size: 11 }]);
});

test('a workspace group remembers its pages, is claimed once, and reports how it ended', () => {
  const now = 1_000;
  const actions = createAdminActionRegistry({ now: () => now });
  const workspaces = [workspace(1), workspace(2), workspace(3)];
  const opened = actions.openWorkspace({
    chat: 'root', user: 'root', purpose: 'new', workspaces, currentPath: '/w/2',
  });
  assert.equal(opened.pages.length, 1);
  assert.equal(opened.group.kind, 'workspace');
  assert.equal(opened.group.purpose, 'new');
  assert.equal(opened.group.workspaces.length, 3);
  assert.equal(opened.group.currentPath, '/w/2');

  const nonce = opened.pages[0].nonce;
  assert.equal(actions.find(nonce).group.id, opened.group.id);
  assert.equal(actions.byChat('root', 'root').id, opened.group.id);
  assert.equal(actions.byChat('root', 'someone-else'), undefined);

  assert.equal(actions.begin(nonce), true, 'the first tap claims the group');
  assert.equal(actions.begin(nonce), false, 'a second tap is ignored');
  actions.release(nonce);
  assert.equal(actions.begin(nonce), true, 'a recoverable refusal gives it back');

  actions.complete(opened.group.id, 'created', 'Workspace 2');
  assert.equal(actions.find(nonce), undefined, 'a completed group has no live pages');
  assert.deepEqual(
    { outcome: actions.outcome(nonce).outcome, summary: actions.outcome(nonce).summary },
    { outcome: 'created', summary: 'Workspace 2' },
  );
  assert.equal(actions.begin(nonce), false, 'a completed group cannot be run again');
});

test('a new picker for the same chat cancels the previous one and keeps both outcomes', () => {
  const actions = createAdminActionRegistry();
  const first = actions.openWorkspace({
    chat: 'root', user: 'root', purpose: 'new', workspaces: [workspace(1)], currentPath: '',
  });
  const second = actions.openWorkspace({
    chat: 'root', user: 'root', purpose: 'session', workspaces: [workspace(1), workspace(2)], currentPath: '/w/1',
  });
  assert.equal(actions.outcome(first.pages[0].nonce).outcome, 'cancelled');
  assert.equal(actions.find(first.pages[0].nonce), undefined);
  assert.equal(actions.find(second.pages[0].nonce).group.purpose, 'session');
});

test('a long session list is split, and completing the group closes every page', () => {
  const actions = createAdminActionRegistry();
  const sessions = Array.from({ length: 20 }, (_, index) => session(index));
  const opened = actions.openSession({
    chat: 'root', user: 'root', sessions, workspaceTitle: 'Workspace 1', currentSessionId: sessions[3].sessionId,
  });
  assert.deepEqual(opened.pages.map(page => page.offset), [0, 19]);
  assert.equal(opened.group.kind, 'session');
  assert.equal(opened.group.currentSessionId, sessions[3].sessionId);

  assert.equal(actions.begin(opened.pages[1].nonce), true);
  actions.complete(opened.group.id, 'switched', sessions[19].title);
  assert.equal(actions.find(opened.pages[0].nonce), undefined);
  assert.equal(actions.outcome(opened.pages[0].nonce).outcome, 'switched', 'a sibling page shares the outcome');
  assert.equal(actions.outcome(opened.pages[1].nonce).summary, sessions[19].title);
});

test('an expired picker and an expired terminal record are both forgotten', () => {
  let now = 10_000;
  const actions = createAdminActionRegistry({ now: () => now, ttlMs: 1_000, terminalTtlMs: 5_000 });
  const opened = actions.openWorkspace({
    chat: 'root', user: 'root', purpose: 'session', workspaces: [workspace(1)], currentPath: '',
  });
  const nonce = opened.pages[0].nonce;
  now += 1_001;
  assert.equal(actions.find(nonce), undefined, 'past the answer window');
  assert.equal(actions.outcome(nonce).outcome, 'expired');
  assert.equal(actions.byChat('root', 'root'), undefined);
  now += 5_001;
  assert.equal(actions.outcome(nonce), undefined, 'the terminal copy expires too');
});

test('clearChat and cancelAll retire pending pickers', () => {
  const actions = createAdminActionRegistry();
  const root = actions.openWorkspace({ chat: 'root', user: 'root', purpose: 'new', workspaces: [workspace(1)], currentPath: '' });
  const other = actions.openWorkspace({ chat: 'other', user: 'other', purpose: 'new', workspaces: [workspace(1)], currentPath: '' });
  actions.clearChat('root');
  assert.equal(actions.outcome(root.pages[0].nonce).outcome, 'cancelled');
  assert.ok(actions.byChat('other', 'other'), 'another chat is untouched');
  actions.cancelAll();
  assert.equal(actions.outcome(other.pages[0].nonce).outcome, 'cancelled');
});
