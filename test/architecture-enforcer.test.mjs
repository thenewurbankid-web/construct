import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConstructError } from '../src/diagnostics.mjs';
import { CANONICAL_LAYERS } from '../src/architecture-graph.mjs';
import {
  classifyFile,
  detectLayerViolations,
  matchGlob,
  exceptionApplies,
  validateExceptionsShape,
  expiredExceptionViolations,
  validateArchitecture,
} from '../src/architecture-enforcer.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function tmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'construct-enforcer-'));
}

// ---- classifier (in-memory, path-string only) --------------------------

test('classifyFile recognizes every layer by path pattern', () => {
  assert.equal(classifyFile('app/dashboard/page.tsx', CANONICAL_LAYERS), 'route');
  assert.equal(classifyFile('features/checkout/controllers/CheckoutController.tsx', CANONICAL_LAYERS), 'controller');
  assert.equal(classifyFile('features/checkout/workflows/CheckoutWorkflow.ts', CANONICAL_LAYERS), 'workflow');
  assert.equal(classifyFile('features/checkout/hooks/useCheckout.tsx', CANONICAL_LAYERS), 'hook');
  assert.equal(classifyFile('features/checkout/domain/total.ts', CANONICAL_LAYERS), 'domain');
  assert.equal(classifyFile('features/checkout/services/CheckoutService.ts', CANONICAL_LAYERS), 'service');
  assert.equal(classifyFile('features/checkout/pages/CheckoutPage.tsx', CANONICAL_LAYERS), 'page');
  assert.equal(classifyFile('features/checkout/components/Button.tsx', CANONICAL_LAYERS), 'component');
});

test('classifyFile returns null for a file that matches no layer pattern', () => {
  assert.equal(classifyFile('features/checkout/utils/helpers.ts', CANONICAL_LAYERS), null);
  assert.equal(classifyFile('README.md', CANONICAL_LAYERS), null);
});

// ---- detectLayerViolations (pure, in-memory source strings) ------------

test('detectLayerViolations flags a route with no controller import (ROUTE-001)', () => {
  const violations = detectLayerViolations('route', `export default function Page() { return <div/>; }`);
  assert.ok(violations.some((v) => v.rule === 'ROUTE-001'));
});

test('detectLayerViolations flags a route effect only, given a controller import (ROUTE-002)', () => {
  const source = `import { X } from '../../features/x/controllers/XController';\nexport default function Page(){ fetch('/'); return <X/>; }`;
  const violations = detectLayerViolations('route', source);
  assert.deepEqual(violations.map((v) => v.rule), ['ROUTE-002']);
});

test('detectLayerViolations flags each page rule independently', () => {
  assert.deepEqual(detectLayerViolations('page', `import { W } from '../workflows/W';`).map((v) => v.rule), ['PAGE-002']);
  assert.deepEqual(detectLayerViolations('page', `import { S } from '../services/S';`).map((v) => v.rule), ['PAGE-003']);
  assert.deepEqual(detectLayerViolations('page', `export function P(){ fetch('/'); }`).map((v) => v.rule), ['PAGE-004']);
  assert.deepEqual(detectLayerViolations('page', `import { D } from '../domain/D';`).map((v) => v.rule), ['PAGE-005']);
  assert.deepEqual(detectLayerViolations('page', `export function P(){ useMachine(); }`).map((v) => v.rule), ['PAGE-006']);
});

test('detectLayerViolations splits component rules (controller vs workflow/service/domain)', () => {
  assert.deepEqual(detectLayerViolations('component', `import { C } from '../controllers/C';`).map((v) => v.rule), ['COMPONENT-002']);
  assert.deepEqual(detectLayerViolations('component', `import { S } from '../services/S';`).map((v) => v.rule), ['COMPONENT-003']);
});

test('detectLayerViolations flags React imports in workflow/service layers', () => {
  assert.deepEqual(detectLayerViolations('workflow', `import { useState } from 'react';`).map((v) => v.rule), ['WORKFLOW-001']);
  assert.deepEqual(detectLayerViolations('service', `import { useEffect } from 'react';`).map((v) => v.rule), ['SERVICE-002']);
});

test('detectLayerViolations flags effects inside domain code', () => {
  for (const src of [`export function f(){ return fetch('/'); }`, `export function f(){ return window.innerWidth; }`, `export function f(){ return localStorage.getItem('x'); }`]) {
    assert.deepEqual(detectLayerViolations('domain', src).map((v) => v.rule), ['DOMAIN-001']);
  }
});

test('detectLayerViolations returns nothing for clean code', () => {
  assert.deepEqual(detectLayerViolations('domain', `export function pure(x){ return x + 1; }`), []);
  assert.deepEqual(detectLayerViolations('component', `export function C(){ return <div/>; }`), []);
});

// ---- exception matching -------------------------------------------------

test('matchGlob supports ** and * wildcards', () => {
  assert.equal(matchGlob('features/legacy/**', 'features/legacy/pages/X.tsx'), true);
  assert.equal(matchGlob('features/legacy/**', 'features/other/pages/X.tsx'), false);
  assert.equal(matchGlob('features/*/pages/*.tsx', 'features/x/pages/X.tsx'), true);
});

test('exceptionApplies matches by rule + path and honors expiry', () => {
  const config = { exceptions: [{ rule: 'PAGE-004', path: 'features/legacy/**', expires: '2999-01-01' }] };
  assert.equal(exceptionApplies(config, 'PAGE-004', 'features/legacy/pages/X.tsx'), true);
  assert.equal(exceptionApplies(config, 'PAGE-003', 'features/legacy/pages/X.tsx'), false);

  const expired = { exceptions: [{ rule: 'PAGE-004', path: 'features/legacy/**', expires: '2000-01-01' }] };
  assert.equal(exceptionApplies(expired, 'PAGE-004', 'features/legacy/pages/X.tsx'), false);
});

test('exceptionApplies supports a "rules" array', () => {
  const config = { exceptions: [{ rules: ['PAGE-004', 'PAGE-003'], path: 'features/legacy/**' }] };
  assert.equal(exceptionApplies(config, 'PAGE-003', 'features/legacy/pages/X.tsx'), true);
});

test('validateExceptionsShape throws a ConstructError naming the malformed entry', () => {
  assert.throws(() => validateExceptionsShape({ exceptions: [{ rule: 'PAGE-004' }] }), (err) => {
    assert.ok(err instanceof ConstructError);
    assert.match(err.message, /exceptions\[0\]/);
    assert.match(err.message, /path/);
    return true;
  });
  assert.throws(() => validateExceptionsShape({ exceptions: [{ path: 'features/x/**' }] }), /rule/);
  assert.throws(() => validateExceptionsShape({ exceptions: [{ path: 'features/x/**', rule: 'PAGE-004', expires: 'not-a-date' }] }), /valid ISO date/);
});

test('validateExceptionsShape accepts a well-formed exception list', () => {
  assert.equal(validateExceptionsShape({ exceptions: [{ path: 'features/x/**', rule: 'PAGE-004', expires: '2999-01-01' }] }), true);
  assert.equal(validateExceptionsShape({}), true);
});

test('expiredExceptionViolations reports a warning for a stale exception', () => {
  const violations = expiredExceptionViolations({ exceptions: [{ rule: 'PAGE-004', path: 'features/legacy/**', expires: '2000-01-01' }] });
  assert.equal(violations.length, 1);
  assert.equal(violations[0].rule, 'EXCEPTION-EXPIRED');
  assert.equal(violations[0].severity, 'warning');
});

test('expiredExceptionViolations is silent for a live exception', () => {
  const violations = expiredExceptionViolations({ exceptions: [{ rule: 'PAGE-004', path: 'features/legacy/**', expires: '2999-01-01' }] });
  assert.deepEqual(violations, []);
});

// ---- filesystem-backed integration tests --------------------------------

test('validateArchitecture honors an exception scoping a violation away', () => {
  const dir = tmpProject();
  fs.mkdirSync(path.join(dir, 'features', 'legacy', 'pages'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'architecture.yml'), 'exceptions:\n  - rule: PAGE-004\n    path: features/legacy/**\n');
  fs.writeFileSync(path.join(dir, 'features', 'legacy', 'pages', 'X.tsx'), `export function X(){ fetch('/'); return <div/>; }`);
  const res = validateArchitecture(dir);
  assert.equal(res.violations.some((v) => v.rule === 'PAGE-004'), false);
});

test('validateArchitecture suggests a layer folder for an unclassifiable feature file', () => {
  const dir = tmpProject();
  fs.mkdirSync(path.join(dir, 'features', 'checkout', 'utils'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'features', 'checkout', 'utils', 'helpers.ts'), `export const x = 1;`);
  const res = validateArchitecture(dir);
  const v = res.violations.find((x) => x.file === 'features/checkout/utils/helpers.ts');
  assert.ok(v, 'expected a violation for the unclassifiable file');
  assert.equal(v.rule, 'SOC-001');
  assert.match(v.message, /"utils"/);
  assert.ok(v.expected.some((e) => e.includes('pages') || e.includes('components')));
});

test('validateArchitecture throws a ConstructError for a malformed exception in architecture.yml', () => {
  const dir = tmpProject();
  fs.writeFileSync(path.join(dir, 'architecture.yml'), 'exceptions:\n  - path: features/x/**\n');
  assert.throws(() => validateArchitecture(dir), ConstructError);
});

test('validateArchitecture can be scoped to a subset of files via opts.files', () => {
  const dir = tmpProject();
  fs.mkdirSync(path.join(dir, 'features', 'x', 'pages'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'features', 'x', 'domain'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'features', 'x', 'pages', 'Bad.tsx'), `export function Bad(){ fetch('/'); return <div/>; }`);
  fs.writeFileSync(path.join(dir, 'features', 'x', 'domain', 'pure.ts'), `export function f(){ return fetch('/'); }`);
  const scoped = validateArchitecture(dir, { files: ['features/x/pages/Bad.tsx'] });
  assert.equal(scoped.violations.length, 1);
  assert.equal(scoped.violations[0].rule, 'PAGE-004');
});

// ---- fixtures -------------------------------------------------------------

test('architecture-valid fixture produces zero error-severity violations', () => {
  const res = validateArchitecture(path.join(REPO_ROOT, 'fixtures', 'architecture-valid'));
  const errors = res.violations.filter((v) => v.severity === 'error');
  assert.deepEqual(errors, []);
});

test('architecture-invalid fixture reports exactly the expected rule per manifest entry', () => {
  const dir = path.join(REPO_ROOT, 'fixtures', 'architecture-invalid');
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const res = validateArchitecture(dir);
  for (const { file, expectedRule } of manifest) {
    const rulesForFile = res.violations.filter((v) => v.file === file).map((v) => v.rule);
    assert.deepEqual(rulesForFile, [expectedRule], `expected exactly [${expectedRule}] for ${file}, got [${rulesForFile}]`);
  }
  // Every violation is module:'architecture' and matches the frozen diagnostic shape.
  for (const v of res.violations) {
    assert.equal(v.module, 'architecture');
    assert.ok(['error', 'warning', 'off'].includes(v.severity));
  }
});
