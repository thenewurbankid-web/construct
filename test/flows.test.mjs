// #759 (epic #395) -- the saved-flow primitive: save, load, round-trip and the envelope-step
// mapping the Envelopes composer will call through `construct pipeline run`.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import {
  isValidFlowName,
  validateFlowSteps,
  saveFlow,
  loadFlow,
  listFlows,
  deleteFlow,
  flowToEnvelopeSteps,
  flowPath,
} from '../packages/core/flows.mjs';

function tmpProject() {
  const dir = makeTempDir('construct-flows-test-');
  fs.writeFileSync(path.join(dir, 'architecture.yml'), 'version: 1\npreset: strict-nextjs\nproject:\n  framework: nextjs\nfeatures:\n  root: features\n');
  return dir;
}

const STEPS = [
  {
    id: 's1',
    title: 'Total',
    flow: 'create.unit',
    args: { layer: 'domain', name: 'Total', feature: 'checkout' },
    executor: 'deterministic',
    touches: { features: ['checkout'], files: [{ path: 'features/checkout/domain/Total.ts', change: 'create' }] },
  },
  {
    id: 's2',
    title: 'Cart',
    flow: 'create.unit',
    args: { layer: 'service', name: 'Cart', feature: 'checkout' },
    executor: 'deterministic',
    touches: { features: ['checkout'], files: [{ path: 'features/checkout/service/Cart.ts', change: 'create' }] },
  },
];

test('isValidFlowName accepts safe names and rejects traversal/separators', () => {
  assert.equal(isValidFlowName('scaffold-checkout'), true);
  assert.equal(isValidFlowName('a.b_c-9'), true);
  assert.equal(isValidFlowName('../escape'), false);
  assert.equal(isValidFlowName('a/b'), false);
  assert.equal(isValidFlowName(''), false);
  assert.equal(isValidFlowName('a'.repeat(65)), false);
});

test('validateFlowSteps accepts well-formed steps and rejects a bad arg', () => {
  assert.equal(validateFlowSteps(STEPS).valid, true);

  const bad = [{ id: 's1', title: 'Total', flow: 'create.unit', args: { layer: 'domain' }, executor: 'deterministic' }];
  const { valid, errors } = validateFlowSteps(bad);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.path === 'steps[0].args.name'));
});

test('saveFlow writes a validated flow and refuses an invalid one', () => {
  const dir = tmpProject();

  const ok = saveFlow(dir, 'scaffold-checkout', STEPS);
  assert.equal(ok.ok, true);
  assert.equal(ok.path, flowPath(dir, 'scaffold-checkout'));
  assert.equal(fs.existsSync(ok.path), true);

  const badSteps = [{ id: 's1', title: 'Total', flow: 'create.unit', args: { layer: 'domain' }, executor: 'deterministic' }];
  const bad = saveFlow(dir, 'broken', badSteps);
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.length > 0);
  assert.equal(fs.existsSync(flowPath(dir, 'broken')), false);
});

test('saveFlow refuses an unsafe name before touching the filesystem', () => {
  const dir = tmpProject();
  const result = saveFlow(dir, '../escape', STEPS);
  assert.equal(result.ok, false);
  assert.equal(fs.existsSync(path.join(dir, '..', 'escape.json')), false);
});

test('loadFlow round-trips exactly what was saved', () => {
  const dir = tmpProject();
  saveFlow(dir, 'scaffold-checkout', STEPS);

  const loaded = loadFlow(dir, 'scaffold-checkout');
  assert.equal(loaded.ok, true);
  assert.deepEqual(loaded.steps, STEPS);
  assert.equal(typeof loaded.savedAt, 'string');
});

test('loadFlow reports a clear error for a name that was never saved', () => {
  const dir = tmpProject();
  const result = loadFlow(dir, 'never-saved');
  assert.equal(result.ok, false);
  assert.ok(result.errors[0].includes('never-saved'));
});

test('listFlows is empty before any save and alphabetical after several', () => {
  const dir = tmpProject();
  assert.deepEqual(listFlows(dir), []);

  saveFlow(dir, 'zeta', STEPS);
  saveFlow(dir, 'alpha', STEPS);
  assert.deepEqual(listFlows(dir), ['alpha', 'zeta']);
});

test('deleteFlow removes a saved flow and is a no-op when it never existed', () => {
  const dir = tmpProject();
  saveFlow(dir, 'scaffold-checkout', STEPS);

  assert.equal(deleteFlow(dir, 'scaffold-checkout').ok, true);
  assert.equal(fs.existsSync(flowPath(dir, 'scaffold-checkout')), false);
  assert.equal(deleteFlow(dir, 'scaffold-checkout').ok, true);
});

test('flowToEnvelopeSteps maps create.unit steps to {layer, name}, in order, skipping other flows', () => {
  const withOther = [
    { id: 's0', title: 'Feature', flow: 'create.feature', args: { name: 'checkout' }, executor: 'deterministic' },
    ...STEPS,
  ];
  assert.deepEqual(flowToEnvelopeSteps(withOther), [
    { layer: 'domain', name: 'Total' },
    { layer: 'service', name: 'Cart' },
  ]);
});

test('a saved-then-loaded flow produces the same envelope steps as the steps run inline', () => {
  const dir = tmpProject();
  saveFlow(dir, 'scaffold-checkout', STEPS);

  const loaded = loadFlow(dir, 'scaffold-checkout');
  assert.deepEqual(flowToEnvelopeSteps(loaded.steps), flowToEnvelopeSteps(STEPS));
});
