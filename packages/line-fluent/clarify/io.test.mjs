import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readCode, guessIO, ioQuestions } from './io.mjs';

const FILTER = 'items.filter((x) => x.price > limit).map((x) => x.name)';

test('readCode finds the free names, the callbacks as fixed parts, and evidence for each input', () => {
  const r = readCode(FILTER);
  assert.deepEqual(r.inputs, ['items', 'limit'], 'x is the callback\'s own name, not an input');
  assert.deepEqual(r.fixed, ['(x) => x.price > limit', '(x) => x.name']);
  assert.deepEqual(r.hints.items, ['records', 'list']);
  assert.deepEqual(r.hints.limit, ['number']);
  assert.deepEqual(readCode('Math.max(a, b)').inputs, ['a', 'b'], 'globals are not inputs');
});

test('guessIO picks the first kind the code runs on and shows what comes out', async () => {
  const g = await guessIO(FILTER);
  assert.deepEqual(g.inputs.map(({ name, kind }) => ({ name, kind })), [{ name: 'items', kind: 'list of records' }, { name: 'limit', kind: 'number' }]);
  assert.equal(g.output, '["bag"]');
  assert.deepEqual(g.changes, []);
});

test('guessIO sees an input changed in place', async () => {
  const g = await guessIO('xs.push(item)');
  assert.deepEqual(g.changes, ['xs']);
  assert.equal(g.output, '4');
});

test('ioQuestions asks what goes in and what it is for, in plain words', async () => {
  const q = ioQuestions(await guessIO('xs.push(item)'));
  assert.equal(q.inputs, 'It takes xs (a list of numbers) and item (a single item). Is that right? (yes, or say what each one is)');
  assert.equal(q.output, 'With xs = [10,2,1] and item = "apple", it gives 4 and changes xs in place and leaves item as it was. In your words, what is it for?');
  assert.match(ioQuestions({ inputs: [], fixed: [], output: null, changes: [], given: 'With nothing given' }).output, /it gives an error\. What is it meant to do\?/);
});
