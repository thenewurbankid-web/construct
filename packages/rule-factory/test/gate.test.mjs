// cs2 -- the accuracy gate: a proposal ships only when a held-out score rises, no case that passed now fails, no
// held-out score falls, the drafter's floors hold and its own test passes. The scorer is injected here (no drafting);
// the last test runs the real worker on a few cases with an overlay, to prove the overlay reaches the static layer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { assertGateReport } from '../contract.mjs';
import { gateProposals, heldOutScores, regressionsOf, workerScorer } from '../gate.mjs';
import { CHECKOUT } from '../apply.mjs';
import { rerankFixes } from '@line/construct-engine/line/fix-ranking';

const c = (id, preferred, o = {}) => ({ id, recall: preferred, precision: 1, preferred, ...o });
const BASE = {
  drafter: [c('d1', 1, { heldOut: true }), c('d2', 0, { heldOut: true }), c('d3', 1)],
  train: [c('t1', 1), c('t2', 0)],
  own: [{ id: 'tc-1', preferred: 0 }, { id: 'tc-2', preferred: 0 }],
};
const lex = (id, words, caseIds = ['tc-1']) => ({ id, kind: 'grammar', target: 'lexicon', change: { everyday: { grammar: words } }, evidence: ['x'], test: { kind: 'train-cases', caseIds }, sentence: 'Read it (from 1 miss).' });
const P = {
  good: lex('rp-000000000001', ['good']),
  flat: lex('rp-000000000002', ['flat']),
  breaks: lex('rp-000000000003', ['breaks']),
  ownFails: lex('rp-000000000004', ['ownfails'], ['tc-2']),
  good2: lex('rp-000000000005', ['good2'], ['tc-2']),
};
/** A scorer whose result depends on which words the overlay adds. */
const scorer = (calls = []) => async (overlay, own) => {
  calls.push({ words: overlay?.lexicon?.everyday?.grammar ?? null, own });
  const w = new Set(overlay?.lexicon?.everyday?.grammar ?? []);
  const s = structuredClone(BASE);
  if (w.has('good')) { s.train[1] = c('t2', 1); s.own[0].preferred = 1; }
  if (w.has('good2')) { s.drafter[1] = c('d2', 1, { heldOut: true }); s.own[1].preferred = 1; }
  if (w.has('flat')) s.own[0].preferred = 1;
  if (w.has('breaks')) { s.train[1] = c('t2', 1); s.drafter[2] = c('d3', 0); s.own[0].preferred = 1; }
  if (w.has('ownfails')) s.train[1] = c('t2', 1);
  if (w.has('good') && w.has('good2')) s.train[0] = c('t1', 0);
  return s;
};

test('gate: scores are the held-out ones (Train held-out, the drafter\'s held-out cases); a regression is a case that passed and now fails', () => {
  const h = heldOutScores(BASE);
  assert.deepEqual(h.drafter, { n: 2, recall: 0.5, precision: 1, preferred: 0.5 });
  assert.equal(h.train.n, 2);
  assert.deepEqual(regressionsOf(BASE, { ...BASE, drafter: [c('d1', 0, { heldOut: true }), BASE.drafter[1], BASE.drafter[2]] }), ['drafter:d1']);
  assert.deepEqual(regressionsOf(BASE, { ...BASE, drafter: [c('d1', 1, { heldOut: true, labels: 0 }), ...BASE.drafter.slice(1)] }), [], 'a field the baseline did not measure is no regression');
});

test('gate: only a proposal that raises a held-out score, breaks nothing and passes its own test ships; the report says why for each', async () => {
  const calls = [];
  const report = await gateProposals([P.good, P.flat, P.breaks, P.ownFails], { score: scorer(calls), at: 't' });
  assertGateReport(report);
  assert.deepEqual(report.passed, [P.good.id]);
  const why = Object.fromEntries(report.results.map((r) => [r.proposalId, r.sentence]));
  assert.equal(why[P.good.id], 'Passes: train recall, train preferred rose.');
  assert.equal(why[P.flat.id], 'Held back: no held-out score rose.');
  assert.match(why[P.breaks.id], /^Held back: train recall, train preferred rose; 1 case that passed now fails/);
  assert.equal(why[P.ownFails.id], 'Held back: train recall, train preferred rose; its own test fails.');
  assert.deepEqual(report.results.find((r) => r.proposalId === P.breaks.id).regressions, ['drafter:d3']);
  assert.equal(report.together, null, 'one proposal passed: nothing to measure together');
  assert.equal(report.sentence, '1 of 4 proposals passed the gate.');
  assert.deepEqual(calls[0], { words: null, own: ['tc-1', 'tc-2'] }, 'the baseline is the shipped rules, with every own case');
});

test('gate: proposals that pass alone are measured together; when together they break a case the report says to apply one at a time', async () => {
  const report = await gateProposals([P.good, P.good2], { score: scorer(), at: 't' });
  assert.deepEqual(report.passed, [P.good.id, P.good2.id]);
  assert.equal(report.together?.ok, false);
  assert.deepEqual(report.together?.regressions, ['train:t1']);
  assert.equal(report.sentence, '2 of 2 proposals passed the gate, but together they break something: apply them one at a time.');
});

test('gate: a fix-rank proposal is scored on its fix choices, its held-out ones raising the held-out score', async () => {
  const items = [
    { id: 'a', options: ['LINE-LAYOUT/stray-to-library:c', 'LINE-LAYOUT/stray-to-feature:o:c'], chosen: 'LINE-LAYOUT/stray-to-library:c', correct: 'LINE-LAYOUT/stray-to-feature:o:c', heldOut: false },
    { id: 'b', options: ['LINE-LAYOUT/stray-to-library:c', 'LINE-LAYOUT/stray-to-feature:p:c'], chosen: 'LINE-LAYOUT/stray-to-library:c', correct: 'LINE-LAYOUT/stray-to-feature:p:c', heldOut: true },
  ];
  const p = { id: 'rp-0000000000ff', kind: 'fix-rank', target: 'fix-ranking', change: { rule: 'LINE-LAYOUT', prefer: 'LINE-LAYOUT/stray-to-feature', over: 'LINE-LAYOUT/stray-to-library' }, evidence: ['a', 'b'], test: { kind: 'fix-items', items }, sentence: 'For LINE-LAYOUT, rank it first (from 2 misses).' };
  const report = await gateProposals([p], { score: scorer(), rerank: rerankFixes, at: 't' });
  assert.deepEqual(report.results[0].improved, ['fix choices']);
  assert.equal(report.results[0].ownTest.ok, true);
  assert.deepEqual(report.passed, [p.id]);
  const noRerank = await gateProposals([p], { score: scorer(), at: 't' });
  assert.deepEqual(noRerank.passed, [], 'without the fix ranking to test against, nothing passes');
});

test('worker: the real scorer loads the overlay into the static layer (a grammar word is no longer a question for the drafter)', { timeout: 300_000 }, async () => {
  const score = workerScorer({ checkout: CHECKOUT, onlyTrain: 1, onlyDrafter: 1 });
  // A Train train-split case whose request says "per page": the drafter cannot read the "size" it means (cs2 finding).
  const own = ['tc-f7fabf8c2aff'];
  const base = await score(null, own);
  assert.equal(base.drafter.length, 1);
  assert.equal(base.train.length, 1);
  assert.deepEqual(base.own.map((x) => x.words), [['size']]);
  const next = await score({ lexicon: { everyday: { grammar: ['size'] } } }, own);
  assert.deepEqual(next.own.map((x) => x.words), [[]], 'with the overlay the drafter reads "size" as grammar');
});
