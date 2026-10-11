// cs1 -- the summarizer's contract: the sentence rules, the Summary shape and the mock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SENTENCE_RULES, SUMMARY_KINDS, SMITH_CONNECTORS, assertSummary } from '../contract.mjs';
import { checkSentence, rawIds, slotTokens, slotWords } from '../check.mjs';
import { createMockSummarizer } from '../mock.mjs';

const rulesOf = (s) => checkSentence(s).problems.map((p) => p.rule);

test('contract: three sentence rules with stable ids, each said in plain English', () => {
  assert.deepEqual(SENTENCE_RULES.map((r) => r.id), ['SENT-FULL', 'SENT-ID', 'SENT-SLOT']);
  for (const r of SENTENCE_RULES) assert.match(r.sentence, /^[A-Z].*\.$/);
  assert.deepEqual([...SUMMARY_KINDS], ['plan-step', 'finding', 'feature', 'status', 'message', 'code']);
  assert.deepEqual([...SMITH_CONNECTORS], ['and', 'but', 'also', 'if', 'then', 'is', 'will']);
});

test('checkSentence: a full plain sentence passes, paths and item names are fine', () => {
  for (const s of [
    'Waiting for your approval: Creates StatusBadge in feature orders, based on the library Badge.',
    'Feature "billing" imports "../../orders/components/OrderButton" from feature "orders"; a feature may use only the library.',
    'Tried again as step 4.',
    'Is this the page you meant?',
    'Do it step-by-step.',
  ]) assert.deepEqual(rulesOf(s), [], s);
});

test('checkSentence: not a full sentence (lower case start, one word, no full stop)', () => {
  assert.deepEqual(rulesOf('waiting for approval.'), ['SENT-FULL']);
  assert.deepEqual(rulesOf('Done.'), ['SENT-FULL']);
  assert.deepEqual(rulesOf('Waiting for approval'), ['SENT-FULL']);
});

test('checkSentence: raw ids are refused and named (step, session, rule ids, tool names, hashes, finding keys)', () => {
  assert.deepEqual(rulesOf('Step step-3 needs you.'), ['SENT-ID']);
  assert.deepEqual(rulesOf('The session ses-cockpit is open.'), ['SENT-ID']);
  assert.deepEqual(rulesOf('This breaks LINE-DIR in the feature.'), ['SENT-ID']);
  assert.deepEqual(rulesOf('Ran line.baseOn on the library.'), ['SENT-ID']);
  assert.deepEqual(rulesOf('The source is at 61eee8f.'), ['SENT-ID']);
  assert.deepEqual(rawIds('Fix LINE-DIR|features/a.tsx|4 now.'), ['LINE-DIR', 'LINE-DIR|features/a.tsx|4']);
  assert.match(checkSentence('Step step-3 needs you.').problems[0].sentence, /step-3.*under Details/);
});

test('checkSentence: slot names must be words; slotWords says them', () => {
  assert.deepEqual(rulesOf('Pick a libraryId first.'), ['SENT-SLOT']);
  assert.deepEqual(rulesOf('Set the feature_name first.'), ['SENT-SLOT']);
  assert.deepEqual(slotTokens('Set libraryId on src/useThing.ts now.'), ['libraryId']);
  assert.equal(slotWords('libraryId'), 'library item');
  assert.equal(slotWords('pageTitleText'), 'page title text');
  assert.match(checkSentence('Pick a libraryId first.').problems[0].sentence, /"library item"/);
});

test('assertSummary: sentences must pass the rules, details are labelled, via is static', () => {
  const ok = { sentences: ['Line has a message for you.'], details: [{ label: 'Tool call', text: 'line.baseOn({})' }], via: 'static' };
  assert.equal(assertSummary(ok, checkSentence), ok);
  assert.throws(() => assertSummary({ ...ok, sentences: [] }, checkSentence), /at least one sentence/);
  assert.throws(() => assertSummary({ ...ok, sentences: ['Ran line.baseOn now.'] }, checkSentence), /SENT-ID/);
  assert.throws(() => assertSummary({ ...ok, details: [{ label: 'x' }] }, checkSentence), /label and a text/);
  assert.throws(() => assertSummary({ ...ok, via: 'model' }, checkSentence), /static/);
});

test('mock: answers per kind and records each input', () => {
  const m = createMockSummarizer({ finding: { sentences: ['A finding is here.'], details: [], via: 'static' } });
  assert.deepEqual(m.summarize({ kind: 'finding', finding: { sentence: 'x', rule: 'R', file: 'a', line: 1 } }).sentences, ['A finding is here.']);
  assertSummary(m.summarize({ kind: 'status', text: 'x' }), m.checkSentence);
  assert.equal(m.calls.length, 2);
});
