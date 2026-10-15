import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compare, summarize } from './compare.mjs';

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

const pass = { entry: 'Array.prototype.flatMap', pass: true, checks: { schema: 'pass', grammar: 'pass', equivalence: 'pass', types: 'pass' }, refusal: null, fixes: [] };
const fail = {
  entry: 'Array.prototype.flatMap',
  pass: false,
  checks: { schema: 'pass', grammar: 'fail', equivalence: 'skip', types: 'skip' },
  refusal: 'The word `flattened` is not in the grammar.',
  fixes: [{ kind: 'replace-word', from: 'flattened', to: 'flattens' }],
};
const yes = { behavesSame: () => true };
const no = { behavesSame: () => false };

const molecule = (parts) => answer({ decision: 'molecule', atom: null, parts, sentence: 'mapEach(f).then().flattened()' });
const notExpressible = (reason) => answer({ decision: 'not-expressible', atom: null, sentence: null, js: null, reason });

test('identical answer with a passing gate is same and carries C4 fields', () => {
  const r = compare(answer(), answer(), pass);
  assert.equal(r.verdict, 'same');
  assert.equal(r.entry, 'Array.prototype.flatMap');
  assert.deepEqual(Object.keys(r), ['entry', 'verdict', 'reason', 'gold', 'student', 'studentGate']);
  assert.equal(r.studentGate, pass);
});

test('matching gold but failed gate is wrong, naming the failed check', () => {
  const r = compare(answer(), answer(), fail);
  assert.equal(r.verdict, 'wrong');
  assert.match(r.reason, /matches gold, but the student's grammar check failed\.$/);
});

test('missing gate counts as failed', () => {
  assert.equal(compare(answer(), answer(), undefined).verdict, 'wrong');
});

test('whitespace-only sentence differences are same', () => {
  const s = answer({ sentence: '  every(x) .in( xs )\n  .is().mapped()\t.to(f).and().flattened() ' });
  assert.equal(compare(answer(), s, pass).verdict, 'same');
});

test('different sentence is wrong without behavesSame, equivalent with it', () => {
  const s = answer({ sentence: 'each(x).in(xs).mapped().to(f).flattened()' });
  const bare = compare(answer(), s, pass);
  assert.equal(bare.verdict, 'wrong');
  assert.match(bare.reason, /sentence .* differs from gold's .*no equivalence check was given\.$/);
  assert.equal(compare(answer(), s, pass, yes).verdict, 'equivalent');
  assert.match(compare(answer(), s, pass, no).reason, /does not behave the same\.$/);
});

test('equivalent needs a passing gate even when behavesSame says true', () => {
  const s = answer({ atom: 'mappedFlat' });
  const r = compare(answer(), s, fail, yes);
  assert.equal(r.verdict, 'wrong');
  assert.match(r.reason, /atom `mappedFlat` differs from gold's `flatMapped`, and the student's grammar check failed/);
});

test('different decision is reported first', () => {
  const r = compare(answer(), answer({ decision: 'existing', atom: null, existing: 'flatMapped' }), pass);
  assert.equal(r.verdict, 'wrong');
  assert.match(r.reason, /^The student decided `existing` where gold decided `new-atom`/);
});

test('existing decisions compare the existing id', () => {
  const g = answer({ decision: 'existing', atom: null, existing: 'mapEach' });
  assert.equal(compare(g, { ...g }, pass).verdict, 'same');
  const r = compare(g, { ...g, existing: 'forEach' }, pass);
  assert.equal(r.verdict, 'wrong');
  assert.match(r.reason, /existing atom `forEach` differs from gold's `mapEach`/);
});

test('molecule parts in the same order are same; reordered parts are not', () => {
  const g = molecule(['mapEach', 'flattened']);
  assert.equal(compare(g, molecule(['mapEach', 'flattened']), pass).verdict, 'same');
  const r = compare(g, molecule(['flattened', 'mapEach']), pass);
  assert.equal(r.verdict, 'wrong');
  assert.match(r.reason, /molecule parts \[flattened, mapEach\] differ from gold's \[mapEach, flattened\]/);
  assert.equal(compare(g, molecule(['flattened', 'mapEach']), pass, yes).verdict, 'equivalent');
});

test('not-expressible on both sides is same whatever the reason wording', () => {
  const r = compare(notExpressible('It needs a generator.'), notExpressible('Generators are out of scope.'), pass);
  assert.equal(r.verdict, 'same');
});

test('not-expressible against an atom is wrong', () => {
  const r = compare(answer(), notExpressible('No.'), pass, yes);
  assert.equal(r.verdict, 'wrong');
  assert.match(r.reason, /no behaviour to compare\.$/);
  assert.equal(compare(notExpressible('No.'), answer(), pass, yes).verdict, 'wrong');
});

test('summarize counts verdicts and the right rate', () => {
  const results = [
    compare(answer(), answer(), pass),
    compare(answer(), answer({ atom: 'x' }), pass, yes),
    compare(answer(), answer(), fail),
    compare(answer(), answer({ atom: 'x' }), pass),
  ];
  assert.deepEqual(summarize(results), { same: 1, equivalent: 1, wrong: 2, total: 4, rightRate: 0.5 });
  assert.deepEqual(summarize([]), { same: 0, equivalent: 0, wrong: 0, total: 0, rightRate: 0 });
});
