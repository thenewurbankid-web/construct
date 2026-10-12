import { test } from 'node:test';
import assert from 'node:assert/strict';
import { machine, paginate, pageCount, clampPage, pageItems, sliceBounds, canNext, canPrevious } from './index.ts';
import { kitFor } from '../../testkit.mjs';

const kit = kitFor(machine);
const rows = Array.from({ length: 25 }, (_, i) => i + 1);

test('page facts: count, clamp and slice', () => {
  assert.equal(pageCount(0, 10), 1);
  assert.equal(pageCount(25, 10), 3);
  assert.equal(pageCount(30, 10), 3);
  assert.equal(clampPage(-1, 25, 10), 0);
  assert.equal(clampPage(9, 25, 10), 2);
  assert.deepEqual(paginate(rows, 2, 10), { items: [21, 22, 23, 24, 25], pageIndex: 2, pageCount: 3, canNext: false, canPrevious: true });
});

test('NEXT walks first -> middle -> last and stops; PREVIOUS walks back', () => {
  let s = kit.init({ total: 25, pageSize: 10 });
  assert.equal(s.status, 'first');
  assert.equal(kit.send(s, { type: 'PREVIOUS' }), s, 'no page before the first');
  s = kit.send(s, { type: 'NEXT' });
  assert.equal(s.status, 'middle');
  assert.deepEqual(pageItems(rows, s), [11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
  s = kit.send(s, { type: 'NEXT' });
  assert.equal(s.status, 'last');
  assert.deepEqual(sliceBounds(s), { start: 20, end: 25 });
  assert.equal(kit.send(s, { type: 'NEXT' }), s, 'no page after the last');
  s = kit.send(s, { type: 'PREVIOUS' });
  assert.equal(s.status, 'middle');
  s = kit.send(s, { type: 'PREVIOUS' });
  assert.equal(s.status, 'first');
});

test('longer lists: middle -> middle both ways, first -> last on two pages', () => {
  let s = kit.init({ total: 50, pageSize: 10, pageIndex: 1 });
  s = kit.send(s, { type: 'NEXT' });
  assert.equal(s.status, 'middle');
  s = kit.send(s, { type: 'PREVIOUS' });
  assert.equal(s.status, 'middle');
  assert.equal(s.pageIndex, 1);
  let two = kit.init({ total: 15, pageSize: 10 });
  two = kit.send(two, { type: 'NEXT' });
  assert.equal(two.status, 'last');
  two = kit.send(two, { type: 'PREVIOUS' });
  assert.equal(two.status, 'first');
  assert.equal(canNext(two), true);
  assert.equal(canPrevious(two), false);
});

test('GO_TO picks a page, clamped; the same page is a no-op', () => {
  let s = kit.init({ total: 50, pageSize: 10 });
  assert.equal(kit.send(s, { type: 'GO_TO', pageIndex: 0 }), s);
  s = kit.send(s, { type: 'GO_TO', pageIndex: 99 });
  assert.equal(s.status, 'last');
  assert.equal(s.pageIndex, 4);
  s = kit.send(s, { type: 'GO_TO', pageIndex: 2 });
  assert.equal(s.status, 'middle');
  s = kit.send(s, { type: 'GO_TO', pageIndex: -3 });
  assert.equal(s.status, 'first');
});

test('SET_PAGE_SIZE keeps the first row on screen and reaches every position', () => {
  let s = kit.init({ total: 50, pageSize: 10, pageIndex: 2 });
  assert.equal(kit.send(s, { type: 'SET_PAGE_SIZE', pageSize: 0 }), s, 'a page size below one is refused');
  s = kit.send(s, { type: 'SET_PAGE_SIZE', pageSize: 5 });
  assert.equal(s.pageIndex, 4, 'row 21 is on page 5 of 5 rows');
  assert.equal(s.status, 'middle');
  s = kit.send(s, { type: 'SET_PAGE_SIZE', pageSize: 25 });
  assert.equal(s.status, 'first');
  s = kit.send(s, { type: 'GO_TO', pageIndex: 1 });
  s = kit.send(s, { type: 'SET_PAGE_SIZE', pageSize: 10 });
  assert.equal(s.pageIndex, 2, 'row 26 is on page 3 of 10 rows');
  s = kit.send(s, { type: 'GO_TO', pageIndex: 4 });
  s = kit.send(s, { type: 'SET_PAGE_SIZE', pageSize: 20 });
  assert.equal(s.status, 'last', 'row 41 is on the last of 3 pages of 20');
  s = kit.send(s, { type: 'SET_PAGE_SIZE', pageSize: 100 });
  assert.equal(s.status, 'only');
  const none = kit.init({ total: 0, pageSize: 10 });
  assert.equal(none.status, 'empty');
  assert.equal(kit.send(none, { type: 'SET_PAGE_SIZE', pageSize: 5 }).status, 'empty');
});

test('SET_TOTAL keeps the page inside the list as it grows and shrinks', () => {
  let s = kit.init({ total: 50, pageSize: 10, pageIndex: 3 });
  s = kit.send(s, { type: 'SET_TOTAL', total: 60 });
  assert.equal(s.status, 'middle');
  s = kit.send(s, { type: 'SET_TOTAL', total: 31 });
  assert.equal(s.status, 'last');
  assert.equal(s.pageIndex, 3);
  s = kit.send(s, { type: 'SET_TOTAL', total: 8 });
  assert.equal(s.status, 'only');
  assert.equal(s.pageIndex, 0);
  s = kit.send(s, { type: 'SET_TOTAL', total: 0 });
  assert.equal(s.status, 'empty');
  assert.deepEqual(pageItems([], s), []);
  s = kit.send(s, { type: 'SET_TOTAL', total: 30 });
  assert.equal(s.status, 'first');
});

test('the test kit covered every state, event and transition', () => kit.assertComplete());
