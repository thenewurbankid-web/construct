// #524 (epic #616) -- the second worked example the harness needs before any general engine (LIN-82: "no general
// engine before both chains exist"). Reproduce -> isolate -> fix -> verify, `debug.verify`'s failing outcome looping
// back to `debug.isolate` (re-diagnose before re-fixing) rather than straight to `debug.fix`. Every option is an
// existing Zero-LLM PLAN_FLOWS flow (test.run, test.proof, check.types, check.build, review.analyze,
// research.doctor, refactor.rename, refactor.move, create.unit); no new engine or chooser primitive needed for v1.
//
// `debug.fix`'s exit is `kind: 'ai'` (a model drafts the diff, carrying every GUARDRAILS gate), not a new `free`
// ChooserExit kind, per the accepted LIN-82 confirmation (5a35ee0c-011d-4c2e-ba4f-8b8abf5e7795, decision (a)): most
// bug fixes are neither a rename/move nor a new unit, and today's ChooserExit only knows `manual.task` or `ai`.
// Adding a hand-edit `free` exit kind is deliberately out of scope here; it is a separate follow-up once this chain
// proves the shape works, so the ChooserExit contract that the requirement-to-screen chain already depends on stays
// untouched.
import { defineChooser, EXIT_ANSWER } from './chooser.mjs';
import { GUARDRAILS } from './block-contract.mjs';

/**
 * The four choosers of the debug chain, fixed to one feature. Each option's args are fixed at definition time (the
 * "closed options" design: nobody types a flow's arguments), so a chain is built once per feature under debug.
 *
 * @param {string} feature The feature under debug; every option's `feature` arg.
 * @returns {{ reproduce: import('./chooser.mjs').Chooser, isolate: import('./chooser.mjs').Chooser, fix: import('./chooser.mjs').Chooser, verify: import('./chooser.mjs').Chooser }}
 * @throws {TypeError} When `feature` is not a non-empty string, or a chooser fails `defineChooser`'s own validation.
 *
 * @example
 * const { reproduce } = buildDebugChain('cart');
 * chooserSummary(reproduce, {}).options.map((o) => o.id); // => ['playwright-test', 'render-proof', 'type-error', 'build-error']
 */
export function buildDebugChain(feature) {
  if (typeof feature !== 'string' || feature.trim().length === 0) {
    throw new TypeError('buildDebugChain needs a non-empty feature name.');
  }

  const reproduce = defineChooser({
    id: 'debug.reproduce',
    question: 'How do you already have this failing?',
    options: [
      { id: 'playwright-test', label: 'A failing Playwright test', flow: 'test.run', args: { feature }, why: 'Classifies a convention failure (test harness) from an app failure (a real bug).' },
      { id: 'render-proof', label: 'A failing render proof', flow: 'test.proof', args: { feature }, why: 'Same classification as a Playwright test, no browser needed.' },
      { id: 'type-error', label: 'A type error', flow: 'check.types', args: { feature }, why: 'Errors grouped by file, first ten.' },
      { id: 'build-error', label: 'A build error', flow: 'check.build', args: {}, why: 'Pass, compile error or timeout, bounded.' },
    ],
    exit: {
      flow: 'manual.task',
      label: 'Write a failing test or repro note first',
      args: { instructions: `No repro exists yet for "${feature}". Write a failing test or a repro note before debugging.` },
    },
  });

  const isolate = defineChooser({
    id: 'debug.isolate',
    question: 'What does the failing check say?',
    options: [
      { id: 'scope-diff', label: 'A recent change looks suspect', flow: 'review.analyze', args: { base: 'HEAD~1', head: 'HEAD' }, why: 'Read-only: did a recent change touch this file or feature.' },
      { id: 'narrow', label: 'Narrow to the one failing case', flow: 'test.run', args: { feature }, why: 'Isolates by re-running the same check narrowed to the failing case.' },
      { id: 'env-check', label: 'Rule out environment or tooling', flow: 'research.doctor', args: {}, why: 'Rules out tooling or environment before blaming code.' },
    ],
    exit: {
      flow: 'manual.task',
      label: 'Isolate by hand',
      args: { instructions: `Isolate the cause in "${feature}" by hand (logging, reading the stack trace).` },
    },
  });

  const fix = defineChooser({
    id: 'debug.fix',
    question: 'What kind of change fixes this?',
    options: [
      { id: 'rename', label: 'A unit is misnamed', flow: 'refactor.rename', args: { name: feature, newName: feature, feature, layer: 'domain' }, touches: { features: [feature] }, why: 'Renames the unit and rewrites every importer; never touches file content.' },
      { id: 'move', label: 'A unit is in the wrong layer', flow: 'refactor.move', args: { name: feature, feature, from: 'domain', to: 'service' }, touches: { features: [feature] }, why: 'Moves the unit and rewrites every importer; never touches file content.' },
      { id: 'add-unit', label: 'A unit is missing', flow: 'create.unit', args: { layer: 'domain', name: feature, feature }, why: 'Scaffolds the missing layer file.' },
    ],
    exit: { id: 'fill-with-ai', kind: 'ai', label: 'Fill with AI (reviewable diff)', enabled: true, gates: [...GUARDRAILS], why: 'Most bug fixes are neither a rename/move nor a new unit: a model drafts the diff, a person approves it.' },
  });

  const verify = defineChooser({
    id: 'debug.verify',
    question: 'Which check must go green to call this fixed?',
    options: [
      { id: 'rerun-repro', label: 'Re-run the original repro', flow: 'test.run', args: { feature }, why: 'The exact check chosen in debug.reproduce.' },
      { id: 'full-feature', label: 'Every test of the feature', flow: 'test.run', args: { feature }, why: 'Not just the failing one: the whole feature.' },
      { id: 'types-and-build', label: 'Types and build', flow: 'check.types', args: { feature }, why: 'Paired with check.build to confirm the project still compiles.' },
    ],
    exit: {
      flow: 'manual.task',
      label: 'Verify by hand',
      args: { instructions: `Verify the fix to "${feature}" by hand.` },
    },
  });

  return { reproduce, isolate, fix, verify };
}

/** The chain in step order, for `compileChain` and UI iteration. */
export function debugChainSteps(chain) {
  return [chain.reproduce, chain.isolate, chain.fix, chain.verify];
}

/**
 * Whether a `debug.verify` result should loop back to `debug.isolate` instead of ending the chain: any outcome other
 * than an explicit pass. Every candidate verify flow (test.run, test.proof, check.types, check.build) already emits
 * a structured pass/fail, so this needs no new classification.
 *
 * @param {{ passed: boolean }} verifyResult The structured result of the flow `debug.verify` chose.
 * @returns {boolean} `true` when the chain should repeat from `debug.isolate`.
 *
 * @example
 * shouldReiterate({ passed: false }); // => true
 * shouldReiterate({ passed: true });  // => false
 */
export function shouldReiterate(verifyResult) {
  return !(verifyResult && verifyResult.passed === true);
}

export { EXIT_ANSWER };
