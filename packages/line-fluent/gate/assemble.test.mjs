import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runGate } from './assemble.mjs';

const answer = (over = {}) => ({
  entry: 'Array.prototype.flatMap',
  decision: 'new-atom',
  atom: 'flatMapped',
  existing: null,
  kind: 'copy',
  sentence: 'every(x).in(xs).is().mapped().to(f).and().flattened()',
  js: 'xs.flatMap(f)',
  params: [['xs', 'list'], ['f', 'fn']],
  parts: null,
  reason: null,
  ...over,
});

const ok = () => ({ check: 'pass', errors: [], fixes: [] });
const bad = (error, fixes = []) => () => ({ check: 'fail', errors: [error, 'second error'], fixes });
const all = { grammar: ok, equivalence: ok, types: ok };

test('all pass: exact C3 keys in order', () => {
  const r = runGate(answer(), all);
  assert.deepEqual(Object.keys(r), ['entry', 'pass', 'checks', 'refusal', 'fixes']);
  assert.deepEqual(Object.keys(r.checks), ['schema', 'grammar', 'equivalence', 'types']);
  assert.deepEqual(r, {
    entry: 'Array.prototype.flatMap',
    pass: true,
    checks: { schema: 'pass', grammar: 'pass', equivalence: 'pass', types: 'pass' },
    refusal: null,
    fixes: [],
  });
});

test('defaults: injected checks skip, gate passes', () => {
  const r = runGate(answer());
  assert.equal(r.pass, true);
  assert.deepEqual(r.checks, { schema: 'pass', grammar: 'skip', equivalence: 'skip', types: 'skip' });
});

for (const name of ['grammar', 'equivalence', 'types']) {
  test(`single fail: ${name}`, () => {
    const fix = { kind: 'replace-word', from: 'flattened', to: 'flattens' };
    const r = runGate(answer(), { ...all, [name]: bad(`${name} broke.`, [fix]) });
    assert.equal(r.pass, false);
    assert.equal(r.checks[name], 'fail');
    for (const other of ['schema', 'grammar', 'equivalence', 'types'].filter((n) => n !== name)) {
      assert.equal(r.checks[other], 'pass');
    }
    assert.equal(r.refusal, `${name} broke.`);
    assert.deepEqual(r.fixes, [fix]);
  });
}

test('single fail: schema short circuits; injected fns not called', () => {
  let calls = 0;
  const spy = () => { calls += 1; return ok(); };
  const r = runGate(answer({ extra: 1 }), { grammar: spy, equivalence: spy, types: spy });
  assert.equal(calls, 0);
  assert.equal(r.pass, false);
  assert.deepEqual(r.checks, { schema: 'fail', grammar: 'skip', equivalence: 'skip', types: 'skip' });
  assert.match(r.refusal, /`extra`/);
  assert.deepEqual(r.fixes, []);
});

test('refusal comes from the first failed check in order; fixes in order, deduplicated', () => {
  const a = { kind: 'replace-word', from: 'flattened', to: 'flattens' };
  const b = { kind: 'remove-word', word: 'and' };
  const c = { kind: 'set-field', field: 'kind', value: 'copy' };
  const r = runGate(answer(), {
    grammar: bad('grammar first.', [a, b, { ...a }]),
    equivalence: ok,
    types: bad('types second.', [{ kind: 'remove-word', word: 'and' }, c]),
  });
  assert.equal(r.refusal, 'grammar first.');
  assert.deepEqual(r.checks, { schema: 'pass', grammar: 'fail', equivalence: 'pass', types: 'fail' });
  assert.deepEqual(r.fixes, [a, b, c]);
});

test('fixes of passing or skipped checks are ignored', () => {
  const r = runGate(answer(), { grammar: () => ({ check: 'pass', errors: [], fixes: [{ kind: 'remove-word', word: 'x' }] }) });
  assert.deepEqual(r.fixes, []);
});

for (const value of [null, undefined, 'text', 42, ['a']]) {
  test(`non-object answer ${JSON.stringify(value)}: schema fails, entry null`, () => {
    const r = runGate(value, all);
    assert.equal(r.entry, null);
    assert.equal(r.pass, false);
    assert.deepEqual(r.checks, { schema: 'fail', grammar: 'skip', equivalence: 'skip', types: 'skip' });
    assert.match(r.refusal, /one JSON object/);
  });
}
