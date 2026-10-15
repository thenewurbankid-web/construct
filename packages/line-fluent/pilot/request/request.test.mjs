import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildRequest, MAX_CANDIDATES, RULES, SYSTEM } from './request.mjs';
import { FIELDS, DECISIONS, KINDS } from '../../contract/validate.mjs';

// Total size (system + user + prefill) of any request, in characters.
const MAX_CHARS = 4000;
const size = (r) => r.system.length + r.user.length + r.prefill.length;

const flatMap = {
  id: 'Array.prototype.flatMap',
  section: 'Array',
  layer: 'es',
  kind: 'method',
  params: [
    { name: 'callback', type: '(value: T, index: number, array: T[]) => U | ReadonlyArray<U>', optional: false, rest: false },
    { name: 'thisArg', type: 'This', optional: true, rest: false },
  ],
  lib: 'lib.es2019.array.d.ts',
  key: 'Array.prototype.flatMap',
};

const candidates = [
  { atom: 'mapEach', fluent: 'every(x).in(xs).is().mapped().to().clone().by(f)', js: 'xs.map(f)' },
  { atom: 'flattened', fluent: 'clones().list(xs).and().flattens()', js: 'xs.flat()' },
];

test('system lists the task, C2 fields in order, closed enums, R1-R10 and reuse-first', () => {
  assert.equal(RULES.length, 10);
  RULES.forEach((line, i) => {
    assert.ok(line.startsWith(`R${i + 1}. `));
    assert.ok(!line.includes('\n'));
  });
  assert.ok(SYSTEM.startsWith('Task: write one fluent answer for one JavaScript reference entry, in Smith Atomic English.'));
  assert.ok(SYSTEM.includes(`Fields, in this order: ${FIELDS.join(', ')}. No other fields.`));
  assert.ok(SYSTEM.includes(`decision: one of ${DECISIONS.join(' | ')}.`));
  assert.ok(SYSTEM.includes(`kind: one of ${KINDS.join(' | ')}; null only`));
  assert.ok(/Reuse an existing atom first/.test(SYSTEM));
  assert.ok(SYSTEM.endsWith(RULES[9]));
  assert.ok(!SYSTEM.includes('VERB'), 'shapes are opt-in');
});

test('first try: exact user text and prefill', () => {
  const r = buildRequest(flatMap, { candidates });
  assert.deepEqual(Object.keys(r), ['system', 'user', 'prefill']);
  assert.equal(r.system, SYSTEM);
  assert.equal(
    r.user,
    [
      'Entry: Array.prototype.flatMap',
      'Section: Array',
      'Kind: method',
      'Params: callback: (value: T, index: number, array: T[]) => U | ReadonlyArray<U>, thisArg?: This',
      'Candidate catalog atoms:',
      '- mapEach: every(x).in(xs).is().mapped().to().clone().by(f) (js: xs.map(f))',
      '- flattened: clones().list(xs).and().flattens() (js: xs.flat())',
    ].join('\n'),
  );
  assert.equal(r.prefill, '{"entry": "Array.prototype.flatMap", "decision": "');
  assert.ok(!r.user.includes('refused'));
  assert.deepEqual(buildRequest(flatMap, { candidates }), r, 'deterministic');
});

test('retry: refusal sentence appended, rest unchanged', () => {
  const refusal = 'Field `kind` is "list"; use one of question, copy, in-place, value, effect.';
  const first = buildRequest(flatMap, { candidates });
  const r = buildRequest(flatMap, { candidates, refusal });
  assert.equal(r.system, first.system);
  assert.equal(r.prefill, first.prefill);
  assert.equal(r.user, `${first.user}\nYour last answer was refused: ${refusal} Answer again.`);
});

test('no candidates, no params, rest param, and JSON-escaped prefill', () => {
  const r = buildRequest({ id: 'say "hi"\\', section: 'X', kind: 'function', params: [] });
  assert.ok(r.user.includes('Params: (none)'));
  assert.ok(r.user.includes('Candidate catalog atoms: (none)'));
  assert.equal(r.prefill, '{"entry": "say \\"hi\\"\\\\", "decision": "');
  assert.deepEqual(JSON.parse(`${r.prefill}existing"}`), { entry: 'say "hi"\\', decision: 'existing' });
  const rest = buildRequest({ id: 'Math.max', section: 'Math', kind: 'function', params: [{ name: 'values', type: 'number[]', optional: false, rest: true }] });
  assert.ok(rest.user.includes('Params: ...values: number[]'));
});

test(`candidates are capped at ${MAX_CANDIDATES}`, () => {
  const many = Array.from({ length: 9 }, (_, i) => ({ atom: `atom${i}`, fluent: `list(xs).does${i}()`, js: `f${i}(xs)` }));
  const r = buildRequest(flatMap, { candidates: many });
  assert.equal(r.user.split('\n').filter((l) => l.startsWith('- ')).length, MAX_CANDIDATES);
  assert.ok(r.user.includes('- atom4:'));
  assert.ok(!r.user.includes('- atom5:'));
});

test(`every reference entry with 5 long candidates and a refusal stays under ${MAX_CHARS} chars`, () => {
  const refUrl = new URL('../../../line-codemod/bench/atoms/js-reference/reference.json', import.meta.url);
  const { entries } = JSON.parse(readFileSync(refUrl, 'utf8'));
  assert.ok(entries.length > 0);
  const long = Array.from({ length: 5 }, (_, i) => ({
    atom: `clonesAndReplacesFirstWith${i}`,
    fluent: 'clones().text(s).and().replaces().first(pattern).with(replacement).and().trims()',
    js: 's.replace(pattern, replacement).trim()',
  }));
  const refusal = 'The word `flattened` is not in the grammar\'s verb list; add it to naming.json grammar.verbs or use `flattens()`.';
  let max = 0;
  for (const e of entries) max = Math.max(max, size(buildRequest(e, { candidates: long, refusal })));
  assert.ok(max < MAX_CHARS, `largest request is ${max} chars`);
});

test('shapes: true adds every shape the gate accepts, each with a real example', () => {
  const r = buildRequest({ id: 'Array.prototype.at', section: 'Array', kind: 'method', params: [] }, { shapes: true });
  assert.ok(r.system.startsWith(SYSTEM));
  assert.ok(r.system.includes('- clones().list(·).and().VERB()   e.g. '));
});
