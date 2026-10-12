import { test } from 'node:test';
import assert from 'node:assert/strict';
import { machine, applyView, filterSort, compareValues, matchesSearch, isNoFilter } from './index.ts';
import { kitFor } from '../../testkit.mjs';

const kit = kitFor(machine);
type P = { name: string; category: string; price: number | null };
const products: P[] = [
  { name: 'Ceramic Mug', category: 'Home', price: 12 },
  { name: 'Linen Shirt', category: 'Clothing', price: 48 },
  { name: 'Desk Lamp', category: 'Home', price: 35 },
  { name: 'Earbuds', category: 'Electronics', price: null },
  { name: 'Wool Socks', category: 'Clothing', price: 9 },
];
const names = (rows: P[]) => rows.map((r) => r.name);

test('filters: a category, "all", another value, and clearing', () => {
  let s = kit.init();
  assert.equal(s.status, 'unfiltered');
  s = kit.send(s, { type: 'SET_FILTER', id: 'category', value: 'all' });
  assert.equal(s.status, 'unfiltered', '"all" is no filter');
  assert.equal(kit.send(s, { type: 'SET_FILTER', id: 'category', value: 'all' }), s);
  s = kit.send(s, { type: 'SET_FILTER', id: 'category', value: 'Home' });
  assert.equal(s.status, 'filtered');
  assert.deepEqual(names(applyView(products, s)), ['Ceramic Mug', 'Desk Lamp']);
  s = kit.send(s, { type: 'SET_FILTER', id: 'category', value: 'Clothing' });
  assert.deepEqual(names(applyView(products, s)), ['Linen Shirt', 'Wool Socks']);
  s = kit.send(s, { type: 'SET_FILTER', id: 'category', value: '' });
  assert.equal(s.status, 'unfiltered');
  s = kit.send(s, { type: 'CLEAR_FILTER', id: 'category' });
  assert.equal(s.status, 'unfiltered');
  assert.equal(kit.send(s, { type: 'CLEAR_FILTER', id: 'category' }), s, 'clearing a filter that is not set is a no-op');
  s = kit.send(s, { type: 'SET_FILTER', id: 'category', value: 'Home' });
  s = kit.send(s, { type: 'SET_FILTER', id: 'name', value: 'Desk Lamp' });
  s = kit.send(s, { type: 'CLEAR_FILTER', id: 'name' });
  assert.equal(s.status, 'filtered');
  s = kit.send(s, { type: 'CLEAR_FILTER', id: 'category' });
  assert.equal(s.status, 'unfiltered');
});

test('search ignores case and combines with a filter', () => {
  let s = kit.init();
  s = kit.send(s, { type: 'SET_SEARCH', text: '   ' });
  assert.equal(s.status, 'unfiltered', 'blank text is no search');
  s = kit.send(s, { type: 'SET_SEARCH', text: 'MUG' });
  assert.equal(s.status, 'filtered');
  assert.deepEqual(names(applyView(products, s, ['name'])), ['Ceramic Mug']);
  assert.equal(kit.send(s, { type: 'SET_SEARCH', text: 'MUG' }), s);
  s = kit.send(s, { type: 'SET_SEARCH', text: 's' });
  s = kit.send(s, { type: 'SET_FILTER', id: 'category', value: 'Clothing' });
  assert.deepEqual(names(applyView(products, s, ['name'])), ['Linen Shirt', 'Wool Socks']);
  s = kit.send(s, { type: 'SET_FILTER', id: 'category', value: 'all' });
  s = kit.send(s, { type: 'SET_SEARCH', text: '' });
  assert.equal(s.status, 'unfiltered');
  assert.equal(applyView(products, s, ['name']).length, 5);
});

test('sorting: by a column, toggling none -> asc -> desc -> none, empty values last both ways', () => {
  let s = kit.init();
  s = kit.send(s, { type: 'SORT_BY', id: 'price' });
  assert.deepEqual(names(applyView(products, s)), ['Wool Socks', 'Ceramic Mug', 'Desk Lamp', 'Linen Shirt', 'Earbuds']);
  s = kit.send(s, { type: 'SORT_BY', id: 'price', desc: true });
  assert.deepEqual(names(applyView(products, s)), ['Linen Shirt', 'Desk Lamp', 'Ceramic Mug', 'Wool Socks', 'Earbuds']);
  s = kit.send(s, { type: 'TOGGLE_SORT', id: 'name' });
  assert.deepEqual(s.sort, { id: 'name', desc: false });
  s = kit.send(s, { type: 'TOGGLE_SORT', id: 'name' });
  assert.deepEqual(s.sort, { id: 'name', desc: true });
  assert.equal(applyView(products, s)[0].name, 'Wool Socks');
  s = kit.send(s, { type: 'TOGGLE_SORT', id: 'name' });
  assert.equal(s.sort, null);
  s = kit.send(s, { type: 'SET_FILTER', id: 'category', value: 'Home' });
  s = kit.send(s, { type: 'SORT_BY', id: 'name', desc: true });
  assert.equal(s.status, 'filtered');
  assert.deepEqual(names(applyView(products, s)), ['Desk Lamp', 'Ceramic Mug']);
  s = kit.send(s, { type: 'TOGGLE_SORT', id: 'price' });
  assert.equal(s.status, 'filtered');
  s = kit.send(s, { type: 'RESET' });
  assert.deepEqual(s, machine.init());
});

test('helpers: compareValues, matchesSearch, isNoFilter, filterSort in one call', () => {
  assert.ok(compareValues('item 2', 'item 10') < 0, 'numbers inside text compare by value');
  assert.ok(compareValues(new Date(1), new Date(2)) < 0);
  assert.equal(compareValues(null, ''), 0);
  assert.ok(compareValues(1, null) < 0);
  assert.equal(matchesSearch({ a: 'Hello' }, 'ell', ['a']), true);
  assert.equal(isNoFilter('all'), true);
  assert.equal(isNoFilter(0), false);
  assert.deepEqual(names(filterSort(products, { search: 'E', searchFields: ['name'], sort: { id: 'name', desc: false } })), ['Ceramic Mug', 'Desk Lamp', 'Earbuds', 'Linen Shirt']);
});

test('the test kit covered every state, event and transition', () => kit.assertComplete());
