import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCardMemory } from '../dist/host/bridge/card-memory.js';

const memo = (nonce, extra = {}) => ({ kind: 'question', nonce, at: Date.now(), sub: `Q ${nonce}`, rows: [{ keyname: '会话', value: 's' }], ...extra });

test('a card is remembered and closed by its nonce, on every chat\'s task_id', () => {
  const cards = createCardMemory();
  cards.remember('qst_abc123', memo('abc123'));
  cards.remember('qst_abc123_1', memo('abc123'));
  cards.remember('qst_other1', memo('other1'));
  cards.close('abc123', { outcome: 'answered', summary: '方案 A' });
  assert.deepEqual(cards.recall('qst_abc123').closed, { outcome: 'answered', summary: '方案 A' });
  assert.deepEqual(cards.recall('qst_abc123_1').closed, { outcome: 'answered', summary: '方案 A' });
  assert.equal(cards.recall('qst_other1').closed, undefined);
  assert.equal(cards.recall('qst_nope'), undefined);
});

test('the memory is bounded in count and in age, oldest first', () => {
  let now = 1_000_000;
  const cards = createCardMemory({ maxCards: 3, maxAgeMs: 10_000, now: () => now });
  for (const id of ['a', 'b', 'c', 'd']) cards.remember(`qst_${id}`, memo(id, { at: now }));
  assert.equal(cards.recall('qst_a'), undefined, 'the oldest goes first');
  assert.ok(cards.recall('qst_d'));
  now += 20_000;
  cards.remember('qst_e', memo('e', { at: now }));
  assert.equal(cards.recall('qst_b'), undefined, 'and what is too old goes with it');
  assert.ok(cards.recall('qst_e'));
});

test('what a card said survives a restart, and a damaged file is ignored', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cards-'));
  const file = join(dir, 'cards.json');
  const first = createCardMemory({ file });
  first.remember('qst_abc123', memo('abc123'));
  first.close('abc123', { outcome: 'answered', summary: '自己回答：杭州' });
  await first.flush();
  assert.equal(JSON.parse(await readFile(file, 'utf8')).version, 1);

  const second = createCardMemory({ file });
  await second.load();
  assert.deepEqual(second.recall('qst_abc123'), first.recall('qst_abc123'));

  // Hand-edited or truncated: nothing is trusted, nothing throws.
  await writeFile(file, JSON.stringify({ version: 1, cards: [['qst_x', { kind: 'nonsense' }], ['qst_y', { kind: 'question', nonce: 'y', at: Date.now(), rows: [{ keyname: 1 }, { keyname: 'k', value: 'v' }] }], 'junk'] }));
  const third = createCardMemory({ file });
  await third.load();
  assert.equal(third.recall('qst_x'), undefined);
  assert.deepEqual(third.recall('qst_y').rows, [{ keyname: 'k', value: 'v' }]);
  await writeFile(file, '{not json');
  const errors = [];
  const fourth = createCardMemory({ file, onError: (error, stage) => errors.push(stage) });
  await fourth.load();
  assert.deepEqual(errors, ['read']);
  assert.equal(fourth.recall('qst_abc123'), undefined);
});

test('a first run has no file, and writing never throws', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cards-'));
  const errors = [];
  const cards = createCardMemory({ file: join(dir, 'nested', 'cards.json'), onError: (e, stage) => errors.push(stage) });
  await cards.load();
  assert.deepEqual(errors, [], 'a missing file is not an error');
  cards.remember('qst_a', memo('a'));
  await cards.flush();
  assert.equal(JSON.parse(await readFile(join(dir, 'nested', 'cards.json'), 'utf8')).cards.length, 1);
});
