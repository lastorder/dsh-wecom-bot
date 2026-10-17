// The routing route's op guard: the half of the contract the page cannot test.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addGroup, addMember, deleteGroup, removeMember, setLabel, updateGroup, updateMember,
} from '../src/client/model.ts';
import { isRoutingOp } from '../dist/host/routes.js';

/**
 * Every op the settings page can post. A missing `case` in `isRoutingOp`
 * rejects the whole batch with 400, which disables a page feature without any
 * visible error — precisely how a 备注 edit once failed while looking fine.
 */
const SAMPLE_OPS = [
  addGroup(),
  addGroup('朋友'),
  updateGroup('default', { name: '默认' }),
  updateGroup('default', { workspace: '/srv/app' }),
  updateGroup('default', { provider: 'p', model: 'm', reasoningEffort: 'high' }),
  updateGroup('default', { preset: 'ptc' }),
  deleteGroup('g1'),
  addMember('default', 'user', 'alice'),
  addMember('default', 'group', 'chat-1', '研发群'),
  updateMember('user:alice', { sessionId: 's1' }),
  updateMember('user:alice', { groupId: 'g1' }),
  removeMember('user:alice'),
  setLabel('user:alice', '爱丽丝'),
  setLabel('user:alice', ''),
];

test('every op the page can build is accepted by the route', () => {
  for (const op of SAMPLE_OPS) assert.equal(isRoutingOp(op), true, JSON.stringify(op));
});

test('every op variant is represented, so a new one cannot slip through', () => {
  const covered = new Set(SAMPLE_OPS.map(op => op.op));
  assert.deepEqual([...covered].sort(), [
    'group.add', 'group.delete', 'group.update', 'label.set', 'member.add', 'member.remove', 'member.update',
  ]);
});

test('junk is rejected before it reaches the store', () => {
  for (const value of [
    undefined, null, 0, 'group.delete', [], {}, { op: 'explode' },
    { op: 'group.update' }, { op: 'group.update', id: 'default', patch: null },
    { op: 'group.delete' }, { op: 'group.delete', id: 7 },
    { op: 'member.add', groupId: 'default', kind: 'nonsense', id: 'x' },
    { op: 'member.add', kind: 'user', id: 'x' },
    { op: 'member.update', key: 'user:alice' },
    { op: 'member.remove' },
    { op: 'label.set', key: 'user:alice' }, { op: 'label.set', label: 'x' },
    { op: 'label.set', key: 'user:alice', label: 42 },
    { op: 'group.add', name: 42 },
  ]) {
    assert.equal(isRoutingOp(value), false, JSON.stringify(value));
  }
});
