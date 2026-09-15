import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertValidViolation,
  makeViolation,
  formatViolation,
  formatReport,
  exitCodeForViolations,
  ConstructError,
  EXIT_CODES,
} from '../src/diagnostics.mjs';

const VALID = {
  rule: 'PAGE-004',
  module: 'architecture',
  severity: 'error',
  file: 'features/x/pages/X.tsx',
  line: 3,
  message: 'Page calls fetch().',
  why: 'Pages cannot own application flow.',
  expected: ['controller', 'workflow'],
};

test('assertValidViolation accepts a well-formed violation', () => {
  assert.equal(assertValidViolation(VALID), true);
});

test('assertValidViolation rejects a missing required field', () => {
  const { why, ...missingWhy } = VALID;
  assert.throws(() => assertValidViolation(missingWhy), /missing "why"/);
});

test('assertValidViolation rejects an unknown severity', () => {
  assert.throws(() => assertValidViolation({ ...VALID, severity: 'critical' }), /Invalid violation severity/);
});

test('assertValidViolation rejects an unknown module', () => {
  assert.throws(() => assertValidViolation({ ...VALID, module: 'styling' }), /Invalid violation module/);
});

test('assertValidViolation rejects a non-array "expected"', () => {
  assert.throws(() => assertValidViolation({ ...VALID, expected: 'controller' }), /must be an array/);
});

test('makeViolation returns the shape unchanged when valid', () => {
  const v = makeViolation(VALID);
  assert.equal(v.rule, 'PAGE-004');
  assert.deepEqual(v.expected, ['controller', 'workflow']);
});

test('makeViolation throws through assertValidViolation on bad input', () => {
  assert.throws(() => makeViolation({ ...VALID, severity: 'nope' }));
});

test('formatViolation includes rule, module, location, message, why', () => {
  const text = formatViolation(VALID);
  assert.match(text, /PAGE-004/);
  assert.match(text, /\[architecture\]/);
  assert.match(text, /features\/x\/pages\/X\.tsx:3/);
  assert.match(text, /Why: Pages cannot own application flow\./);
});

test('formatViolation appends suggestedFix and docsUrl when present', () => {
  const text = formatViolation({ ...VALID, suggestedFix: 'Move the fetch to a service.', docsUrl: 'https://example.com/PAGE-004' });
  assert.match(text, /Fix: Move the fetch to a service\./);
  assert.match(text, /Docs: https:\/\/example\.com\/PAGE-004/);
});

test('formatReport prints a pass message for no violations', () => {
  assert.equal(formatReport([]), '✓ Construct validation passed');
});

test('formatReport (json) reports failed status when an error-severity violation exists', () => {
  const out = JSON.parse(formatReport([VALID], { format: 'json' }));
  assert.equal(out.status, 'failed');
  assert.equal(out.violations.length, 1);
});

test('formatReport (json) reports passed status when only warnings exist', () => {
  const warning = { ...VALID, severity: 'warning' };
  const out = JSON.parse(formatReport([warning], { format: 'json' }));
  assert.equal(out.status, 'passed');
});

test('exitCodeForViolations returns VIOLATIONS when an error is present', () => {
  assert.equal(exitCodeForViolations([VALID]), EXIT_CODES.VIOLATIONS);
});

test('exitCodeForViolations returns OK when only warnings/no violations are present', () => {
  assert.equal(exitCodeForViolations([]), EXIT_CODES.OK);
  assert.equal(exitCodeForViolations([{ ...VALID, severity: 'warning' }]), EXIT_CODES.OK);
});

test('ConstructError carries violations and an exit code', () => {
  const err = new ConstructError('validation failed', { violations: [VALID], exitCode: EXIT_CODES.VIOLATIONS });
  assert.equal(err.name, 'ConstructError');
  assert.equal(err.exitCode, EXIT_CODES.VIOLATIONS);
  assert.equal(err.violations.length, 1);
});
