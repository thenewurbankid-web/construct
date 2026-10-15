import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSentence, dedupeOptions, buildSuggestPrompt, relevantCatalog, runOption, givenText, suggestSentences } from './sentences.mjs';
import { nextQuestion, applyAnswer } from './narrow.mjs';
import { propose, choose } from './clarify.mjs';

test('a catalog sentence is built into its atom, in the person\'s own names, with a readable example', async () => {
  const r = await checkSentence('list(names).joins().with(comma)');
  assert.equal(r.ok, true);
  assert.equal(r.atom, 'joinWith');
  assert.equal(r.js, 'names.join(comma)');
  assert.equal(r.plain, 'list names joins with comma');
  assert.equal(r.example, 'with names = [3,1,2], comma = "-", it gives "3-1-2"');
});

test('a literal argument stays part of the sentence and is not an input', async () => {
  const r = await checkSentence('checks().if(age).is().at().least(18)');
  assert.deepEqual(r.inputs, [{ name: 'age', gen: 'num' }]);
  assert.equal(r.js, 'age >= 18');
});

test('a new verb cannot be built yet; a broken sentence says why, in plain words', async () => {
  const r = await checkSentence('clones().list(rows).and().copies()');
  assert.equal(r.ok, false);
  assert.match(r.reason, /new verb “copies”, which no atom does yet/);
  assert.match((await checkSentence('list(xs).quickly()')).reason, /does not read as Atomic English/);
});

test('options that differ only in what an input is called are one option', async () => {
  const a = await checkSentence('clones().list(prices).and().sorts().by(order)');
  const b = await checkSentence('clones().list(prices).and().sorts().by(cheapestFirst)');
  const c = await checkSentence('clones().list(prices).and().reverses()');
  assert.deepEqual(dedupeOptions([a, b, c]).map((o) => o.atom), ['sortedBy', 'reversed']);
});

test('narrowing asks about the case where options disagree, never for a menu of sentences', async () => {
  const sorted = { answer: 'clones().list(prices).and().sorts().by(order)', ...(await checkSentence('clones().list(prices).and().sorts().by(order)')) };
  const reversed = { answer: 'clones().list(prices).and().reverses()', ...(await checkSentence('clones().list(prices).and().reverses()')) };
  const all = [sorted, reversed];
  const how = { run: (o, k) => runOption(o, k, all), given: (os, k) => givenText(all, k) };
  const state = { question: 'put the prices in order', options: all, all, facts: [], ruledOut: [] };
  const q = await nextQuestion(state, how);
  assert.equal(q.kind, 'behaviour');
  assert.match(q.text, /^With prices = \[3,1,2\] and order = \(a, b\) => a - b, what should come out\?\n {2}A\. \[1,2,3\]\n {2}B\. \[2,1,3\]\n {2}C\. something else \(tell me what\)$/);

  const picked = applyAnswer(state, q, 'A');
  assert.deepEqual(picked.state.options.map((o) => o.atom), ['sortedBy']);
  assert.deepEqual(picked.state.ruledOut, ['clones().list(prices).and().reverses()']);
  assert.deepEqual(picked.state.facts, [{ case: q.case, given: 'With prices = [3,1,2] and order = (a, b) => a - b', output: '[1,2,3]' }]);
  const confirm = await nextQuestion(picked.state, how);
  assert.equal(confirm.kind, 'confirm');
  assert.deepEqual(applyAnswer(picked.state, confirm, 'yes').done.status, 'chosen');

  const own = applyAnswer(state, q, 'C. [3,2,1]');
  assert.deepEqual(own.done, { status: 'create', facts: [{ case: q.case, given: q.given, output: '[3,2,1]' }] }, 'the person\'s own answer is the example to build from');
});

test('synonyms (same behaviour everywhere) are asked as wording, which fixes the exact sentence', async () => {
  const o = (answer, js) => ({ answer, plain: answer, js, inputs: [{ name: 'xs', gen: 'list' }] });
  const all = [o('first(xs)', 'xs[0]'), o('front(xs)', 'xs.at(0)')];
  const how = { run: (x, k) => runOption(x, k, all), given: (os, k) => givenText(all, k) };
  const state = { options: all, all, facts: [], ruledOut: [] };
  const q = await nextQuestion(state, how);
  assert.equal(q.kind, 'wording');
  const r = applyAnswer(state, q, '2');
  assert.deepEqual(r.state.options.map((x) => x.answer), ['front(xs)']);
});

test('the suggestion prompt is built per request: relevant catalog, confirmed facts, what was ruled out', () => {
  assert.equal(relevantCatalog('join the names with a comma')[0].atom, 'joinWith');
  const { system, user } = buildSuggestPrompt('join the names with a comma', {
    facts: [{ given: 'With names = ["a","b"]', output: '"a,b"' }], ruledOut: ['list(names).takes().first()'], n: 10,
  });
  assert.match(system, /Catalog sentences that may fit/);
  assert.ok(system.split('\n').filter((l) => l.startsWith('- ') && l.includes('   (')).length <= 30, 'only the relevant catalog');
  assert.match(user, /^Request: join the names with a comma\nThe person confirmed:\n- With names = \["a","b"\], it should give "a,b"\nThese do something else; do not suggest them again:\n- list\(names\)\.takes\(\)\.first\(\)\nGive 10 different sentences, best first\.$/);
});

test('the model is asked through the claude CLI with the per-request prompt', async () => {
  const calls = [];
  const run = async (args, input) => (calls.push({ args, input }), { stdout: JSON.stringify({ result: '{"sentences": ["list(xs).takes().first()"]}' }) });
  assert.deepEqual(await suggestSentences({ model: 'haiku', run })('the first item', 3, {}), ['list(xs).takes().first()']);
  assert.match(calls[0].input, /^Request: the first item\nGive 3 different sentences/);
});

test('the generic loop: propose shows only what holds up; choose reads a number or "none"', async () => {
  const p = await propose('anything', {
    suggest: async () => ['good', 'bad', 'good'],
    check: async (a) => (a === 'good' ? { ok: true, plain: 'Good one', example: 'x gives y' } : { ok: false, plain: a, reason: 'no' }),
  });
  assert.deepEqual(p.options.map((o) => o.answer), ['good']);
  assert.equal(choose(p, '1').status, 'chosen');
  assert.equal(choose(p, '7').status, 'unclear');
  assert.deepEqual(choose(p, 'none: [1,2] gives 3'), { status: 'create', example: '[1,2] gives 3' });
});
