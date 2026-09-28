// packages/core/validate-architecture-config.mjs — one entry point that
// collects every shape error in a proposed architecture.yml instead of
// throwing on the first (#395/#761).
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateArchitectureConfig } from '../packages/core/validate-architecture-config.mjs';

test('validateArchitectureConfig: valid config round-trips clean', () => {
  const result = validateArchitectureConfig({
    project: { framework: 'nextjs' },
    rules: { 'PAGE-001': 'warning' },
    exceptions: [{ path: 'features/legacy/**', rule: 'PAGE-004', expires: '2999-01-01' }],
    frozen: ['../design/**'],
    nonLayer: ['features/*/tests/**'],
    features: { root: 'construct' },
  });
  assert.deepEqual(result, { valid: true, errors: [] });
});

test('validateArchitectureConfig: no-op / absent config is valid', () => {
  assert.deepEqual(validateArchitectureConfig(undefined), { valid: true, errors: [] });
  assert.deepEqual(validateArchitectureConfig({}), { valid: true, errors: [] });
});

test('validateArchitectureConfig: top-level must be a mapping', () => {
  const result = validateArchitectureConfig([1, 2, 3]);
  assert.equal(result.valid, false);
  assert.match(result.errors[0], /must be a YAML mapping/);
});

test('validateArchitectureConfig: rejects a bad severity', () => {
  const result = validateArchitectureConfig({ rules: { 'PAGE-001': 'catastrophic' } });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /Invalid severity/.test(e)));
});

test('validateArchitectureConfig: rejects an unknown rule id', () => {
  const result = validateArchitectureConfig({ rules: { 'BOGUS-1': 'error' } });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /Unknown rule 'BOGUS-1'/.test(e)));
});

test('validateArchitectureConfig: rejects a malformed exception expiry', () => {
  const result = validateArchitectureConfig({
    exceptions: [{ path: 'a/**', rule: 'PAGE-004', expires: 'not-a-date' }],
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /valid ISO date/.test(e)));
});

test('validateArchitectureConfig: rejects a cyclic layer graph', () => {
  const result = validateArchitectureConfig({
    layers: {
      a: { canImport: ['b'] },
      b: { canImport: ['a'] },
    },
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /cycle detected/.test(e)));
});

test('validateArchitectureConfig: rejects an empty features.root', () => {
  const result = validateArchitectureConfig({ features: { root: '' } });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /features\.root/.test(e)));
});

test('validateArchitectureConfig: collects multiple independent errors at once', () => {
  const result = validateArchitectureConfig({
    rules: { 'BOGUS-1': 'error' },
    frozen: ['/absolute/path'],
    exceptions: [{ path: 'a/**', rule: 'X', expires: 'nope' }],
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.length >= 3, `expected >=3 errors, got ${result.errors.length}: ${result.errors.join(' | ')}`);
});
