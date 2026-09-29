import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';
import { saveFlow } from '../../../packages/core/flows.mjs';
import { envelopesIndex, envelopeShow } from './envelopesApi.mjs';

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
