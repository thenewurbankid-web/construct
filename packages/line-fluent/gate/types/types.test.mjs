import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkTypes, typeReport, tsCategories } from './types.mjs';

const ref = JSON.parse(
  readFileSync(new URL('../../../line-codemod/bench/atoms/js-reference/reference.json', import.meta.url), 'utf8'),
);
const byKey = (key) => {
  const e = ref.entries.find((x) => x.key === key);
  assert.ok(e, `reference has ${key}`);
  return e;
};

const answer = (over) => ({
  entry: 'x', decision: 'new-atom', atom: 'a', existing: null, kind: 'value',
  sentence: 's', js: 'j', params: [], parts: null, reason: null, ...over,
});

const RIGHT = [
  ['Array.prototype.includes', { kind: 'question', params: [['list', 'list'], ['item', 'prim'], ['fromIndex', 'num']] }],
  ['Array.prototype.map', { kind: 'copy', params: [['xs', 'list'], ['f', 'fn']] }],
  ['String.prototype.padStart', { kind: 'value', params: [['text', 'shorttext'], ['length', 'nat'], ['fill', 'shorttext']] }],
  ['Math.max', { kind: 'value', params: [['numbers', 'nums']] }],
  ['Math.abs', { kind: 'value', params: [['n', 'num']] }],
];

for (const [key, over] of RIGHT) {
  test(`right answer passes: ${key}`, () => {
    const r = checkTypes(answer({ entry: key, ...over }), { entry: byKey(key) });
    assert.deepEqual(r, { check: 'pass', errors: [], fixes: [] });
  });
}

test('rest param accepts element-wise params too (Math.max(a, b))', () => {
  const r = checkTypes(answer({ params: [['a', 'num'], ['b', 'num']] }), { entry: byKey('Math.max') });
  assert.equal(r.check, 'pass');
});

test('missing receiver: one sentence and a set-field fix prepending it', () => {
  const r = checkTypes(answer({ params: [['f', 'fn']] }), { entry: byKey('Array.prototype.map') });
  assert.equal(r.check, 'fail');
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /receiver of Array\.prototype\.map is missing/);
  assert.deepEqual(r.fixes, [{ kind: 'set-field', field: 'params', value: [['list', 'list'], ['f', 'fn']] }]);
});

test('wrong type: names the param and the corrected type', () => {
  const r = checkTypes(answer({ params: [['n', 'text']] }), { entry: byKey('Math.abs') });
  assert.equal(r.check, 'fail');
  assert.match(r.errors[0], /`n` has type `text`.*use `num`/);
  assert.deepEqual(r.fixes, [{ kind: 'set-field', field: 'params', value: [['n', 'num']] }]);
});

test('extra required param: refused, fix drops it', () => {
  const r = checkTypes(answer({ params: [['n', 'num'], ['m', 'num']] }), { entry: byKey('Math.abs') });
  assert.equal(r.check, 'fail');
  assert.match(r.errors[0], /`m` is extra/);
  assert.deepEqual(r.fixes, [{ kind: 'set-field', field: 'params', value: [['n', 'num']] }]);
});

test('missing required (non-receiver) param is named', () => {
  const r = checkTypes(answer({ params: [['text', 'text']] }), { entry: byKey('String.prototype.padStart') });
  assert.equal(r.check, 'fail');
  assert.match(r.errors[0], /`targetLength` of String\.prototype\.padStart is missing/);
  assert.deepEqual(r.fixes[0].value, [['text', 'text'], ['targetLength', 'num']]);
});

test('bad kind: question on a non-boolean member fails, no fix', () => {
  const r = checkTypes(answer({ kind: 'question', params: [['xs', 'list'], ['f', 'fn']] }), {
    entry: byKey('Array.prototype.map'),
  });
  assert.equal(r.check, 'fail');
  assert.match(r.errors[0], /Kind `question`/);
  assert.deepEqual(r.fixes, []);
});

test('null params and not-expressible skip', () => {
  const entry = byKey('Math.abs');
  assert.deepEqual(checkTypes(answer({ params: null }), { entry }), { check: 'skip', errors: [], fixes: [] });
  assert.equal(checkTypes(answer({ decision: 'not-expressible', params: [] }), { entry }).check, 'skip');
});

test('unmapped TS types count but never fail', () => {
  const entry = { id: 'Intl.thing', kind: 'static', params: [{ name: 'o', type: 'Intl.CollatorOptions', optional: false, rest: false }] };
  const r = typeReport(answer({ params: [['o', 'text']] }), { entry });
  assert.equal(r.check, 'pass');
  assert.equal(r.unmapped, 1);
});

test('tsCategories closed table', () => {
  assert.deepEqual(tsCategories('number'), ['number']);
  assert.deepEqual(tsCategories('(value: T, index: number) => U'), ['fn']);
  assert.deepEqual(tsCategories('Iterable<T> | ArrayLike<T>'), ['list']);
  assert.deepEqual(tsCategories('string | RegExp'), ['string', 'regex']);
  assert.deepEqual(tsCategories('((reason: any) => T) | undefined | null'), ['fn']);
  assert.deepEqual(tsCategories('T'), ['any']);
  assert.deepEqual(tsCategories('Intl.CollatorOptions'), []);
});
