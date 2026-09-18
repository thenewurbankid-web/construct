import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEnvelope, validateEnvelope, ENVELOPE_VERSION } from '../src/engine/envelope.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'schemas', 'envelope.v1.json'), 'utf8'));

test('createEnvelope produces a schema-valid v1 envelope', () => {
  const env = createEnvelope('checkout');
  assert.equal(env.version, ENVELOPE_VERSION);
  assert.equal(env.feature, 'checkout');
  assert.equal(env.status, 'pending');
  assert.deepEqual(env.layers, {});
  const { valid, errors } = validateEnvelope(env);
  assert.deepEqual(errors, []);
  assert.equal(valid, true);
});

// schemas/envelope.v1.json is the documented contract; this keeps
// validateEnvelope's required-field check honest against it rather than
// letting the two silently drift.
test("validateEnvelope enforces exactly the schema's declared required fields", () => {
  for (const key of SCHEMA.required) {
    const env = createEnvelope('checkout');
    delete env[key];
    const { valid, errors } = validateEnvelope(env);
    assert.equal(valid, false, `expected invalid when "${key}" is missing`);
    assert.ok(errors.some((e) => e.includes(key)), `expected an error mentioning "${key}", got: ${errors.join('; ')}`);
  }
});

test('validateEnvelope rejects a non-1 version, a bad status, and malformed layers', () => {
  assert.equal(validateEnvelope(createEnvelope('x', { version: 2 })).valid, false);
  assert.equal(validateEnvelope(createEnvelope('x', { status: 'bogus' })).valid, false);
  assert.equal(validateEnvelope(createEnvelope('x', { layers: { domain: 'not-an-array' } })).valid, false);
  assert.equal(validateEnvelope(createEnvelope('x', { layers: ['nope'] })).valid, false);
});

test('validateEnvelope rejects non-object input outright', () => {
  assert.equal(validateEnvelope(null).valid, false);
  assert.equal(validateEnvelope('a string').valid, false);
  assert.equal(validateEnvelope([1, 2, 3]).valid, false);
});

test('validateEnvelope validates unboundSlots shape (name + kind)', () => {
  const good = createEnvelope('x', { unboundSlots: [{ name: 'onSubmit', kind: 'callback' }] });
  assert.equal(validateEnvelope(good).valid, true);
  const badKind = createEnvelope('x', { unboundSlots: [{ name: 'onSubmit', kind: 'nope' }] });
  assert.equal(validateEnvelope(badKind).valid, false);
  const missingName = createEnvelope('x', { unboundSlots: [{ kind: 'callback' }] });
  assert.equal(validateEnvelope(missingName).valid, false);
});

test('validateEnvelope validates events shape (type required)', () => {
  assert.equal(validateEnvelope(createEnvelope('x', { events: [{ type: 'SUBMIT' }] })).valid, true);
  assert.equal(validateEnvelope(createEnvelope('x', { events: [{ payload: {} }] })).valid, false);
});

test('validateEnvelope validates steps shape (layer + name required)', () => {
  assert.equal(validateEnvelope(createEnvelope('x', { steps: [{ layer: 'domain', name: 'Total' }] })).valid, true);
  assert.equal(validateEnvelope(createEnvelope('x', { steps: [{ layer: 'domain' }] })).valid, false);
  assert.equal(validateEnvelope(createEnvelope('x', { steps: [{ name: 'Total' }] })).valid, false);
});

test('schemas/envelope.v1.json is well-formed, self-describing JSON Schema for the envelope shape', () => {
  assert.equal(SCHEMA.$schema, 'http://json-schema.org/draft-07/schema#');
  assert.equal(SCHEMA.type, 'object');
  assert.deepEqual(SCHEMA.required.sort(), ['version', 'feature', 'status', 'layers'].sort());
  assert.ok(SCHEMA.properties.unboundSlots);
  assert.ok(SCHEMA.properties.events);
  assert.ok(SCHEMA.properties.steps);
});
