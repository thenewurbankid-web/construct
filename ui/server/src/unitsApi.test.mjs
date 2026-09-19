import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unitsIndex, unitSummary, featuresIndex, featureSummary } from './unitsApi.mjs';

const EXAMPLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../example');

test('GET /api/features lists features with health', () => {
  const { status, body } = featuresIndex(EXAMPLE);
  assert.equal(status, 200);
  assert.deepEqual(body.features.map((f) => f.name), ['core', 'login', 'signup']);
});

test('GET /api/features/:name/summary honours ?detail= and maps errors to HTTP statuses', () => {
  const brief = featureSummary(EXAMPLE, 'login', { detail: 'brief' });
  assert.equal(brief.status, 200);
  assert.equal(brief.body.detail, 'brief');
  assert.equal(featureSummary(EXAMPLE, 'nope', {}).status, 404);
  assert.equal(featureSummary(EXAMPLE, 'login', { detail: 'huge' }).status, 400);
});

test('GET /api/units and /api/units/summary (ref, kind, include); ambiguity is 409 with candidates', () => {
  assert.equal(unitsIndex(EXAMPLE, { kind: 'hook' }).body.units[0].kind, 'hook');
  assert.equal(unitsIndex(EXAMPLE, { kind: 'bogus' }).status, 400);
  const r = unitSummary(EXAMPLE, { ref: 'useLogin', include: 'exports' });
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body.sections), ['exports']);
  const amb = unitSummary(EXAMPLE, { ref: 'Login' });
  assert.equal(amb.status, 409);
  assert.ok(amb.body.error.candidates.length > 1);
  assert.equal(unitSummary(EXAMPLE, {}).status, 400);
});

test('path traversal in ref is rejected (400) and never reads outside the project', () => {
  const r = unitSummary(EXAMPLE, { ref: 'file:../../package.json' });
  assert.equal(r.status, 400);
  assert.ok(!JSON.stringify(r.body).includes('construct-architecture'));
});
