import { test } from 'node:test';
import assert from 'node:assert/strict';
import { machine, optimisticUpdate } from './index.ts';
import { kitFor } from '../../testkit.mjs';

const kit = kitFor(machine);
const like = (n: number) => n + 1;

test('apply then commit; a stacked change keeps the first snapshot', () => {
  let s = kit.init({ value: 10 });
  assert.equal(s.status, 'idle');
  assert.equal(kit.send(s, { type: 'COMMIT' }), s, 'nothing to commit');
  assert.equal(kit.send(s, { type: 'ROLLBACK', error: 'x' }), s, 'nothing to roll back');
  s = kit.send(s, { type: 'APPLY', update: like });
  assert.equal(s.value, 11);
  assert.equal(s.snapshot, 10);
  s = kit.send(s, { type: 'APPLY', update: like });
  assert.equal(s.status, 'applied');
  assert.equal(s.value, 12);
  assert.equal(s.snapshot, 10);
  s = kit.send(s, { type: 'COMMIT' });
  assert.equal(s.status, 'committed');
  assert.equal(s.value, 12);
  s = kit.send(s, { type: 'APPLY', update: like });
  s = kit.send(s, { type: 'COMMIT', value: 20 });
  assert.equal(s.value, 20, 'the server\'s answer wins');
});

test('apply then roll back puts the old value back, and a new change can follow', () => {
  let s = kit.send(kit.init({ value: ['a'] }), { type: 'APPLY', update: (l: string[]) => [...l, 'b'] });
  assert.deepEqual(s.value, ['a', 'b']);
  s = kit.send(s, { type: 'ROLLBACK', error: 'offline' });
  assert.equal(s.status, 'rolledBack');
  assert.deepEqual(s.value, ['a']);
  assert.equal(s.error, 'offline');
  s = kit.send(s, { type: 'APPLY', update: (l: string[]) => [...l, 'c'] });
  assert.equal(s.status, 'applied');
  assert.equal(s.error, null);
});

test('optimisticUpdate saves or rolls back', async () => {
  const ok = await optimisticUpdate(machine.init({ value: 1 }), like, async () => undefined);
  assert.deepEqual([ok.status, ok.value], ['committed', 2]);
  const answered = await optimisticUpdate(machine.init({ value: 1 }), like, async (v: number) => v * 10);
  assert.equal(answered.value, 20);
  const failed = await optimisticUpdate(machine.init({ value: 1 }), like, async () => { throw new Error('500'); });
  assert.deepEqual([failed.status, failed.value], ['rolledBack', 1]);
});

test('the test kit covered every state, event and transition', () => kit.assertComplete());
