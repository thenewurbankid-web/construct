import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';
import { saveFlow, loadFlow } from '../../../packages/core/flows.mjs';
import { envelopesIndex, envelopeShow, envelopePreview, envelopeSave } from './envelopesApi.mjs';

function tmpProject() {
  const dir = makeTempDir('envelopes-api-');
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
];

test('GET /api/envelopes lists nothing before any flow is saved', () => {
  const dir = tmpProject();
  const { status, body } = envelopesIndex(dir);
  assert.equal(status, 200);
  assert.deepEqual(body, { ok: true, flows: [] });
});

test('GET /api/envelopes lists every saved flow, alphabetical, with its step count', () => {
  const dir = tmpProject();
  assert.equal(saveFlow(dir, 'scaffold-checkout', STEPS).ok, true);
  assert.equal(saveFlow(dir, 'another-flow', STEPS).ok, true);

  const { status, body } = envelopesIndex(dir);
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.deepEqual(
    body.flows.map((f) => f.name),
    ['another-flow', 'scaffold-checkout'],
  );
  assert.equal(body.flows[0].stepCount, 1);
  assert.deepEqual(body.flows[0].steps, STEPS);
  assert.equal(body.flows[0].error, null);
});

test('GET /api/envelopes/:name reads one saved flow', () => {
  const dir = tmpProject();
  saveFlow(dir, 'scaffold-checkout', STEPS);

  const { status, body } = envelopeShow(dir, 'scaffold-checkout');
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.name, 'scaffold-checkout');
  assert.deepEqual(body.steps, STEPS);
  assert.ok(body.savedAt);
});

test('GET /api/envelopes/:name 404s for a name that was never saved', () => {
  const dir = tmpProject();
  const { status, body } = envelopeShow(dir, 'never-saved');
  assert.equal(status, 404);
  assert.equal(body.ok, false);
});

test('envelopePreview computes the remaining-steps envelope for each step, dropping the ones before it', () => {
  const second = { id: 's2', title: 'Cart', flow: 'create.unit', args: { layer: 'service', name: 'Cart', feature: 'checkout' }, executor: 'deterministic', touches: { features: ['checkout'], files: [] } };
  const { status, body } = envelopePreview([STEPS[0], second]);
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.previews.length, 2);
  assert.deepEqual(body.previews[0].steps, [{ layer: 'domain', name: 'Total' }, { layer: 'service', name: 'Cart' }]);
  assert.deepEqual(body.previews[1].steps, [{ layer: 'service', name: 'Cart' }]);
  assert.equal(body.previews[0].feature, 'checkout');
  assert.equal(body.previews[0].status, 'pending');
  assert.deepEqual(body.previews[0].layers, {});
});

test('envelopePreview refuses a non-array body', () => {
  assert.equal(envelopePreview(null).status, 400);
  assert.equal(envelopePreview('nope').status, 400);
});

test('envelopeSave previews (commit false) without writing, then commits, readable back through loadFlow', () => {
  const dir = tmpProject();
  const preview = envelopeSave(dir, 'scaffold-checkout', { steps: STEPS, commit: false });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.ok, true);
  assert.equal(loadFlow(dir, 'scaffold-checkout').ok, false, 'preview must not write anything');

  const saved = envelopeSave(dir, 'scaffold-checkout', { steps: STEPS, commit: true });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.ok, true);
  const loaded = loadFlow(dir, 'scaffold-checkout');
  assert.equal(loaded.ok, true);
  assert.deepEqual(loaded.steps, STEPS);
});

test('envelopeSave refuses a missing name, no steps, or a step missing required touches (a writes flow)', () => {
  const dir = tmpProject();
  assert.equal(envelopeSave(dir, '', { steps: STEPS, commit: true }).status, 400);
  assert.equal(envelopeSave(dir, 'x', { steps: [], commit: true }).status, 400);
  const noTouches = [{ id: 's1', title: 'Total', flow: 'create.unit', args: { layer: 'domain', name: 'Total', feature: 'checkout' }, executor: 'deterministic' }];
  const rejected = envelopeSave(dir, 'x', { steps: noTouches, commit: false });
  assert.equal(rejected.status, 422);
  assert.equal(rejected.body.ok, false);
  assert.equal(loadFlow(dir, 'x').ok, false);
});
