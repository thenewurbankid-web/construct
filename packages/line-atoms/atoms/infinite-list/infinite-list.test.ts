import { test } from 'node:test';
import assert from 'node:assert/strict';
import { machine, loadMore, items, hasNextPage, isFetchingNextPage, nextCursor } from './index.ts';
import { kitFor } from '../../testkit.mjs';

const kit = kitFor(machine);

test('first page, next pages, and the end of the list', () => {
  let s = kit.init();
  assert.equal(hasNextPage(s), false);
  assert.equal(nextCursor(s), null);
  assert.equal(kit.send(s, { type: 'FETCH_NEXT' }), s, 'no next page before the first one');
  s = kit.send(s, { type: 'FETCH_FIRST' });
  assert.equal(kit.send(s, { type: 'FETCH_FIRST' }), s, 'one load at a time');
  assert.equal(isFetchingNextPage(s), false, 'the first page is not a next page');
  s = kit.send(s, { type: 'RESOLVE', cursor: null, items: [1, 2], nextCursor: 2 });
  assert.equal(s.status, 'success');
  assert.equal(hasNextPage(s), true);
  s = kit.send(s, { type: 'FETCH_NEXT' });
  assert.equal(isFetchingNextPage(s), true);
  assert.equal(kit.send(s, { type: 'RESOLVE', cursor: 99, items: [9], nextCursor: null }), s, 'an answer for another cursor is ignored');
  s = kit.send(s, { type: 'RESOLVE', cursor: 2, items: [3, 4], nextCursor: null });
  assert.deepEqual(items(s), [1, 2, 3, 4]);
  assert.equal(hasNextPage(s), false);
  assert.equal(kit.send(s, { type: 'FETCH_NEXT' }), s, 'the end of the list');
  assert.equal(kit.send(s, { type: 'REJECT', cursor: 2, error: 'x' }), s, 'nothing in flight');
  s = kit.send(s, { type: 'FETCH_FIRST' });
  assert.equal(s.status, 'pending');
  assert.deepEqual(items(s), [], 'a refresh starts from the first page');
});

test('failures: the first page, a next page, a retry that fails and one that works', () => {
  let s = kit.send(kit.init(), { type: 'FETCH_FIRST' });
  s = kit.send(s, { type: 'REJECT', cursor: null, error: 'down' });
  assert.equal(s.status, 'error');
  s = kit.send(s, { type: 'FETCH_FIRST' });
  s = kit.send(s, { type: 'RESOLVE', cursor: null, items: ['a'], nextCursor: 'b' });
  s = kit.send(s, { type: 'FETCH_NEXT' });
  s = kit.send(s, { type: 'REJECT', cursor: 'b', error: 'down' });
  assert.equal(s.status, 'error');
  assert.deepEqual(items(s), ['a'], 'loaded pages are kept');
  s = kit.send(s, { type: 'FETCH_NEXT' });
  assert.equal(s.status, 'error');
  s = kit.send(s, { type: 'REJECT', cursor: 'b', error: 'again' });
  s = kit.send(s, { type: 'FETCH_NEXT' });
  s = kit.send(s, { type: 'RESOLVE', cursor: 'b', items: ['b'], nextCursor: null });
  assert.equal(s.status, 'success');
  s = kit.send(s, { type: 'FETCH_FIRST' });
  s = kit.send(s, { type: 'FETCH_NEXT' });
  s = kit.send(s, { type: 'RESET' });
  assert.equal(s.status, 'pending');
  s = kit.send(s, { type: 'FETCH_FIRST' });
  s = kit.send(s, { type: 'RESOLVE', cursor: null, items: [], nextCursor: 1 });
  s = kit.send(s, { type: 'FETCH_FIRST' });
  s = kit.send(s, { type: 'REJECT', cursor: null, error: 'x' });
  s = kit.send(s, { type: 'FETCH_FIRST' });
  s = kit.send(s, { type: 'RESOLVE', cursor: null, items: [], nextCursor: 1 });
  s = kit.send(s, { type: 'FETCH_NEXT' });
  s = kit.send(s, { type: 'REJECT', cursor: 1, error: 'x' });
  s = kit.send(s, { type: 'RESET' });
  s = kit.send(s, { type: 'FETCH_FIRST' });
  s = kit.send(s, { type: 'RESOLVE', cursor: null, items: [1], nextCursor: 2 });
  s = kit.send(s, { type: 'FETCH_NEXT' });
  s = kit.send(s, { type: 'REJECT', cursor: 2, error: 'x' });
  s = kit.send(s, { type: 'FETCH_FIRST' });
  assert.equal(s.status, 'pending');
});

test('loadMore loads the first page, then each next page, until there is none', async () => {
  const data = ['a', 'b', 'c', 'd', 'e'];
  const load = async (cursor: string | number | null) => { const at = Number(cursor ?? 0); return { items: data.slice(at, at + 2), nextCursor: at + 2 < data.length ? at + 2 : null }; };
  let s = machine.init();
  for (let i = 0; i < 5; i++) s = await loadMore(s, load);
  assert.deepEqual(items(s), data);
  assert.equal(hasNextPage(s), false);
  const failed = await loadMore(machine.init(), async () => { throw new Error('x'); });
  assert.equal(failed.status, 'error');
});

test('the test kit covered every state, event and transition', () => kit.assertComplete());
