import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tidyAnswer } from './tidy.mjs';
import { validateAnswer } from './validate.mjs';

const good = {
  entry: 'Object.is', decision: 'existing', atom: null, existing: 'equals', kind: 'question',
  sentence: 'checks().if(a).is().equal().to(b).andThe().answer()', js: 'a === b', params: [['a', 'mixed'], ['b', 'mixed']], parts: null, reason: null,
};

test('a valid answer passes through unchanged', () => {
  const { answer, tidied } = tidyAnswer(good);
  assert.deepEqual(answer, good);
  assert.deepEqual(tidied, []);
});

test('out-of-order, missing and extra fields are put right, and the result validates', () => {
  const { atom, parts, reason, ...rest } = good;
  const shuffled = Object.fromEntries(Object.entries(rest).reverse());
  const { answer, tidied } = tidyAnswer({ ...shuffled, note: 'x' });
  assert.deepEqual(answer, good);
  assert.ok(tidied.includes('reordered') && tidied.includes('added atom') && tidied.includes('dropped note'));
  assert.equal(validateAnswer(answer).pass, true, validateAnswer(answer).errors?.[0]);
});

test('a capitalised enum is lowercased; an unknown one is left for the gate to refuse', () => {
  assert.equal(tidyAnswer({ ...good, kind: 'Value' }).answer.kind, 'value');
  assert.equal(tidyAnswer({ ...good, kind: 'method' }).answer.kind, 'method');
});

test('existing is filled only when there is exactly one candidate', () => {
  const blank = { ...good, existing: null };
  assert.equal(tidyAnswer(blank, { candidates: [{ atom: 'equals' }] }).answer.existing, 'equals');
  assert.equal(tidyAnswer(blank, { candidates: [{ atom: 'equals' }, { atom: 'same' }] }).answer.existing, null);
  assert.equal(tidyAnswer(blank).answer.existing, null);
});

test('fields that follow from the decision are set to match it', () => {
  const ne = tidyAnswer({ ...good, decision: 'not-expressible', reason: 'No atom can say this.' }).answer;
  assert.deepEqual([ne.existing, ne.kind, ne.sentence, ne.js, ne.parts], [null, null, null, null, null]);
  assert.equal(validateAnswer(ne).pass, true, validateAnswer(ne).errors?.[0]);
  assert.equal(tidyAnswer({ ...good, reason: 'stray' }).answer.reason, null);
  assert.equal(tidyAnswer({ ...good, decision: 'new-atom', atom: 'isSame' }).answer.existing, null);
});

test('an existing atom with no sentence or js gets its catalog ones', () => {
  const candidates = [{ atom: 'equals', fluent: good.sentence, js: [good.js] }];
  const { answer } = tidyAnswer({ ...good, sentence: '', js: null }, { candidates });
  assert.equal(answer.sentence, good.sentence);
  assert.equal(answer.js, good.js);
});
