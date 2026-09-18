// src/exceptions.mjs — the one shared implementation of scoped, time-boxed rule exceptions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateExceptionsShape, exceptionApplies, expiredExceptionViolations } from '../src/exceptions.mjs';
import * as arch from '../src/architecture-enforcer.mjs';

const live = { rule: 'PAGE-004', path: 'features/legacy/**', expires: '2999-01-01' };

test('exceptionApplies: rule + glob + expiry', () => {
  const config = { exceptions: [live] };
  assert.equal(exceptionApplies(config, 'PAGE-004', 'features/legacy/pages/X.tsx'), true);
  assert.equal(exceptionApplies(config, 'PAGE-003', 'features/legacy/pages/X.tsx'), false);
  assert.equal(exceptionApplies(config, 'PAGE-004', 'features/new/pages/X.tsx'), false);
  assert.equal(exceptionApplies({ exceptions: [{ ...live, expires: '2000-01-01' }] }, 'PAGE-004', 'features/legacy/a.ts'), false);
  assert.equal(exceptionApplies({}, 'PAGE-004', 'features/legacy/a.ts'), false);
});

test('exceptionApplies: "rules" array, no expiry, Date expiry', () => {
  assert.equal(exceptionApplies({ exceptions: [{ rules: ['A-1', 'B-2'], path: 'x/**' }] }, 'B-2', 'x/y.ts'), true);
  assert.equal(exceptionApplies({ exceptions: [{ ...live, expires: new Date('2999-01-01') }] }, 'PAGE-004', 'features/legacy/a.ts'), true);
  assert.equal(exceptionApplies({ exceptions: [{ ...live, expires: new Date('2000-01-01') }] }, 'PAGE-004', 'features/legacy/a.ts'), false);
});

test('validateExceptionsShape: accepts good, rejects malformed with the entry named', () => {
  assert.equal(validateExceptionsShape({ exceptions: [live] }), true);
  assert.equal(validateExceptionsShape({}), true);
  assert.throws(() => validateExceptionsShape({ exceptions: [{ rule: 'A' }] }), /exceptions\[0\].*"path"/);
  assert.throws(() => validateExceptionsShape({ exceptions: [live, { path: 'a/**' }] }), /exceptions\[1\].*"rule"/);
  assert.throws(() => validateExceptionsShape({ exceptions: [{ path: 'a/**', rules: [] }] }), /non-empty/);
  assert.throws(() => validateExceptionsShape({ exceptions: [{ path: 'a/**', rule: 'A', expires: 'nope' }] }), /valid ISO date/);
});

test('expiredExceptionViolations: warns only for stale entries', () => {
  const v = expiredExceptionViolations({ exceptions: [live, { rule: 'X-1', path: 'old/**', expires: new Date('2000-01-01') }] });
  assert.equal(v.length, 1);
  assert.equal(v[0].rule, 'EXCEPTION-EXPIRED');
  assert.equal(v[0].severity, 'warning');
  assert.match(v[0].message, /2000-01-01/);
});

test('architecture-enforcer re-exports the same functions (back-compat)', () => {
  assert.equal(arch.exceptionApplies, exceptionApplies);
  assert.equal(arch.validateExceptionsShape, validateExceptionsShape);
  assert.equal(arch.expiredExceptionViolations, expiredExceptionViolations);
});
