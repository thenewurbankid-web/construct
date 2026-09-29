import test from 'node:test';
import assert from 'node:assert/strict';
import { addComposeStep, removeComposeStep, moveComposeStep } from './ComposeSteps.ts';

const flow = (id, overrides = {}) => ({ id, summary: `${id} summary.`, executors: ['deterministic'], writes: true, offered: true, ...overrides });

test('addComposeStep appends a step from the flow, deriving a title and defaulting to the flow\'s first executor', () => {
  const { steps, nextId } = addComposeStep(flow('create.unit'), [], 1);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].flow, 'create.unit');
  assert.equal(steps[0].executor, 'deterministic');
  assert.equal(steps[0].id, 'step-1');
  assert.equal(nextId, 2);
});

test('addComposeStep never collides an id with an existing step (e.g. one loaded from a saved flow)', () => {
  const loaded = [{ id: 'step-1', title: 'x', flow: 'create.unit', args: {}, executor: 'deterministic' }];
  const { steps } = addComposeStep(flow('create.unit'), loaded, 1);
  assert.equal(steps.length, 2);
  assert.notEqual(steps[1].id, 'step-1');
});

test('addComposeStep picks a local-model flow\'s AI provenance as the default executor', () => {
  const { steps } = addComposeStep(flow('research.spec', { executors: ['local-model', 'deterministic'] }), [], 1);
  assert.equal(steps[0].executor, 'local-model');
});

test('addComposeStep declares empty touches for a writes flow (required by validatePlan) and none for a read-only one', () => {
  const writing = addComposeStep(flow('create.unit', { writes: true }), [], 1).steps[0];
  assert.deepEqual(writing.touches, { features: [], files: [] });
  const reading = addComposeStep(flow('check.types', { writes: false }), [], 1).steps[0];
  assert.equal(reading.touches, undefined);
});

test('removeComposeStep drops exactly the named step', () => {
  const steps = [
    { id: 'a', title: 'A', flow: 'x', args: {}, executor: 'deterministic' },
    { id: 'b', title: 'B', flow: 'y', args: {}, executor: 'deterministic' },
  ];
  assert.deepEqual(
    removeComposeStep(steps, 'a').map((s) => s.id),
    ['b'],
  );
});

test('moveComposeStep swaps neighbors and is a no-op at either end', () => {
  const steps = [
    { id: 'a', title: 'A', flow: 'x', args: {}, executor: 'deterministic' },
    { id: 'b', title: 'B', flow: 'y', args: {}, executor: 'deterministic' },
    { id: 'c', title: 'C', flow: 'z', args: {}, executor: 'deterministic' },
  ];
  assert.deepEqual(
    moveComposeStep(steps, 'b', -1).map((s) => s.id),
    ['b', 'a', 'c'],
  );
  assert.deepEqual(
    moveComposeStep(steps, 'a', -1).map((s) => s.id),
    ['a', 'b', 'c'],
  );
  assert.deepEqual(
    moveComposeStep(steps, 'c', 1).map((s) => s.id),
    ['a', 'b', 'c'],
  );
});
