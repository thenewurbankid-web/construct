import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConstructError } from '../packages/core/diagnostics.mjs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { CANONICAL_LAYERS, loadLayerGraph } from '../packages/core/architecture-graph.mjs';
import {
  classifyFile,
  detectLayerViolations,
  matchGlob,
  exceptionApplies,
  validateExceptionsShape,
  expiredExceptionViolations,
  validateArchitecture,
} from '../packages/core/architecture-enforcer.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function tmpProject() {
  return makeTempDir('construct-enforcer-');
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

// Ticket 7.2 (#112) regression: a page reaching for application state
// *indirectly*, via importing a custom hook, must be flagged under PAGE-006
// even when it never directly calls useMachine/useActor/createMachine
// itself -- this was a real gap (import-only usage previously slipped
// through) confirmed and closed as part of the epic's reconciliation notes.
test('detectLayerViolations flags PAGE-006 for a page that imports a custom hook, even with no useMachine/useActor/createMachine call', () => {
  const violations = detectLayerViolations('page', `import { useCart } from '../hooks/useCart';\nexport function P(){ const { items } = useCart(); return null; }`);
  assert.deepEqual(violations.map((v) => v.rule), ['PAGE-006']);
  assert.match(violations[0].message, /custom hook/);
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

// #74 regression: a comment (or string/property name) mentioning a banned substring
// must never trip a rule the way real code would — this was the actual false positive
// hit during the ui/ Next.js migration, and is the reason detectLayerViolations moved
// from whole-file text-pattern matching to real AST analysis (#89).
test('detectLayerViolations (#74 regression): a comment mentioning banned substrings does not trip any rule', () => {
  const domainSource = `
// This domain module intentionally has no workflow/service/domain effects — see fetch()
// usage in the services layer instead, and avoid window/document/localStorage here.
export function pure(x) {
  return x + 1;
}
`;
  assert.deepEqual(detectLayerViolations('domain', domainSource), []);

  const pageSource = `
// Do not import workflows/ or services/ or domain/ here, and never call fetch() or
// useMachine()/useActor()/createMachine() — this comment mentions all of them on purpose.
export function Page() {
  return null;
}
`;
  assert.deepEqual(detectLayerViolations('page', pageSource), []);

  const routeSource = `
// fetch/useMachine/useActor/localStorage/sessionStorage are all mentioned right here.
import { X } from '../../features/x/controllers/XController';
export default function Page(){ return <X/>; }
`;
  assert.deepEqual(detectLayerViolations('route', routeSource), []);

  const workflowSource = `
// this workflow talks to react (the library) in this comment only, never imports it
export function workflow() { return 1; }
`;
  assert.deepEqual(detectLayerViolations('workflow', workflowSource), []);

  // A same-named object property/import binding isn't a "usage" of the global either.
  const domainWithProperty = `
import { fetch as fetchThing } from './local-fetch-helper';
export function f() {
  const obj = { fetch: 1 };
  return obj.fetch + fetchThing();
}
`;
  assert.deepEqual(detectLayerViolations('domain', domainWithProperty), []);
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

// architecture.yml is YAML: an UNQUOTED date-like scalar (`expires: 2020-01-01`)
// is parsed by js-yaml's default schema into a real JS Date, not a string —
// only a quoted value (`expires: "2020-01-01"`) yields a string. Both are
// legitimate on-disk spellings of the same author intent and must both work.
test('validateExceptionsShape, exceptionApplies, and expiredExceptionViolations all accept a Date object for "expires" (js-yaml auto-parses unquoted dates)', () => {
  const expired = { rule: 'PAGE-004', path: 'features/legacy/**', expires: new Date('2000-01-01') };
  const live = { rule: 'PAGE-004', path: 'features/legacy/**', expires: new Date('2999-01-01') };

  assert.equal(validateExceptionsShape({ exceptions: [expired] }), true);

  assert.equal(exceptionApplies({ exceptions: [live] }, 'PAGE-004', 'features/legacy/pages/X.tsx'), true);
  assert.equal(exceptionApplies({ exceptions: [expired] }, 'PAGE-004', 'features/legacy/pages/X.tsx'), false);

  const violations = expiredExceptionViolations({ exceptions: [expired] });
  assert.equal(violations.length, 1);
  assert.equal(violations[0].rule, 'EXCEPTION-EXPIRED');
  assert.match(violations[0].message, /expired on 2000-01-01\./); // formatted as a plain date, not Date#toString()
});

test('validateExceptionsShape still rejects a genuinely invalid "expires" value', () => {
  assert.throws(
    () => validateExceptionsShape({ exceptions: [{ path: 'features/x/**', rule: 'PAGE-004', expires: new Date('not-a-date') }] }),
    /valid ISO date/,
  );
});

// ---- filesystem-backed integration tests --------------------------------

// #93 — ported from root test.mjs's one case (the only thing keeping the
// now-deleted src/validator.mjs alive), exercising validateArchitecture
// instead of validator.mjs's orphaned validateProject.
test('forbidden page fetch is detected (PAGE-004) against a real project directory', () => {
  const dir = tmpProject();
  fs.mkdirSync(path.join(dir, 'features', 'x', 'pages'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'architecture.yml'), 'rules:\n  PAGE-004: error\n');
  fs.writeFileSync(path.join(dir, 'features', 'x', 'pages', 'X.tsx'), 'export function X(){fetch("/");return <div/>}');
  const res = validateArchitecture(dir);
  assert.ok(res.violations.some((v) => v.rule === 'PAGE-004'));
});

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

// ---- IMPORT-001: dangling relative imports --------------------------------

test('validateArchitecture flags a relative import that resolves to nothing', () => {
  const dir = tmpProject();
  fs.mkdirSync(path.join(dir, 'features', 'x', 'controllers'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'features', 'x', 'controllers', 'XController.tsx'),
    `import { XPage } from '../pages/XPage';\nexport function XController(){ return <XPage/>; }`,
  );
  const res = validateArchitecture(dir);
  const v = res.violations.find((x) => x.rule === 'IMPORT-001');
  assert.ok(v, 'expected an IMPORT-001 violation');
  assert.equal(v.file, 'features/x/controllers/XController.tsx');
  assert.match(v.message, /"\.\.\/pages\/XPage"/);
});

test('validateArchitecture does not flag a relative import once the target file exists', () => {
  const dir = tmpProject();
  fs.mkdirSync(path.join(dir, 'features', 'x', 'controllers'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'features', 'x', 'pages'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'features', 'x', 'controllers', 'XController.tsx'),
    `import { XPage } from '../pages/XPage';\nexport function XController(){ return <XPage/>; }`,
  );
  fs.writeFileSync(path.join(dir, 'features', 'x', 'pages', 'XPage.tsx'), `export function XPage(){ return <div/>; }`);
  const res = validateArchitecture(dir);
  assert.equal(res.violations.some((v) => v.rule === 'IMPORT-001'), false);
});

test('validateArchitecture never flags an external/bare import specifier', () => {
  const dir = tmpProject();
  fs.mkdirSync(path.join(dir, 'features', 'x', 'domain'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'features', 'x', 'domain', 'D.ts'), `import { z } from 'zod';\nexport function f(){ return typeof z; }`);
  const res = validateArchitecture(dir);
  assert.equal(res.violations.some((v) => v.rule === 'IMPORT-001'), false);
});

test('validateArchitecture resolves a dangling import outside the project root the same way', () => {
  const dir = tmpProject();
  fs.mkdirSync(path.join(dir, 'features', 'x', 'controllers'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'features', 'x', 'controllers', 'XController.tsx'),
    `import { Outside } from '../../../../elsewhere/Outside';\nexport function XController(){ return <Outside/>; }`,
  );
  const res = validateArchitecture(dir);
  assert.equal(res.violations.some((v) => v.rule === 'IMPORT-001'), true);
});

// ---- fixtures -------------------------------------------------------------

test('architecture-valid fixture produces zero error-severity violations', () => {
  const res = validateArchitecture(path.join(REPO_ROOT, 'fixtures', 'architecture-valid'));
  const errors = res.violations.filter((v) => v.severity === 'error');
  assert.deepEqual(errors, []);
});

// #68 — a real, non-Next.js react-spa fixture (project.framework: react-spa,
// route layer = src/App.tsx per #65/#66/#67's real convention, not a stub)
// validated the same way the nextjs fixture above is: proof the whole
// pipeline (framework option -> route layer classification -> controller
// convention) actually works end to end, not just the individual unit
// tests #65-#67 already added in isolation.
test('architecture-valid-react-spa fixture produces zero error-severity violations', () => {
  const root = path.join(REPO_ROOT, 'fixtures', 'architecture-valid-react-spa');
  const res = validateArchitecture(root);
  const errors = res.violations.filter((v) => v.severity === 'error');
  assert.deepEqual(errors, []);
});

test('architecture-valid-react-spa fixture classifies src/App.tsx as the route layer and features/widget/controllers/WidgetController.tsx as the controller layer', () => {
  const root = path.join(REPO_ROOT, 'fixtures', 'architecture-valid-react-spa');
  const graph = loadLayerGraph(root);
  assert.equal(graph.route.pattern, 'src/App.tsx');
  assert.equal(classifyFile('src/App.tsx', graph), 'route');
  assert.equal(classifyFile('features/widget/controllers/WidgetController.tsx', graph), 'controller');
  // The nextjs-only route pattern must not accidentally also match this file.
  assert.notEqual(classifyFile('src/App.tsx', CANONICAL_LAYERS), 'route');
});

// #82 — a second react-spa fixture with more than one route (the fixture
// above only ever had /dashboard), proving the same zero-error bar holds
// with several routes/features sharing one project, not just a single one.
test('architecture-valid-react-spa-multi-route fixture produces zero error-severity violations', () => {
  const root = path.join(REPO_ROOT, 'fixtures', 'architecture-valid-react-spa-multi-route');
  const res = validateArchitecture(root);
  const errors = res.violations.filter((v) => v.severity === 'error');
  assert.deepEqual(errors, []);
});

test('architecture-valid-react-spa-multi-route fixture classifies each of its 3 routed controllers correctly', () => {
  const root = path.join(REPO_ROOT, 'fixtures', 'architecture-valid-react-spa-multi-route');
  const graph = loadLayerGraph(root);
  assert.equal(classifyFile('src/App.tsx', graph), 'route');
  for (const file of [
    'features/dashboard/controllers/DashboardController.tsx',
    'features/settings/controllers/SettingsController.tsx',
    'features/user/controllers/UserController.tsx',
  ]) {
    assert.equal(classifyFile(file, graph), 'controller');
  }
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
