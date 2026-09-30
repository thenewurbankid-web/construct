// #812 (epic #616, decided on #524) -- harness.mjs compiles a harness.v1 step graph over existing Choosers into one
// ordinary plan by calling compileChain per visit and stitching the results, so a repeated chooser (a loop-back)
// never collides with chooser.mjs's own duplicate-id rule for a single chain.
import test from 'node:test';
import assert from 'node:assert/strict';
import { defineChooser } from '../packages/core/chooser.mjs';
import { validateHarness, compileHarness, harnessSummary, HARNESS_ERROR_CODES } from '../packages/core/harness.mjs';
import { buildDebugChain, DEBUG_HARNESS_DOC, DEBUG_VERIFY_FAILED } from '../packages/core/debug-chain.mjs';

const root = process.cwd();

function twoStepDoc(extra = {}) {
  return { version: 1, id: 'pair', steps: [{ chooser: 'a', next: 'b' }, { chooser: 'b' }], ...extra };
}

const a = defineChooser({
  id: 'a',
  question: 'A or B?',
  options: [
    { id: 'a1', label: 'Check types', flow: 'check.types', args: {} },
    { id: 'a2', label: 'Check build', flow: 'check.build', args: {} },
  ],
});
const b = defineChooser({
  id: 'b',
  question: 'Then what?',
  options: [
    { id: 'b1', label: 'Run doctor', flow: 'research.doctor', args: {} },
    { id: 'b2', label: 'Sync', flow: 'sync', args: {}, touches: { features: [], files: [] } },
  ],
});

test('validateHarness accepts a well-formed document', () => {
  assert.equal(validateHarness(twoStepDoc()).valid, true);
  assert.equal(validateHarness(DEBUG_HARNESS_DOC).valid, true);
});

test('validateHarness rejects too few steps, a bad version and a duplicate chooser id', () => {
  assert.equal(validateHarness({ version: 1, id: 'x', steps: [] }).errors[0].code, 'HARNESS_STEPS_COUNT');
  assert.equal(validateHarness({ version: 2, id: 'x', steps: [{ chooser: 'a' }] }).errors[0].code, 'HARNESS_VERSION_INVALID');
  const dup = { version: 1, id: 'x', steps: [{ chooser: 'a' }, { chooser: 'a' }] };
  assert.ok(validateHarness(dup).errors.some((e) => e.code === 'HARNESS_STEP_CHOOSER_DUPLICATE'));
});

test('validateHarness rejects an unknown next/onResult target', () => {
  const doc = { version: 1, id: 'x', steps: [{ chooser: 'a', next: 'ghost' }] };
  assert.deepEqual(validateHarness(doc).errors.map((e) => e.code), ['HARNESS_STEP_NEXT_UNKNOWN']);
});

test('validateHarness requires maxRepeats on a back-edge and bounds it', () => {
  const noCap = { version: 1, id: 'x', steps: [{ chooser: 'a', onResult: [{ when: 'fail', next: 'a' }] }] };
  assert.deepEqual(validateHarness(noCap).errors.map((e) => e.code), ['HARNESS_ONRESULT_MAXREPEATS_REQUIRED']);
  const tooBig = { version: 1, id: 'x', steps: [{ chooser: 'a', onResult: [{ when: 'fail', next: 'a', maxRepeats: 999 }] }] };
  assert.deepEqual(validateHarness(tooBig).errors.map((e) => e.code), ['HARNESS_ONRESULT_MAXREPEATS_INVALID']);
});

test('harnessSummary is chooserSummary plus fixed-size graph position', () => {
  const summary = harnessSummary(twoStepDoc(), a, { visits: 2 });
  assert.equal(summary.id, 'a');
  assert.equal(summary.stepIndex, 0);
  assert.equal(summary.stepCount, 2);
  assert.equal(summary.visit, 2);
});

test('compileHarness walks a straight two-step document into one dependent plan', () => {
  const result = compileHarness(twoStepDoc(), [a, b], [
    { chooser: 'a', option: 'a1' },
    { chooser: 'b', option: 'b1' },
  ], { root });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(result.plan.steps.map((s) => s.flow), ['check.types', 'research.doctor']);
  assert.deepEqual(result.plan.steps[1].dependsOn, [result.plan.steps[0].id]);
  assert.deepEqual(result.decisions.map((d) => d.chooser), ['a', 'b']);
});

test('compileHarness branches on the observed facts (onResult over the default next)', () => {
  const doc = {
    version: 1,
    id: 'branch',
    steps: [{ chooser: 'a', next: 'b', onResult: [{ when: 'skip-b', next: 'b' }] }, { chooser: 'b' }],
  };
  // Same document, two different walks: a plain forward edge, and one where a fact is present but points at the
  // same target here (branching to a genuinely different node is exercised by the debug harness's loop-back below).
  const straight = compileHarness(doc, [a, b], [{ chooser: 'a', option: 'a1', resultFacts: [] }, { chooser: 'b', option: 'b1' }], { root });
  assert.equal(straight.ok, true, JSON.stringify(straight.errors));

  const rerouted = compileHarness(doc, [a, b], [{ chooser: 'a', option: 'a1', resultFacts: ['skip-b'] }, { chooser: 'b', option: 'b2' }], { root });
  assert.equal(rerouted.ok, true, JSON.stringify(rerouted.errors));
});

test('compileHarness rejects a trace step that follows no declared edge', () => {
  const result = compileHarness(twoStepDoc(), [a, b], [
    { chooser: 'a', option: 'a1', resultFacts: [] },
    { chooser: 'a', option: 'a2' },
  ], { root });
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors.map((e) => e.code), ['HARNESS_TRACE_EDGE_UNKNOWN']);
});

test('compileHarness enforces a repeat-until-pass cap: the debug chain loops verify -> isolate at most 3 times', () => {
  const chain = buildDebugChain('cart');
  const choosers = [chain.reproduce, chain.isolate, chain.fix, chain.verify];
  // Each cycle after the first re-enters `debug.isolate` from a failed `debug.verify`, which is the back-edge
  // DEBUG_HARNESS_DOC caps at 3; the first pass reaches `debug.isolate` by the plain forward edge from
  // `debug.reproduce`, so it does not count against the cap.
  const cycle = (failed) => [
    { chooser: 'debug.isolate', option: 'narrow' },
    { chooser: 'debug.fix', option: 'add-unit' },
    { chooser: 'debug.verify', option: 'rerun-repro', resultFacts: failed ? [DEBUG_VERIFY_FAILED] : [] },
  ];
  // N cycles cross the verify->isolate back-edge N-1 times (the first cycle is reached by the plain forward edge);
  // 4 cycles cross it exactly 3 times, landing on the cap.
  const trace = [{ chooser: 'debug.reproduce', option: 'playwright-test' }, ...cycle(true)];
  for (let i = 0; i < 3; i += 1) trace.push(...cycle(true));
  const atCap = compileHarness(DEBUG_HARNESS_DOC, choosers, trace, { root });
  assert.equal(atCap.ok, true, JSON.stringify(atCap.errors));
  assert.equal(atCap.plan.steps.length, trace.length);

  // A 4th crossing exceeds it.
  const overCap = compileHarness(DEBUG_HARNESS_DOC, choosers, [...trace, ...cycle(false)], { root });
  assert.equal(overCap.ok, false);
  assert.deepEqual(overCap.errors.map((e) => e.code), ['HARNESS_TRACE_REPEATS_EXCEEDED']);
});

test('compileHarness ends the debug walk cleanly once verify passes', () => {
  const chain = buildDebugChain('cart');
  const choosers = [chain.reproduce, chain.isolate, chain.fix, chain.verify];
  const trace = [
    { chooser: 'debug.reproduce', option: 'playwright-test' },
    { chooser: 'debug.isolate', option: 'narrow' },
    { chooser: 'debug.fix', option: 'add-unit' },
    { chooser: 'debug.verify', option: 'rerun-repro', resultFacts: [] },
  ];
  const result = compileHarness(DEBUG_HARNESS_DOC, choosers, trace, { root });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.plan.steps.length, 4);
});

test('compileHarness inserts a manual.task approval gate between two steps when the source step requires it', () => {
  const doc = { version: 1, id: 'gated', steps: [{ chooser: 'a', next: 'b', approval: true }, { chooser: 'b' }] };
  const result = compileHarness(doc, [a, b], [
    { chooser: 'a', option: 'a1' },
    { chooser: 'b', option: 'b1' },
  ], { root });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(result.plan.steps.map((s) => s.flow), ['check.types', 'manual.task', 'research.doctor']);
  const [first, gate, last] = result.plan.steps;
  assert.deepEqual(gate.dependsOn, [first.id]);
  assert.deepEqual(last.dependsOn, [gate.id]);
});

test('compileHarness fails cleanly on a trace that does not start at the first declared step', () => {
  const result = compileHarness(twoStepDoc(), [a, b], [{ chooser: 'b', option: 'b1' }], { root });
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors.map((e) => e.code), [HARNESS_ERROR_CODES.HARNESS_TRACE_FIRST_STEP]);
});

test('compileHarness reports a missing Chooser instance instead of throwing', () => {
  const result = compileHarness(twoStepDoc(), [a], [{ chooser: 'a', option: 'a1' }, { chooser: 'b', option: 'b1' }], { root });
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors.map((e) => e.code), [HARNESS_ERROR_CODES.HARNESS_CHOOSERS_MISSING]);
});
