import test from 'node:test';
import assert from 'node:assert/strict';
import { initialSteps, applyStepEvent, endRun, stepNote, PHASE_ORDER } from './WizardSteps.ts';

const statuses = (steps) => steps.map((s) => s.status);

test('every block starts pending, in run order', () => {
  const steps = initialSteps();
  assert.deepEqual(steps.map((s) => s.phase), [...PHASE_ORDER]);
  assert.ok(statuses(steps).every((s) => s === 'pending'));
});

test('a step event makes exactly that block active and finishes the one before it', () => {
  let steps = applyStepEvent(initialSteps(), { phase: 'tracing', detail: { routes: ['/a'] } });
  assert.deepEqual(statuses(steps).slice(0, 2), ['active', 'pending']);
  steps = applyStepEvent(steps, { phase: 'analyzing', detail: { provider: 'claude', files: 4 } });
  assert.deepEqual(statuses(steps).slice(0, 3), ['done', 'active', 'pending']);
  assert.equal(steps[1].note, 'Analyzing 4 file(s) via claude');
});

test('a repeated filling event stays on the same block and only updates its note', () => {
  let steps = applyStepEvent(initialSteps(), { phase: 'filling', detail: { file: 'a.tsx', index: 1, total: 3 } });
  steps = applyStepEvent(steps, { phase: 'filling', detail: { file: 'b.tsx', index: 2, total: 3 } });
  const filling = steps.find((s) => s.phase === 'filling');
  assert.equal(filling.status, 'active');
  assert.equal(filling.note, 'Filling b.tsx (2/3)');
});

test('jumping past a block that never ran marks it skipped, not done', () => {
  const steps = applyStepEvent(initialSteps(), { phase: 'validating', detail: { feature: 'checkout' } });
  assert.equal(steps.find((s) => s.phase === 'tracing').status, 'skipped');
  assert.equal(steps.find((s) => s.phase === 'validating').status, 'active');
  assert.equal(steps.find((s) => s.phase === 'auto-fixing').status, 'pending');
});

test('done closes the active block and skips the rest; cancelled marks the active block cancelled', () => {
  const running = applyStepEvent(applyStepEvent(initialSteps(), { phase: 'tracing' }), { phase: 'filling', detail: {} });
  assert.deepEqual(statuses(applyStepEvent(running, { phase: 'done' })).filter((s) => s === 'active'), []);
  const cancelled = applyStepEvent(running, { phase: 'cancelled', detail: { during: 'filling' } });
  assert.equal(cancelled.find((s) => s.phase === 'filling').status, 'cancelled');
  assert.equal(cancelled.find((s) => s.phase === 'auto-fixing').status, 'skipped');
});

test('an unknown phase is ignored, never crashes', () => {
  const steps = initialSteps();
  assert.deepEqual(applyStepEvent(steps, { phase: 'made-up' }), steps);
});

test('endRun marks a block still running as stopped (the session ended early)', () => {
  const steps = endRun(applyStepEvent(initialSteps(), { phase: 'tracing', detail: { routes: ['/x'] } }));
  assert.equal(steps[0].status, 'stopped');
  assert.equal(steps[1].status, 'skipped');
});

test('stepNote reads as a plain line for each phase', () => {
  assert.equal(stepNote({ phase: 'plan-ready', detail: { units: 3 } }), 'Plan ready: 3 unit(s)');
  assert.equal(stepNote({ phase: 'cancelled', detail: { during: 'auto-fixing' } }), 'Cancelled while auto-fixing');
});
