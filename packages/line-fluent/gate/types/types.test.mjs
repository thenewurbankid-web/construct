import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkTypes, typeReport, tsCategories, makeTypesCheck, SMITH_TYPES } from './types.mjs';
import { runGate } from '../assemble.mjs';

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

test('bad kind: question on a non-boolean method fails, no fix (value or copy is ambiguous)', () => {
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

test('unknown type word: refused with the slot\'s canonical word as a set-field fix', () => {
  const r = checkTypes(answer({ params: [['n', 'number']] }), { entry: byKey('Math.abs') });
  assert.equal(r.check, 'fail');
  assert.match(r.errors[0], /`number`, which is not a catalog type word; use `num`/);
  assert.deepEqual(r.fixes, [{ kind: 'set-field', field: 'params', value: [['n', 'num']] }]);
});

test('catalog type words come from catalog.json and typeGens', () => {
  for (const w of ['num', 'text', 'weakmap', 'promise', 'rawtemplate', 'undef', 'nullish']) assert.ok(SMITH_TYPES.includes(w), w);
  assert.ok(!SMITH_TYPES.some((w) => w.startsWith('const:')));
});

test('const: literal choice is accepted for a string param', () => {
  const r = checkTypes(answer({ params: [['text', 'text'], ['form', 'const:["NFC","NFD"]']] }), {
    entry: byKey('String.prototype.normalize'),
  });
  assert.equal(r.check, 'pass');
});

test('optional param may be undef', () => {
  const r = checkTypes(answer({ params: [['text', 'shorttext'], ['length', 'nat'], ['fill', 'undef']] }), {
    entry: byKey('String.prototype.padStart'),
  });
  assert.equal(r.check, 'pass');
});

test('explicit `this` param is the receiver slot (Function.prototype.apply)', () => {
  const entry = byKey('Function.prototype.apply');
  assert.equal(checkTypes(answer({ params: [['fn', 'fn'], ['thisArg', 'prim']] }), { entry }).check, 'pass');
  const r = checkTypes(answer({ params: [['thisArg', 'prim']] }), { entry });
  assert.equal(r.check, 'fail');
});

test('entry kind: property read cannot be in-place; fix sets kind to value', () => {
  const r = checkTypes(answer({ kind: 'in-place', params: [['list', 'list']] }), { entry: byKey('Array.prototype.length') });
  assert.equal(r.check, 'fail');
  assert.match(r.errors[0], /Kind `in-place` does not fit Array\.prototype\.length, a property entry; use `value`/);
  assert.deepEqual(r.fixes, [{ kind: 'set-field', field: 'kind', value: 'value' }]);
});

test('entry kind: boolean-ish property allows question', () => {
  const r = checkTypes(answer({ kind: 'question', params: [['pattern', 'regex']] }), { entry: byKey('RegExp.prototype.global') });
  assert.equal(r.check, 'pass');
});

test('entry kind: question on a non-boolean property fails with a value fix', () => {
  const r = checkTypes(answer({ kind: 'question', params: [['list', 'list']] }), { entry: byKey('Array.prototype.length') });
  assert.equal(r.check, 'fail');
  assert.deepEqual(r.fixes, [{ kind: 'set-field', field: 'kind', value: 'value' }]);
});

test('entry kind: constructor cannot be effect', () => {
  const r = checkTypes(answer({ kind: 'effect', params: [['value', 'num']] }), { entry: byKey('new Date') });
  assert.equal(r.check, 'fail');
  assert.match(r.errors[0], /use `value` or `copy`/);
  assert.deepEqual(r.fixes, [{ kind: 'set-field', field: 'kind', value: 'value' }]);
});

const check = makeTypesCheck(ref.entries);

test('makeTypesCheck: overloads by id pass when any overload fits (new Date)', () => {
  assert.equal(check(answer({ entry: 'new Date', params: [['year', 'num'], ['monthIndex', 'num']] })).check, 'pass');
  assert.equal(check(answer({ entry: 'new Date', params: [] })).check, 'pass');
  const r = check(answer({ entry: 'new Date', params: [['a', 'fn']] }));
  assert.equal(r.check, 'fail');
});

test('makeTypesCheck: unknown entry skips', () => {
  assert.equal(check(answer({ entry: 'No.such.entry', params: [] })).check, 'skip');
});

// Acceptance: every catalog atom with a native mapping, written as a C2 answer, passes against C1.
test('catalog atoms with a native mapping pass the types gate', () => {
  const cat = JSON.parse(readFileSync(new URL('../../../line-smith/src/atoms/catalog.json', import.meta.url), 'utf8'));
  const atoms = Array.isArray(cat.atoms) ? cat.atoms : Object.values(cat.atoms);
  const ids = new Set(ref.entries.map((e) => e.id));
  const PROTO = ['instance', 'copy', 'inplace', 'copyReceiver'];
  const STATIC = ['static', 'staticCopy'];
  const fails = [];
  let checked = 0;
  for (const a of atoms) {
    const c = a.check;
    if (!c || Array.isArray(c) || !c.native) continue;
    const { kind, owner, member } = c.native;
    const id = PROTO.includes(kind) ? `${owner}.prototype.${member}` : kind === 'construct' ? `new ${owner}` : STATIC.includes(kind) ? `${owner}.${member}` : null;
    if (!id || !ids.has(id)) continue;
    const params = [...(c.receiver ? [['self', c.receiver]] : []), ...(c.params ?? []).map((p) => [p.name, p.gen])];
    const r = check(answer({ entry: id, kind: 'value', params }));
    checked++;
    if (r.check === 'fail') fails.push(`${a.atom} (${id}): ${r.errors[0]}`);
  }
  assert.ok(checked >= 150, `checked ${checked}`);
  assert.deepEqual(fails, []);
});

test('runGate with the types check injected: pass, and a fail carries refusal and fixes', () => {
  const ok = runGate(answer({ entry: 'Math.abs', sentence: 's', params: [['n', 'num']] }), { types: check });
  assert.equal(ok.checks.types, 'pass');
  assert.equal(ok.pass, true);
  const bad = runGate(answer({ entry: 'Math.abs', params: [['n', 'text']] }), { types: check });
  assert.equal(bad.pass, false);
  assert.equal(bad.checks.types, 'fail');
  assert.match(bad.refusal, /`n` has type `text`/);
  assert.deepEqual(bad.fixes, [{ kind: 'set-field', field: 'params', value: [['n', 'num']] }]);
});
