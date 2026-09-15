import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateValidation } from '../src/registry.mjs';
import { makeViolation } from '../src/diagnostics.mjs';

// Small in-memory fake enforcers standing in for Modules 1-3's real
// architecture/separation-of-concerns/readability enforcers, which don't
// exist in the working tree yet. This proves aggregateValidation's
// merge/ok logic independent of any real enforcer implementation.
function fakeEnforcer(name, violations) {
  return { name, validate: () => ({ violations }) };
}

const errorViolation = makeViolation({
  rule: 'SOC-001',
  module: 'separation-of-concerns',
  severity: 'error',
  file: 'features/x/pages/X.tsx',
  line: 1,
  message: 'fake error violation',
  why: 'testing aggregation',
  expected: ['controller'],
});

const warningViolation = makeViolation({
  rule: 'READ-002',
  module: 'readability',
  severity: 'warning',
  file: 'features/x/domain/y.ts',
  line: 4,
  message: 'fake warning violation',
  why: 'testing aggregation',
  expected: ['smaller function'],
});

test('aggregateValidation merges violations from multiple enforcers', () => {
  const clean = fakeEnforcer('clean', []);
  const withError = fakeEnforcer('with-error', [errorViolation]);
  const withWarning = fakeEnforcer('with-warning', [warningViolation]);

  const { violations, ok } = aggregateValidation('/fake/root', [clean, withError, withWarning]);

  assert.equal(violations.length, 2);
  assert.equal(ok, false); // an error-severity violation is present
  assert.ok(violations.some((v) => v.rule === 'SOC-001'));
  assert.ok(violations.some((v) => v.rule === 'READ-002'));
});

test('aggregateValidation is ok when only warnings (or nothing) are reported', () => {
  const clean = fakeEnforcer('clean', []);
  const withWarning = fakeEnforcer('with-warning', [warningViolation]);

  const { violations, ok } = aggregateValidation('/fake/root', [clean, withWarning]);

  assert.equal(violations.length, 1);
  assert.equal(ok, true);
});

test('aggregateValidation with no enforcers returns an empty, ok report', () => {
  const { violations, ok } = aggregateValidation('/fake/root', []);
  assert.deepEqual(violations, []);
  assert.equal(ok, true);
});

test('aggregateValidation preserves each violation\'s own module tag', () => {
  const withError = fakeEnforcer('architecture', [errorViolation]);
  const withWarning = fakeEnforcer('readability', [warningViolation]);
  const { violations } = aggregateValidation('/fake/root', [withError, withWarning]);
  assert.equal(violations.find((v) => v.rule === 'SOC-001').module, 'separation-of-concerns');
  assert.equal(violations.find((v) => v.rule === 'READ-002').module, 'readability');
});
