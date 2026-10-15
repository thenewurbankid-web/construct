// t1-2b: the equivalence gate passes correct answers for real C1 entries and fails wrong
// ones with one sentence naming the differing input and both outputs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkEquivalence } from './equivalence.mjs';

const answer = (entry, js, params, decision = 'new-atom') => ({
  entry, decision, atom: decision === 'not-expressible' ? null : 'someAtom', existing: null, kind: 'value',
  sentence: decision === 'not-expressible' ? null : 'x()', js, params, parts: decision === 'molecule' ? ['a', 'b'] : null,
  reason: decision === 'not-expressible' ? 'It cannot be said.' : null,
});

const right = [
  ['Array.prototype.flatMap', 'xs.flatMap(f)', [['xs', 'list'], ['f', 'fnnested']]],
  ['Array.prototype.includes', 'xs.includes(x)', [['xs', 'list'], ['x', 'prim']]],
  ['Array.prototype.reverse', 'xs.reverse()', [['xs', 'list']]],
  ['String.prototype.padStart', 's.padStart(n, p)', [['s', 'text'], ['n', 'nat'], ['p', 'text']]],
  ['Math.max', 'Math.max(a, b)', [['a', 'num'], ['b', 'num']]],
];

const wrong = [
  ['Array.prototype.flatMap', 'xs.map(f)', [['xs', 'list'], ['f', 'fnnested']]],
  ['Array.prototype.includes', 'xs.indexOf(x) > 0', [['xs', 'list'], ['x', 'prim']]],
  ['Array.prototype.reverse', '[...xs].reverse()', [['xs', 'list']]],
  ['String.prototype.padStart', 's.padEnd(n, p)', [['s', 'text'], ['n', 'nat'], ['p', 'text']]],
  ['Math.max', 'Math.min(a, b)', [['a', 'num'], ['b', 'num']]],
];

for (const [entry, js, params] of right) {
  test(`${entry}: \`${js}\` passes`, async () => {
    const r = await checkEquivalence(answer(entry, js, params), { entry, seed: 7 });
    assert.deepEqual(r, { check: 'pass', errors: [], fixes: [] });
  });
}

for (const [entry, js, params] of wrong) {
  test(`${entry}: \`${js}\` fails naming the input`, async () => {
    const r = await checkEquivalence(answer(entry, js, params), { entry, seed: 7 });
    assert.equal(r.check, 'fail');
    assert.equal(r.errors.length, 1);
    assert.deepEqual(r.fixes, []);
    const [msg] = r.errors;
    assert.match(msg, /^On (the reference case|input) /);
    for (const [name] of params) assert.ok(msg.includes(`${name} = `), `names ${name}: ${msg}`);
    assert.match(msg, /the answer .* but the reference /);
  });
}

test('the reverse copy fails on the reference case by what it leaves in xs', async () => {
  const r = await checkEquivalence(answer('Array.prototype.reverse', '[...xs].reverse()', [['xs', 'list']]), { entry: 'Array.prototype.reverse' });
  assert.equal(r.errors[0], 'On the reference case xs = [3,1,2], the answer leaves `xs` as [3,1,2] but the reference leaves it as [2,1,3].');
});

test('deterministic for a fixed seed', async () => {
  const a = answer('Array.prototype.includes', 'xs.indexOf(x) > 0', [['xs', 'list'], ['x', 'prim']]);
  const one = await checkEquivalence(a, { entry: 'Array.prototype.includes', seed: 3 });
  const two = await checkEquivalence(a, { entry: 'Array.prototype.includes', seed: 3 });
  assert.deepEqual(one, two);
});

test('entry may be a C1 object; an own data property is checked on generated inputs', async () => {
  const r = await checkEquivalence(answer('Array.prototype.length', 'xs.length', [['xs', 'list']]), {
    entry: { id: 'Array.prototype.length', kind: 'property', key: 'Array.prototype.length' },
  });
  assert.equal(r.check, 'pass');
  const bad = await checkEquivalence(answer('Array.prototype.length', 'xs.length - 1', [['xs', 'list']]), { entry: 'Array.prototype.length' });
  assert.equal(bad.check, 'fail');
});

test('skip for molecule and not-expressible, with no errors', async () => {
  for (const decision of ['molecule', 'not-expressible']) {
    const r = await checkEquivalence(answer('Array.prototype.flatMap', null, [], decision), { entry: 'Array.prototype.flatMap' });
    assert.deepEqual(r, { check: 'skip', errors: [], fixes: [] });
  }
});

test('unparsable js and unknown parameter types fail with one sentence', async () => {
  const parse = await checkEquivalence(answer('Math.max', 'Math.max(a,', [['a', 'num']]), { entry: 'Math.max' });
  assert.equal(parse.check, 'fail');
  assert.match(parse.errors[0], /does not parse/);
  const type = await checkEquivalence(answer('Math.max', 'Math.max(a)', [['a', 'T']]), { entry: 'Math.max' });
  assert.match(type.errors[0], /`a` has type `T`/);
});
