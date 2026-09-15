import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSeparationOfConcerns, isPublicPath, countPrimaryExports, parseIndexExports } from '../src/soc-enforcer.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesRoot = path.join(__dirname, '..', 'fixtures');

function tmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'construct-soc-'));
}

function writeFile(root, relPath, contents) {
  const full = path.join(root, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents);
}

function scaffoldFeature(root, name) {
  for (const dir of ['controllers', 'workflows', 'hooks', 'domain', 'services', 'pages', 'components']) {
    fs.mkdirSync(path.join(root, 'features', name, dir), { recursive: true });
  }
  writeFile(root, `features/${name}/index.ts`, `// Public API for feature: ${name}\n`);
  writeFile(root, `features/${name}/types.ts`, `export type ${name}Id = string;\n`);
}

// ---------------------------------------------------------------------------
// countPrimaryExports — tricky syntax unit tests (Epic 2.4)
// ---------------------------------------------------------------------------
test('countPrimaryExports: arrow function assigned to export const', () => {
  const r = countPrimaryExports(`export const handler = (req, res) => {\n  return res;\n};\n`);
  assert.deepEqual(r.map((e) => e.name), ['handler']);
});

test('countPrimaryExports: export default function (named and anonymous)', () => {
  assert.deepEqual(countPrimaryExports(`export default function Widget() { return 1; }`).map((e) => e.name), ['Widget']);
  assert.deepEqual(countPrimaryExports(`export default function () { return 1; }`).map((e) => e.name), ['default']);
});

test('countPrimaryExports: export default class and default expression', () => {
  assert.deepEqual(countPrimaryExports(`export default class Foo {}`).map((e) => e.name), ['Foo']);
  assert.deepEqual(countPrimaryExports(`const x = 1;\nexport default x;`).map((e) => e.name), ['default']);
});

test('countPrimaryExports: export * from does not count', () => {
  assert.deepEqual(countPrimaryExports(`export * from './x';\nexport * from './y';`), []);
});

test('countPrimaryExports: named re-export with from does not count', () => {
  assert.deepEqual(countPrimaryExports(`export { a, b } from './x';`), []);
});

test('countPrimaryExports: multiple exports on one line (comma-separated const)', () => {
  const r = countPrimaryExports(`export const a = 1, b = 2, c = 3;`);
  assert.deepEqual(r.map((e) => e.name).sort(), ['a', 'b', 'c']);
});

test('countPrimaryExports: multiple export statements on one physical line', () => {
  const r = countPrimaryExports(`export function a(){} export function b(){}`);
  assert.deepEqual(r.map((e) => e.name), ['a', 'b']);
});

test('countPrimaryExports: bare named export list (no from) counts locally declared exports', () => {
  const r = countPrimaryExports(`const a = 1;\nconst b = 2;\nexport { a, b as renamed };`);
  assert.deepEqual(r.map((e) => e.name).sort(), ['a', 'renamed']);
});

// ---------------------------------------------------------------------------
// isPublicPath
// ---------------------------------------------------------------------------
test('isPublicPath: a controller re-exported via export * is public', () => {
  assert.equal(isPublicPath(path.join(fixturesRoot, 'soc-clean'), 'features/alpha/controllers/AlphaController.tsx'), true);
});

test('isPublicPath: a service never exported is private', () => {
  assert.equal(isPublicPath(path.join(fixturesRoot, 'soc-clean'), 'features/alpha/services/alphaService.ts'), false);
});

test('isPublicPath: index.ts itself is always public', () => {
  assert.equal(isPublicPath(path.join(fixturesRoot, 'soc-clean'), 'features/alpha/index.ts'), true);
});

test('isPublicPath: a path outside the features root is not applicable (true)', () => {
  assert.equal(isPublicPath(path.join(fixturesRoot, 'soc-clean'), 'app/page.tsx'), true);
});

test('isPublicPath: a named (non-wildcard) export matches only its own file, not siblings', () => {
  const d = tmpProject();
  scaffoldFeature(d, 'alpha');
  writeFile(d, 'features/alpha/index.ts', `export { foo } from './domain/foo';\n`);
  writeFile(d, 'features/alpha/domain/foo.ts', `export function foo() {}\n`);
  writeFile(d, 'features/alpha/domain/bar.ts', `export function bar() {}\n`);
  assert.equal(isPublicPath(d, 'features/alpha/domain/foo.ts'), true);
  assert.equal(isPublicPath(d, 'features/alpha/domain/bar.ts'), false);
});

test('isPublicPath: a directory-level export * covers every file underneath it', () => {
  const d = tmpProject();
  scaffoldFeature(d, 'alpha');
  writeFile(d, 'features/alpha/index.ts', `export * from './controllers';\n`);
  writeFile(d, 'features/alpha/controllers/Foo.ts', `export function Foo() {}\n`);
  assert.equal(isPublicPath(d, 'features/alpha/controllers/Foo.ts'), true);
});

// ---------------------------------------------------------------------------
// parseIndexExports
// ---------------------------------------------------------------------------
test('parseIndexExports finds wildcard and named-from exports with line numbers', () => {
  const src = `// header\nexport type * from './types';\nexport * from './controllers/Foo';\nexport { bar } from './domain/bar';\n`;
  const entries = parseIndexExports(src);
  assert.equal(entries.length, 3);
  assert.equal(entries[0].specifier, './types');
  assert.equal(entries[0].isType, true);
  assert.equal(entries[1].isWildcard, true);
  assert.equal(entries[2].line, 4);
});

// ---------------------------------------------------------------------------
// Full-fixture tests (Epic 2.4)
// ---------------------------------------------------------------------------
test('fixture soc-clean: no violations', () => {
  const r = validateSeparationOfConcerns(path.join(fixturesRoot, 'soc-clean'));
  assert.deepEqual(r.violations, []);
});

test('fixture soc-cross-feature: exactly one SLICE-002 violation fires', () => {
  const r = validateSeparationOfConcerns(path.join(fixturesRoot, 'soc-cross-feature'));
  assert.equal(r.violations.length, 1);
  assert.equal(r.violations[0].rule, 'SLICE-002');
  assert.equal(r.violations[0].file, 'features/beta/controllers/BetaController.tsx');
  assert.equal(r.violations[0].module, 'separation-of-concerns');
});

test('fixture soc-god-file: exactly one MODULE-001 violation fires', () => {
  const r = validateSeparationOfConcerns(path.join(fixturesRoot, 'soc-god-file'));
  assert.equal(r.violations.length, 1);
  assert.equal(r.violations[0].rule, 'MODULE-001');
  assert.equal(r.violations[0].file, 'features/alpha/domain/godFile.ts');
  assert.match(r.violations[0].message, /5 primary exports/);
});

// ---------------------------------------------------------------------------
// SLICE-001 — feature-root/skeleton existence
// ---------------------------------------------------------------------------
test('SLICE-001: missing features root is reported with a create-feature suggestion', () => {
  const d = tmpProject();
  const r = validateSeparationOfConcerns(d);
  assert.equal(r.violations.length, 1);
  assert.equal(r.violations[0].rule, 'SLICE-001');
  assert.match(r.violations[0].suggestedFix, /construct feature create/);
});

test('SLICE-001: a feature missing subfolders names them and suggests the exact fix command', () => {
  const d = tmpProject();
  fs.mkdirSync(path.join(d, 'features', 'gamma', 'controllers'), { recursive: true });
  writeFile(d, 'features/gamma/index.ts', '// Public API for feature: gamma\n');
  const r = validateSeparationOfConcerns(d);
  const v = r.violations.find((v) => v.rule === 'SLICE-001');
  assert.ok(v, 'expected a SLICE-001 violation');
  assert.match(v.message, /workflows/);
  assert.equal(v.suggestedFix, 'Run: construct feature create gamma');
});

// ---------------------------------------------------------------------------
// SOC-001 — ownership check
// ---------------------------------------------------------------------------
test('SOC-001: a stray file directly in the feature root is flagged', () => {
  const d = tmpProject();
  scaffoldFeature(d, 'alpha');
  writeFile(d, 'features/alpha/utils.ts', 'export function helper() {}\n');
  const r = validateSeparationOfConcerns(d);
  const v = r.violations.find((v) => v.rule === 'SOC-001');
  assert.ok(v);
  assert.equal(v.file, 'features/alpha/utils.ts');
});

test('SOC-001: a file under an unrecognized folder is flagged, shared/ is allowed', () => {
  const d = tmpProject();
  scaffoldFeature(d, 'alpha');
  writeFile(d, 'features/alpha/utilities/helper.ts', 'export function helper() {}\n');
  writeFile(d, 'features/alpha/shared/constants.ts', 'export const X = 1;\n');
  const r = validateSeparationOfConcerns(d);
  const socViolations = r.violations.filter((v) => v.rule === 'SOC-001');
  assert.equal(socViolations.length, 1);
  assert.equal(socViolations[0].file, 'features/alpha/utilities/helper.ts');
});

// ---------------------------------------------------------------------------
// DRY-001 — duplication heuristic (warning-level)
// ---------------------------------------------------------------------------
test('DRY-001: near-identical function bodies across two features are flagged as a warning', () => {
  const d = tmpProject();
  scaffoldFeature(d, 'alpha');
  scaffoldFeature(d, 'beta');
  const body = `export function computeShippingCost(order) {\n  const base = order.weight * 1.5 + order.distance * 0.2;\n  const surcharge = order.express ? base * 0.35 : 0;\n  return base + surcharge + order.handlingFee;\n}\n`;
  writeFile(d, 'features/alpha/domain/shipping.ts', body);
  writeFile(d, 'features/beta/domain/shipping.ts', body.replace(/order/g, 'shipment'));
  const r = validateSeparationOfConcerns(d);
  const dry = r.violations.filter((v) => v.rule === 'DRY-001');
  assert.equal(dry.length, 1);
  assert.equal(dry[0].severity, 'warning');
  assert.match(dry[0].suggestedFix, /shared/);
});

test('DRY-001: similar functions within the SAME feature are not flagged', () => {
  const d = tmpProject();
  scaffoldFeature(d, 'alpha');
  const body = `export function computeShippingCost(order) {\n  const base = order.weight * 1.5 + order.distance * 0.2;\n  const surcharge = order.express ? base * 0.35 : 0;\n  return base + surcharge + order.handlingFee;\n}\n`;
  writeFile(d, 'features/alpha/domain/shippingA.ts', body);
  writeFile(d, 'features/alpha/domain/shippingB.ts', body);
  const r = validateSeparationOfConcerns(d);
  assert.equal(r.violations.filter((v) => v.rule === 'DRY-001').length, 0);
});

// ---------------------------------------------------------------------------
// MODULE-001 threshold is configurable via architecture.yml
// ---------------------------------------------------------------------------
test('MODULE-001: threshold is configurable via architecture.yml (nested rules.MODULE-001.threshold)', () => {
  const d = tmpProject();
  scaffoldFeature(d, 'alpha');
  writeFile(d, 'features/alpha/domain/ops.ts', `export function a(){}\nexport function b(){}\nexport function c(){}\nexport function d(){}\n`);
  writeFile(d, 'architecture.yml', 'rules:\n  MODULE-001:\n    threshold: 5\n');
  const r = validateSeparationOfConcerns(d);
  assert.equal(r.violations.filter((v) => v.rule === 'MODULE-001').length, 0);
});
