import { test } from 'node:test';
import assert from 'node:assert/strict';
import { machine, loadAsync, flags, isCurrent } from './index.ts';
import { kitFor } from '../../testkit.mjs';

const kit = kitFor(machine);

test('a first load goes idle -> pending -> success, and a refetch keeps the data', () => {
  let s = kit.init();
  assert.equal(s.status, 'idle');
  assert.equal(kit.send(s, { type: 'RESOLVE', data: 1 }), s, 'an answer with nothing in flight is ignored');
  s = kit.send(s, { type: 'FETCH' });
  assert.deepEqual(flags(s), { isLoading: true, isError: false, isSuccess: false, isRefetching: false });
  s = kit.send(s, { type: 'RESOLVE', data: [1, 2], at: 5 });
  assert.equal(s.status, 'success');
  assert.equal(s.updatedAt, 5);
  s = kit.send(s, { type: 'FETCH' });
  assert.equal(s.status, 'success');
  assert.deepEqual(s.data, [1, 2]);
  assert.equal(flags(s).isRefetching, true);
  s = kit.send(s, { type: 'RESOLVE', data: [3] });
  assert.deepEqual(s.data, [3]);
  assert.equal(s.fetching, false);
});

test('a stale answer never overwrites a newer request', () => {
  let s = kit.send(kit.init(), { type: 'FETCH' });
  const first = s.request;
  s = kit.send(s, { type: 'FETCH' });
  assert.equal(s.status, 'pending');
  assert.equal(isCurrent(s, first), false);
  assert.equal(kit.send(s, { type: 'RESOLVE', data: 'old', request: first }), s);
  assert.equal(kit.send(s, { type: 'REJECT', error: 'old', request: first }), s);
  s = kit.send(s, { type: 'RESOLVE', data: 'new', request: s.request });
  assert.equal(s.data, 'new');
});

test('failures: pending -> error, a failed refetch -> error, and a retry goes pending', () => {
  let s = kit.send(kit.init(), { type: 'FETCH' });
  s = kit.send(s, { type: 'REJECT', error: 'down' });
  assert.equal(s.status, 'error');
  assert.equal(flags(s).isError, true);
  s = kit.send(s, { type: 'FETCH' });
  assert.equal(s.status, 'pending');
  s = kit.send(s, { type: 'RESOLVE', data: 1 });
  s = kit.send(s, { type: 'FETCH' });
  s = kit.send(s, { type: 'REJECT', error: 'down again' });
  assert.equal(s.status, 'error');
  assert.equal(s.data, 1, 'the last good data is kept');
  s = kit.send(s, { type: 'RESET' });
  assert.equal(s.status, 'idle');
});

test('loadAsync runs one load', async () => {
  const ok = await loadAsync(machine.init(), async () => 'rows', () => 42);
  assert.equal(ok.status, 'success');
  assert.equal(ok.updatedAt, 42);
  const bad = await loadAsync(machine.init(), async () => { throw new Error('x'); });
  assert.equal(bad.status, 'error');
});

test('the test kit covered every state, event and transition', () => kit.assertComplete());
