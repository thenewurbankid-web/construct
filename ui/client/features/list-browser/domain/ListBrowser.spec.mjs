import test from 'node:test';
import assert from 'node:assert/strict';
import { filterItems, countText } from './ListFilter.ts';
import { listNextIndex, tabStopIndex, isSelectKey } from './ListNav.ts';
import { readSelection, withSelection, validSelection } from './QuerySelection.ts';

const items = [
  { id: 'a', label: 'BillingView', detail: 'features/billing/components/BillingView.tsx' },
  { id: 'b', label: 'CartView', detail: 'features/cart/components/CartView.tsx' },
  { id: 'c', label: 'Plain' },
];

test('filter: every word must match the label or the detail, any order, any case', () => {
  assert.deepEqual(filterItems(items, '').map((i) => i.id), ['a', 'b', 'c']);
  assert.deepEqual(filterItems(items, '   ').map((i) => i.id), ['a', 'b', 'c']);
  assert.deepEqual(filterItems(items, 'view').map((i) => i.id), ['a', 'b']);
  assert.deepEqual(filterItems(items, 'CART view').map((i) => i.id), ['b']);
  assert.deepEqual(filterItems(items, 'components billing').map((i) => i.id), ['a']);
  assert.deepEqual(filterItems(items, 'zzz'), []);
  assert.equal(countText(2, 3, 'view'), '2 of 3');
  assert.equal(countText(3, 3, ' '), '3');
});

test('list keys: Up/Down stop at the ends, Home/End jump, other keys are not the list\'s', () => {
  assert.equal(listNextIndex('ArrowDown', 0, 3), 1);
  assert.equal(listNextIndex('ArrowDown', 2, 3), 2);
  assert.equal(listNextIndex('ArrowUp', 0, 3), 0);
  assert.equal(listNextIndex('ArrowUp', 2, 3), 1);
  assert.equal(listNextIndex('Home', 2, 3), 0);
  assert.equal(listNextIndex('End', 0, 3), 2);
  assert.equal(listNextIndex('a', 0, 3), null);
  assert.equal(listNextIndex('ArrowDown', 0, 0), null);
  assert.equal(isSelectKey('Enter'), true);
  assert.equal(isSelectKey(' '), true);
  assert.equal(isSelectKey('x'), false);
});

test('tab stop: the selected row when it is showing, else the first', () => {
  assert.equal(tabStopIndex(['a', 'b', 'c'], 'c'), 2);
  assert.equal(tabStopIndex(['a', 'b', 'c'], 'zzz'), 0);
  assert.equal(tabStopIndex(['a', 'b', 'c'], null), 0);
  assert.equal(tabStopIndex([], 'a'), 0);
});

test('selection in the URL: read, set, clear, keep other params, and refuse a stale name', () => {
  assert.equal(readSelection('?feature=billing', 'feature'), 'billing');
  assert.equal(readSelection('?other=1', 'feature'), null);
  assert.equal(readSelection('?feature=', 'feature'), null);
  assert.equal(readSelection(`?feature=${'x'.repeat(600)}`, 'feature'), null);
  assert.equal(withSelection('', 'feature', 'billing'), '?feature=billing');
  assert.equal(withSelection('?a=1', 'feature', 'a b/c'), '?a=1&feature=a+b%2Fc');
  assert.equal(withSelection('?feature=x&a=1', 'feature', null), '?a=1');
  assert.equal(withSelection('?feature=x', 'feature', null), '');
  assert.equal(validSelection(['a', 'b'], 'b'), 'b');
  assert.equal(validSelection(['a', 'b'], 'nope'), null);
  assert.equal(validSelection(['a', 'b'], null), null);
});
