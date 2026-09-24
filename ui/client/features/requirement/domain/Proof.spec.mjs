import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRequirement } from '../../../../../packages/core/requirement-card.mjs';
import { placeCard, planFromBlocks } from '../../../../../packages/core/placement.mjs';
import { proofSummary } from '../../../../../packages/core/proof.mjs';
import { buildProofView, chainLine, proofStateOf, proofTargetOf, skipReasonOf, PROOF_REASON } from './ProofCard.ts';
import { buildRequirementView } from './RequirementView.ts';
import { initialScreen, screenReducer } from '../workflows/RequirementMachine.ts';

// #653: the Proof card's state machine and view model. The plan is the REAL one from the core blocks (the same a read returns), and the
// options are the REAL proofSummary of core, so the card is proven against what the server sends.
const PRODUCTS = 'A user wants to see a list of products';
const planned = (shape) => {
  const card = parseRequirement(PRODUCTS).card;
  const placement = placeCard(card, { framework: 'react-spa', answers: shape ? { 'q-shape': shape } : {} });
  const p = planFromBlocks(placement.blocks, { feature: 'products', root: '/x', decisions: placement.decisions });
  return { card, placement, plan: p.plan, files: p.files, open: placement.open, offers: placement.offers, warnings: [], summary: { readBack: [], blocks: [] }, proof: p.proof };
};
const LIST = planned('list');
const ready = (extra = {}) => ({ ...initialScreen, text: PRODUCTS, read: { status: 'ready', result: LIST, error: null }, ...extra });
const step = (state, ...actions) => actions.reduce((s, a) => screenReducer(s, a), state);
const OPTIONS = proofSummary(null).options;
const run = (over = {}) => ({
  state: 'green', complete: true, durationMs: 420, counts: { total: 10, passed: 10, failed: 0 }, failures: [], error: null,
  summary: proofSummary({ chain: { state: 'green' }, counts: { total: 10, passed: 10, failed: 0 }, tests: [] }), ...over,
});
const APP_FAILURE = { test: 'Products screen: the empty state', kind: 'app', title: 'The app behaved differently', summary: 'The page given no rows: the empty state is wrong, the screen shows blank.', message: 'x', expected: 'empty', reached: 'blank' };
const failedRun = (failure = APP_FAILURE) => run({ state: 'failed', complete: false, counts: { total: 10, passed: 9, failed: 1 }, failures: [failure], summary: proofSummary({ chain: { state: 'failed' }, counts: { failed: 1 }, tests: [{ title: failure.test, status: 'failed', failure }] }) });
const view = (state) => buildProofView(state, state.read.result);

test('a plan with a shaped screen has a proof target; the plain scaffold, a note and no plan have none', () => {
  assert.deepEqual(proofTargetOf(LIST), { feature: 'products', screen: 'Products' });
  assert.equal(proofTargetOf(planned(null)), null, 'no shape chosen: the plain scaffold proves nothing');
  assert.equal(proofTargetOf(null), null);
  assert.equal(buildRequirementView(ready()).result.proof.feature, 'products');
  assert.equal(buildRequirementView({ ...ready(), read: { status: 'ready', result: planned(null), error: null } }).result.proof, null);
});

test('the order of the chain is plain: run is off until the plan is applied, with the reason; then it is on', () => {
  const unknown = view(ready());
  assert.equal(unknown.canRun, false);
  assert.match(unknown.runDisabledReason, /^Checking whether/);
  const notApplied = view(step(ready(), { type: 'PROOF_APPLIED', applied: false, options: OPTIONS }));
  assert.equal(notApplied.canRun, false);
  assert.match(notApplied.runDisabledReason, /^Approve the plan first/);
  assert.equal(notApplied.state, 'pending');
  assert.equal(notApplied.chain.line, 'incomplete (the proof has not run yet)');
  assert.equal(notApplied.chain.complete, false);
  const approved = view(step(ready(), { type: 'PROOF_APPLIED', applied: false, options: OPTIONS }, { type: 'APPROVE_STARTED', processId: 'p1' }));
  assert.match(approved.runDisabledReason, /approve each of its files in the process/, 'approved but not applied: the reason changes, the step stays off');
  const applied = view(step(ready(), { type: 'PROOF_APPLIED', applied: true, options: OPTIONS }));
  assert.deepEqual([applied.canRun, applied.runDisabledReason, applied.runLabel], [true, null, 'Run the proof']);
  assert.deepEqual(applied.options.map((o) => [o.id, o.disabledReason]), [['skip-proof', null]], 'run is the primary button; the rest of the closed options follow');
});

test('while it runs: the run is off, the chain says so, and nothing is complete', () => {
  const v = view(step(ready(), { type: 'PROOF_APPLIED', applied: true, options: OPTIONS }, { type: 'PROOF_RUN_STARTED' }));
  assert.deepEqual([v.running, v.canRun, v.runLabel, v.chain], [true, false, 'Running...', { complete: false, line: 'incomplete (the proof is running)' }]);
});

test('green: the chain reads "complete (proof green: N passed)", never a plain complete; nothing more is offered but a rerun', () => {
  const v = view(step(ready(), { type: 'PROOF_APPLIED', applied: true, options: OPTIONS }, { type: 'PROOF_RUN_STARTED' }, { type: 'PROOF_RUN_DONE', run: run() }));
  assert.deepEqual([v.state, v.stateLabel, v.chain.complete, v.chain.line], ['green', 'Green', true, 'complete (proof green: 10 passed)']);
  assert.equal(v.counts, '10 passed, 0 failed (0.4 s, no browser)');
  assert.deepEqual(v.options, [], 'a green proof offers no other option');
  assert.equal(v.runLabel, 'Run the proof again');
  assert.equal(v.failures.length, 0);
});

test('failed (app): the failing state is named, in the Tests screen words; edit, fill with AI and regenerate are shown but off, with a reason', () => {
  const v = view(step(ready(), { type: 'PROOF_APPLIED', applied: true, options: OPTIONS }, { type: 'PROOF_RUN_DONE', run: failedRun() }));
  assert.deepEqual([v.state, v.chain.complete, v.chain.line.startsWith('incomplete')], ['failed', false, true]);
  const [f] = v.failures;
  assert.deepEqual([f.kind, f.heading, f.failingState, f.expected, f.reached], ['app', 'The app behaved differently', 'empty', 'empty', 'blank']);
  assert.equal(f.summary, 'The page given no rows: the empty state is wrong, the screen shows blank.');
  assert.deepEqual(v.options.map((o) => o.id), ['edit-code', 'fill-with-ai', 'skip-proof']);
  const off = v.options.filter((o) => !o.live);
  assert.equal(off.length, 2);
  for (const o of off) assert.match(o.disabledReason, /^Not wired here yet: /);
  assert.equal(v.options.find((o) => o.id === 'skip-proof').disabledReason, null);
  assert.equal(v.canRun, true, 'run stays on, to run again after the fix');
});

test('failed (convention): a harness problem, not a product bug; regenerate is the first option and is off with a reason', () => {
  const conv = { test: 'Products proof', kind: 'convention', title: 'Harness problem, not a product bug', summary: 'The proof expected ../../pages/ProductsPage.page, and it is not there.', message: 'The proof expected ../../pages/ProductsPage.page, and it is not there.', selector: '../../pages/ProductsPage.page', fix: 'Put the file back.' };
  const v = view(step(ready(), { type: 'PROOF_APPLIED', applied: true, options: OPTIONS }, { type: 'PROOF_RUN_DONE', run: failedRun(conv) }));
  const [f] = v.failures;
  assert.deepEqual([f.kind, f.heading, f.failingState, f.fix], ['convention', 'Harness problem, not a product bug', null, 'Put the file back.']);
  assert.deepEqual(v.options.map((o) => o.id), ['regenerate-screen', 'edit-code', 'skip-proof']);
});

test('a run that could not start shows its reason and stays failed', () => {
  const err = run({ state: 'failed', complete: false, counts: { total: 0, passed: 0, failed: 0 }, error: { code: 'RUNNER_MISSING', message: 'The proof is bundled with esbuild.' }, summary: proofSummary({ chain: { state: 'failed' }, tests: [] }) });
  const v = view(step(ready(), { type: 'PROOF_APPLIED', applied: true, options: OPTIONS }, { type: 'PROOF_RUN_DONE', run: err }));
  assert.deepEqual([v.state, v.runError], ['failed', 'The proof is bundled with esbuild.']);
  const refused = view(step(ready(), { type: 'PROOF_APPLIED', applied: true, options: OPTIONS }, { type: 'PROOF_RUN_STARTED' }, { type: 'PROOF_RUN_FAILED', error: 'Approve the plan first.', applied: false }));
  assert.deepEqual([refused.runError, refused.canRun, refused.running], ['Approve the plan first.', false, false], 'a refusal turns "applied" off again');
});

test('skipped: the chain reads "complete (proof skipped: <reason>)", and running again supersedes the skip', () => {
  const opened = step(ready(), { type: 'PROOF_APPLIED', applied: true, options: OPTIONS }, { type: 'PROOF_SKIP_OPEN' }, { type: 'PROOF_SKIP_DRAFT', draft: 'the empty state is redesigned' });
  assert.deepEqual([view(opened).skip.open, view(opened).skip.draft, view(opened).chain.complete], [true, 'the empty state is redesigned', false]);
  const skipped = step(opened, { type: 'PROOF_SKIP_SAVING' }, { type: 'PROOF_SKIP_DONE', reason: 'the empty state is redesigned' });
  const v = view(skipped);
  assert.deepEqual([v.state, v.stateLabel, v.chain.complete, v.chain.line, v.skippedReason], ['skipped', 'Skipped', true, 'complete (proof skipped: the empty state is redesigned)', 'the empty state is redesigned']);
  assert.equal(v.skip.open, false);
  assert.equal(proofStateOf(skipped), 'skipped');
  const again = view(step(skipped, { type: 'PROOF_RUN_DONE', run: failedRun() }));
  assert.deepEqual([again.state, again.chain.complete, again.skippedReason], ['failed', false, null]);
  const refused = step(opened, { type: 'PROOF_SKIP_SAVING' }, { type: 'PROOF_SKIP_FAILED', error: 'Give a reason.' });
  assert.deepEqual([view(refused).skip.open, view(refused).skip.error, view(refused).chain.complete], [true, 'Give a reason.', false], 'a refused skip keeps the form open with the reason of the refusal');
  assert.equal(view(step(opened, { type: 'PROOF_SKIP_CANCEL' })).skip.open, false);
});

test('the chain line is never a plain "complete"', () => {
  for (const [state, reason] of [['green', null], ['skipped', 'because'], ['failed', null], ['pending', null]]) {
    for (const running of [false, true]) {
      const { line, complete } = chainLine(state, reason, 3, running);
      assert.match(line, /^(complete|incomplete) \(.+\)$/, `${state}/${running}`);
      assert.equal(complete, !running && (state === 'green' || state === 'skipped'));
    }
  }
});

test('a new sentence, answer or read starts the proof over (the plan it was about is gone)', () => {
  const done = step(ready(), { type: 'PROOF_APPLIED', applied: true, options: OPTIONS }, { type: 'PROOF_RUN_DONE', run: run() });
  assert.equal(view(done).state, 'green');
  assert.equal(view(step(done, { type: 'READ_LOADED', result: LIST })).state, 'pending');
  assert.equal(step(done, { type: 'READ_LOADED', result: LIST }).proof.applied, null, 'asked again for the new plan');
  assert.equal(step(done, { type: 'ANSWERS', answers: [] }).proof.run.result, null);
  assert.equal(step(done, { type: 'TEXT', text: 'other words' }).proof.run.result, null);
});

test('the skip reason: trimmed, one line, 8 to 200 characters; the empty one is refused', () => {
  assert.deepEqual(skipReasonOf('  redesigned in #700  '), { ok: true, reason: 'redesigned in #700' });
  for (const bad of ['', '   ', 'short', 'x'.repeat(PROOF_REASON.max + 1), 'two\nlines of it here']) assert.equal(skipReasonOf(bad).ok, false, JSON.stringify(bad));
  assert.match(skipReasonOf('').error, /Give a reason/);
  assert.equal(skipReasonOf('x'.repeat(PROOF_REASON.min)).ok, true);
  assert.equal(skipReasonOf('x'.repeat(PROOF_REASON.max)).ok, true);
});
