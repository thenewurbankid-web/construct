import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrayEntries, existingAtoms } from './array.mjs';

const byKey = (key) => arrayEntries().find((e) => e.key === key);
const atomsOf = (entry) => entry.candidates.map((c) => c.atom);

test('arrayEntries returns every C1 entry in section Array', () => {
  const entries = arrayEntries();
  assert.equal(entries.length, 67);
  assert.ok(entries.every((e) => e.section === 'Array' && Array.isArray(e.candidates)));
});

test('with-candidate count is recorded', () => {
  assert.equal(arrayEntries().filter((e) => e.candidates.length > 0).length, 55);
});

test('Array.prototype.includes matches hasItem', () => {
  const entry = byKey('Array.prototype.includes');
  assert.ok(atomsOf(entry).includes('hasItem'));
  const hasItem = entry.candidates.find((c) => c.atom === 'hasItem');
  assert.equal(typeof hasItem.fluent, 'string');
  assert.deepEqual(hasItem.js, ['list.includes(item, fromIndex)']);
});

test('Array.prototype.flatMap matches flatMapEach only', () => {
  assert.deepEqual(atomsOf(byKey('Array.prototype.flatMap')), ['flatMapEach']);
});

test('static Array.from and Array.isArray match by the static call', () => {
  assert.ok(atomsOf(byKey('Array.from')).includes('listFrom'));
  assert.ok(atomsOf(byKey('Array.from #2')).includes('listFrom'));
  assert.deepEqual(atomsOf(byKey('Array.isArray')), ['isList']);
});

test('property and symbol/index entries', () => {
  assert.ok(atomsOf(byKey('Array.prototype.length')).includes('lengthOf'));
  assert.deepEqual(existingAtoms(byKey('Array.prototype.[Symbol.iterator]')), []);
  assert.deepEqual(existingAtoms(byKey('Array.prototype.[index]')), []);
});
