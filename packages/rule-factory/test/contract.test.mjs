// cs2 -- the rule factory's contract: the miss record, the static share, label items, rule proposals and the gate
// report, with the mocks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MISS_SOURCES, COLLECTED_SOURCES, NONE_FITS, PROPOSAL_KINDS, RULE_FILES,
  assertMissRecord, assertStaticShare, assertLabelItem, assertRuleProposal, assertGateReport, toStepMiss,
} from '../contract.mjs';
import { MOCK_MISSES, MOCK_LABEL_ITEMS, createMockMissCollector, createMockFactory } from '../mock.mjs';

test('contract: five miss sources, every one collected; every mock record is a valid miss record', () => {
  assert.deepEqual([...MISS_SOURCES], ['plan', 'validate', 'decision-trace', 'reason-ledger', 'drafter']);
  assert.deepEqual([...COLLECTED_SOURCES], [...MISS_SOURCES]);
  for (const r of createMockMissCollector().collect()) assertMissRecord(r);
});

test('contract: a record that is not a miss must be decided by static code; bad shapes are named', () => {
  const r = MOCK_MISSES[0];
  assert.throws(() => assertMissRecord({ ...r, decidedBy: 'person' }), /not a miss was decided by static/);
  assert.throws(() => assertMissRecord({ ...r, source: 'chat' }), /source is one of/);
  assert.throws(() => assertMissRecord({ ...r, sentence: 'lower case' }), /full sentence/);
  assert.throws(() => assertMissRecord({ ...r, label: 'maybe' }), /label/);
  assert.throws(() => assertMissRecord({ ...r, kind: 'missing' }), /kind is absent, picked or null/);
  assert.throws(() => assertMissRecord({ ...r, options: ['a', ''] }), /options/);
});

test('contract: a static share has total >= byStatic and a share between 0 and 1', () => {
  assertStaticShare({ step: 'line.baseOn', total: 2, byStatic: 1, share: 0.5, sentence: 'Static code decided 1 of 2.' });
  assert.throws(() => assertStaticShare({ step: 'x', total: 1, byStatic: 2, share: 2, sentence: '' }), /StaticShare/);
});

test('contract: a label item is a closed question with "none fits" last, labelled exactly when it says who labelled it', () => {
  for (const it of MOCK_LABEL_ITEMS) assertLabelItem(it);
  const it = MOCK_LABEL_ITEMS[0];
  assert.throws(() => assertLabelItem({ ...it, options: ['verb:add', 'grammar'] }), new RegExp(`"${NONE_FITS}" last`));
  assert.throws(() => assertLabelItem({ ...it, correct: 'verb:shout' }), /correct is null or one of the options/);
  assert.throws(() => assertLabelItem({ ...it, labelledBy: null }), /labelled exactly when/);
  assert.throws(() => assertLabelItem({ ...it, labelledBy: 'qwen' }), /labelledBy/);
  assert.throws(() => assertLabelItem({ ...it, question: 'Pick one.' }), /one question/);
});

test('contract: a label item gives the step-miss shape of branch im1-im2 ({step, kind, options, chosen, correct})', () => {
  const m = toStepMiss(MOCK_LABEL_ITEMS[1]);
  assert.deepEqual(Object.keys(m).sort(), ['chosen', 'correct', 'kind', 'options', 'step']);
  assert.equal(m.kind, 'picked');
  assert.ok(!m.options.includes(NONE_FITS), 'the step-miss options are the real options only');
  assert.equal(m.correct, 'LINE-LAYOUT/stray-to-feature:orders:components');
  assert.equal(toStepMiss({ ...MOCK_LABEL_ITEMS[0], correct: NONE_FITS }).correct, null, '"none fits" is an absent right answer');
});

test('contract: a proposal is data plus its own test case, for a known rule file; the gate passes only what rose with nothing broken', () => {
  assert.deepEqual(Object.keys(RULE_FILES).sort(), ['fix-ranking', 'lexicon']);
  for (const t of Object.values(PROPOSAL_KINDS)) assert.ok(t in RULE_FILES);
  const p = { id: 'rp-0123456789ab', kind: 'grammar', target: 'lexicon', change: { everyday: { grammar: ['size'] } }, evidence: ['drafter:tc-1:size'], test: { kind: 'train-cases', caseIds: ['tc-1'] }, sentence: 'Read "size" as an everyday word (from 1 miss).' };
  assertRuleProposal(p);
  assert.throws(() => assertRuleProposal({ ...p, target: 'fix-ranking' }), /target/);
  assert.throws(() => assertRuleProposal({ ...p, test: { kind: 'train-cases', caseIds: [] } }), /own test case/);
  assert.throws(() => assertRuleProposal({ ...p, evidence: [] }), /misses it came from/);
  const s = { train: { n: 1, recall: 1, precision: 1, preferred: 1 }, drafter: { n: 1, recall: 1, precision: 1, preferred: 1 } };
  const ok = { proposalId: p.id, pass: true, with: s, improved: ['train recall'], regressions: [], ownTest: { ok: true, sentence: 'Fixed.' }, sentence: 'Passes: train recall rose.' };
  assertGateReport({ at: 'now', baseline: s, results: [ok], together: null, passed: [p.id], sentence: '1 of 1 proposal passed the gate.' });
  assert.throws(() => assertGateReport({ at: 'now', baseline: s, results: [{ ...ok, regressions: ['train:x'] }], together: null, passed: [p.id], sentence: 'x.' }), /passes only when/);
  assert.throws(() => assertGateReport({ at: 'now', baseline: s, results: [{ ...ok, pass: false }], together: null, passed: [p.id], sentence: 'x.' }), /passed lists exactly/);
});

test('mock: the factory answers fixed sentences and writes nothing', async () => {
  const f = createMockFactory();
  assert.match((await f.propose()).labelling.sentence, /jev was not available/);
  assert.equal((await f.gate()).report, null);
  assert.equal(f.apply().ok, false);
});
