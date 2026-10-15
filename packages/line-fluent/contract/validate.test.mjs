import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateAnswer, FIELDS, DECISIONS, KINDS, ATOM_ID } from './validate.mjs';

const schema = JSON.parse(readFileSync(new URL('./answer.schema.json', import.meta.url), 'utf8'));

const answer = (over) => ({
  entry: 'Array.prototype.flatMap', decision: 'new-atom', atom: 'flatMapped', existing: null, kind: 'copy',
  sentence: 'every(x).in(xs).is().mapped().to(f).and().flattened()', js: 'xs.flatMap(f)',
  params: [['xs', 'list'], ['f', 'fn']], parts: null, reason: null, ...over,
});

test('schema and validator agree on fields, order, enums and the atom pattern', () => {
  assert.deepEqual(schema.required, FIELDS);
  assert.deepEqual(Object.keys(schema.properties), FIELDS);
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.properties.decision.enum, DECISIONS);
  assert.deepEqual(schema.properties.kind.enum, [...KINDS, null]);
  assert.equal(schema.properties.atom.pattern, ATOM_ID.source);
});

const valid = {
  'new-atom from the plan': answer({}),
  'existing: equals': answer({
    entry: 'Object.is', decision: 'existing', atom: null, existing: 'equals', kind: 'question',
    sentence: 'checks().if(a).is().equal().to(b).andThe().answer()', js: 'a === b', params: [['a', 'mixed'], ['b', 'mixed']],
  }),
  'existing: mapEach, atom repeated, parts []': answer({
    entry: 'Array.prototype.map', decision: 'existing', atom: 'mapEach', existing: 'mapEach', kind: 'copy',
    sentence: 'clones().list(xs).and().maps().each().with(fn)', js: 'list.map(fn)',
    params: [['list', 'list'], ['fn', 'fn']], parts: [],
  }),
  'existing: reversed': answer({
    entry: 'Array.prototype.toReversed', decision: 'existing', atom: null, existing: 'reversed', kind: 'copy',
    sentence: 'clones().list(xs).and().reverses()', js: 'list.toReversed()', params: [['list', 'list']],
  }),
  'molecule: mapEach + flattened': answer({
    decision: 'molecule', atom: 'flatMapped', parts: ['mapEach', 'flattened'],
  }),
  'molecule: trimmed + sortedBy': answer({
    entry: 'example.trimAndSort', decision: 'molecule', atom: 'trimmedSorted', kind: 'copy',
    sentence: 'clones().list(xs).and().sorts().by(order).andThe().sorted()', js: 'list.map((s) => s.trim()).toSorted(order)',
    params: [['list', 'list'], ['order', 'cmp']], parts: ['trimmed', 'sortedBy'],
  }),
  'not-expressible with kind null': answer({
    entry: 'debugger', decision: 'not-expressible', atom: null, kind: null, sentence: null, js: null, params: [],
    reason: 'A debugger statement pauses the tool, not the data, so no sentence can describe it.',
  }),
  'not-expressible keeps a kind': answer({
    entry: 'with', decision: 'not-expressible', atom: null, kind: 'effect', sentence: null, js: null, params: [],
    reason: 'The with statement changes name lookup and is refused in strict code.',
  }),
};

for (const [name, a] of Object.entries(valid)) {
  test(`valid: ${name}`, () => {
    assert.deepEqual(validateAnswer(a), { pass: true, check: 'pass', errors: [] });
  });
}

const { kind: _k, ...withoutKind } = answer({});
const { entry: e, ...rest } = answer({});
const invalid = {
  'unknown field': [{ ...answer({}), confidence: 0.9 }, /`confidence` is not part/],
  'bad decision enum': [answer({ decision: 'new' }), /`decision` is "new"/],
  'bad kind enum': [answer({ kind: 'pure' }), /`kind` is "pure"/],
  'missing field': [withoutKind, /`kind` is missing/],
  'fields out of order': [{ ...rest, entry: e }, /out of order/],
  'missing reason on not-expressible': [
    answer({ decision: 'not-expressible', atom: null, kind: null, sentence: null, js: null, reason: null }),
    /`reason` is empty/],
  'sentence on not-expressible': [
    answer({ decision: 'not-expressible', atom: null, js: null, reason: 'Not data.' }),
    /`sentence` must be null/],
  'js on not-expressible': [
    answer({ decision: 'not-expressible', atom: null, sentence: null, reason: 'Not data.' }),
    /`js` must be null/],
  'empty parts on molecule': [answer({ decision: 'molecule', parts: [] }), /`parts` is empty/],
  'parts on new-atom': [answer({ parts: ['mapEach'] }), /`parts` must be null or \[\]/],
  'existing missing on existing': [answer({ decision: 'existing' }), /`existing` is empty/],
  'existing set on new-atom': [answer({ existing: 'equals' }), /`existing` must be null/],
  'reason on new-atom': [answer({ reason: 'Because.' }), /`reason` must be null/],
  'null sentence on new-atom': [answer({ sentence: null }), /`sentence` is empty/],
  'null kind on new-atom': [answer({ kind: null }), /`kind` is null/],
  'atom not camelCase': [answer({ atom: 'Flat-Mapped' }), /`atom` is "Flat-Mapped"/],
  'atom missing on new-atom': [answer({ atom: null }), /`atom` is empty/],
  'params not pairs': [answer({ params: [['xs']] }), /`params` item 0/],
  'not an object': [['entry'], /one JSON object/],
};

for (const [name, [a, expected]] of Object.entries(invalid)) {
  test(`invalid: ${name}`, () => {
    const r = validateAnswer(a);
    assert.equal(r.pass, false);
    assert.equal(r.check, 'fail');
    assert.ok(r.errors.some((m) => expected.test(m)), `expected ${expected} in ${JSON.stringify(r.errors)}`);
    for (const m of r.errors) assert.match(m, /^[A-Z].*[.]$/, `one sentence: ${m}`);
  });
}

test('every catalog atom used above exists in the Smith catalog', () => {
  const catalog = JSON.parse(readFileSync(new URL('../../line-smith/src/atoms/catalog.json', import.meta.url), 'utf8'));
  const ids = new Set(catalog.atoms.map((a) => a.atom));
  const used = Object.values(valid).flatMap((a) => [a.existing, ...(a.parts ?? [])]).filter(Boolean);
  for (const id of used) assert.ok(ids.has(id), `${id} is a catalog atom`);
  const eq = catalog.atoms.find((a) => a.atom === 'equals');
  assert.equal(eq.fluent, valid['existing: equals'].sentence);
});
