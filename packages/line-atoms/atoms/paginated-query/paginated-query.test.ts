import { test } from 'node:test';
import assert from 'node:assert/strict';
import { machine, loadPage, pageRequest, hasNextPage, hasPreviousPage } from './index.ts';
import { kitFor } from '../../testkit.mjs';

const kit = kitFor(machine);
const all = Array.from({ length: 23 }, (_, i) => `item-${i}`);
const page = (pageIndex: number, pageSize = 10) => ({ type: 'RESOLVE' as const, pageIndex, items: all.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize), total: all.length });

test('the first page loads, then NEXT keeps it on screen as a placeholder', () => {
  let s = kit.init({ pageSize: 10 });
  assert.equal(s.status, 'pending');
  assert.equal(kit.send(s, page(0)), s, 'an answer nobody asked for is ignored');
  s = kit.send(s, { type: 'FETCH' });
  assert.equal(kit.send(s, { type: 'FETCH' }), s, 'one fetch at a time');
  s = kit.send(s, page(0));
  assert.equal(s.status, 'success');
  assert.equal(s.items.length, 10);
  assert.equal(hasNextPage(s), true);
  assert.equal(hasPreviousPage(s), false);
  assert.equal(kit.send(s, { type: 'PREVIOUS' }), s);
  s = kit.send(s, { type: 'NEXT' });
  assert.equal(s.placeholder, true);
  assert.equal(s.items[0], 'item-0', 'the previous page stays on screen');
  assert.deepEqual(pageRequest(s), { pageIndex: 1, pageSize: 10, offset: 10 });
  assert.equal(kit.send(s, page(0)), s, 'an answer for a page no longer asked for is ignored');
  s = kit.send(s, page(1));
  assert.equal(s.items[0], 'item-10');
  assert.equal(s.placeholder, false);
  s = kit.send(s, { type: 'GO_TO', pageIndex: 9 });
  assert.equal(s.pageIndex, 2, 'GO_TO is clamped to the pages that exist');
  s = kit.send(s, page(2));
  assert.equal(hasNextPage(s), false);
  assert.equal(kit.send(s, { type: 'NEXT' }), s);
  s = kit.send(s, { type: 'PREVIOUS' });
  s = kit.send(s, page(1));
  s = kit.send(s, { type: 'FETCH' });
  assert.equal(s.status, 'success');
  s = kit.send(s, page(1));
  assert.equal(kit.send(s, { type: 'GO_TO', pageIndex: 1 }), s, 'the same page is a no-op');
});

test('failures: a first page, a later page, and a failed retry each end in error', () => {
  let s = kit.send(kit.init({}), { type: 'FETCH' });
  s = kit.send(s, { type: 'REJECT', pageIndex: 0, error: 'down' });
  assert.equal(s.status, 'error');
  s = kit.send(s, { type: 'FETCH' });
  assert.equal(s.status, 'error');
  s = kit.send(s, { type: 'REJECT', pageIndex: 0, error: 'still down' });
  assert.equal(s.error, 'still down');
  s = kit.send(s, { type: 'FETCH' });
  s = kit.send(s, page(0));
  assert.equal(s.status, 'success', 'a retry that works recovers');
  s = kit.send(s, { type: 'NEXT' });
  s = kit.send(s, { type: 'REJECT', pageIndex: 1, error: 'page 2 down' });
  assert.equal(s.status, 'error');
  assert.equal(s.placeholder, false);
  s = kit.send(s, { type: 'PREVIOUS' });
  assert.equal(s.status, 'error');
  assert.equal(s.pageIndex, 0);
  s = kit.send(s, { type: 'REJECT', pageIndex: 0, error: 'x' });
  s = kit.send(s, { type: 'NEXT' });
  assert.equal(s.pageIndex, 1);
  s = kit.send(s, { type: 'REJECT', pageIndex: 1, error: 'x' });
  s = kit.send(s, { type: 'GO_TO', pageIndex: 2 });
  assert.equal(s.status, 'error');
  s = kit.send(s, { type: 'REJECT', pageIndex: 2, error: 'x' });
  s = kit.send(s, { type: 'SET_PAGE_SIZE', pageSize: 5 });
  assert.equal(s.status, 'error');
  assert.equal(s.pageIndex, 4, 'item 20 is on page 5 of 5 items');
});

test('SET_PAGE_SIZE before and after the first page', () => {
  let s = kit.init({ pageSize: 10 });
  s = kit.send(s, { type: 'SET_PAGE_SIZE', pageSize: 5 });
  assert.equal(s.status, 'pending');
  assert.equal(kit.send(s, { type: 'SET_PAGE_SIZE', pageSize: 5 }), s);
  s = kit.send(s, page(0, 5));
  s = kit.send(s, { type: 'SET_PAGE_SIZE', pageSize: 20 });
  assert.equal(s.status, 'success');
  assert.equal(s.placeholder, true);
});

test('loadPage loads the page the state asks for', async () => {
  const asked: number[] = [];
  const load = async (req: { pageIndex: number; pageSize: number; offset: number }) => { asked.push(req.offset); return { items: all.slice(req.offset, req.offset + req.pageSize), total: all.length }; };
  let s = await loadPage(machine.init({ pageSize: 10 }), load);
  assert.equal(s.status, 'success');
  s = await loadPage(machine.send(s, { type: 'NEXT' }), load);
  assert.equal(s.items[0], 'item-10');
  assert.deepEqual(asked, [0, 10]);
  const failed = await loadPage(machine.init({}), async () => { throw new Error('x'); });
  assert.equal(failed.status, 'error');
});

test('the test kit covered every state, event and transition', () => kit.assertComplete());
