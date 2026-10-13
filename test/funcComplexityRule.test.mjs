// #923 -- FUNC-001: a per-function complexity budget per layer. Cyclomatic from ESLint's `complexity` rule (always),
// cognitive from fallow's results (only when given). On by default as a warning; budgets overridable per layer in
// architecture.yml; generated code stays under the defaults.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DEFAULT_RULES, normalizeRules } from '../packages/core/config.mjs';
import { detectLayerViolations, validateArchitecture, layerViolationOptsFor, functionBudgetFor, DEFAULT_FUNCTION_BUDGETS } from '../packages/core/architecture-enforcer.mjs';
import { RULE_METADATA } from '../packages/core/rules-catalog.mjs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(REPO, 'packages/cli/construct.mjs');

// ESLint complexity 1 + 11 ifs = 12; nesting 1.
const BRANCHY = `export function grade(a: number): string {\n${Array.from({ length: 11 }, (_, i) => `  if (a === ${i}) return "${i}";`).join('\n')}\n  return "none";\n}\n`;
// ESLint complexity 1 + 3 ifs = 4, but deeply nested (fallow would score it cognitive 1 + 2 + 3 = 6).
const NESTED = 'export function pick(a: number): number {\n  if (a > 1) { if (a > 2) { if (a > 3) { return 3; } } }\n  return 0;\n}\n';
const SMALL = 'export function add(a: number, b: number): number {\n  return a > 0 ? a + b : b;\n}\n';

const func001 = (layer, source, budget, fallowFunctions) => detectLayerViolations(layer, source, { functionBudget: budget, fallowFunctions }).filter((v) => v.rule === 'FUNC-001');

test('FUNC-001 is registered on by default as a warning, with a catalog entry and per-layer budgets', () => {
  assert.equal(DEFAULT_RULES['FUNC-001'].severity, 'warning');
  assert.ok(RULE_METADATA['FUNC-001'].layers.includes('domain'));
  assert.deepEqual(DEFAULT_FUNCTION_BUDGETS.service, { cyclomatic: 10, cognitive: 10 });
  assert.deepEqual(DEFAULT_FUNCTION_BUDGETS.domain, { cyclomatic: 15, cognitive: 15 }, 'a generated store reducer (one case per action) fits');
  assert.deepEqual(DEFAULT_FUNCTION_BUDGETS.component, { cyclomatic: 20, cognitive: 15 }, 'the 40 Line primitives fit');
});

test('FUNC-001: names the function, its line and its ESLint cyclomatic against the layer budget', () => {
  const v = func001('service', BRANCHY, functionBudgetFor('service'));
  assert.deepEqual(v.map((x) => [x.line, x.message, x.expected[0]]), [[1, 'Function "grade" is over the service budget (cyclomatic 12/10, nesting 1).', 'cyclomatic <= 10 per function']]);
  assert.deepEqual(func001('service', SMALL, functionBudgetFor('service')), []);
  assert.deepEqual(func001('domain', BRANCHY, functionBudgetFor('domain')), [], 'within the domain budget');
  assert.deepEqual(func001('service', BRANCHY, null), [], 'no budget (rule off) means no check');
});

test('FUNC-001: cognitive is checked only from fallow\'s results, matched by start line', () => {
  const budget = functionBudgetFor('service', { service: { cognitive: 5 } });
  assert.deepEqual(func001('service', NESTED, budget), [], 'without fallow there is no cognitive number, and cyclomatic 4 is within budget');
  const v = func001('service', NESTED, budget, [{ line: 1, name: 'pick', cognitive: 6, cyclomatic: 4 }]);
  assert.deepEqual(v.map((x) => [x.message, x.expected[0]]), [['Function "pick" is over the service budget (cyclomatic 4/10, cognitive 6/5, nesting 3).', 'cyclomatic <= 10 and cognitive <= 5 per function']]);
});

test('FUNC-001: a handler inside a component is measured on its own body', () => {
  const src = [
    'export function Row({ x, onPick }: { x: number; onPick: (n: number) => void }) {',
    '  const handle = () => { if (x > 1 && x < 9) { if (x > 2 || x === 0) { onPick(x ?? 0); } } };',
    '  return <button onClick={handle}>{x}</button>;',
    '}',
    '',
  ].join('\n');
  assert.deepEqual(func001('component', src, functionBudgetFor('component')), [], 'within the default');
  const v = func001('component', src, functionBudgetFor('component', { component: { cyclomatic: 5 } }));
  assert.deepEqual(v.map((x) => [x.line, x.message]), [[2, 'Function "handle" is over the component budget (cyclomatic 6/5, nesting 2).']]);
});

test('FUNC-001 budgets: architecture.yml fields override the default per layer; off turns the check off', () => {
  assert.deepEqual(functionBudgetFor('domain', { domain: { cognitive: 30 } }), { cyclomatic: 15, cognitive: 30 });
  assert.equal(functionBudgetFor('my-custom-layer'), null, 'a layer with no budget is not checked');
  assert.deepEqual(functionBudgetFor('my-custom-layer', { 'my-custom-layer': { cyclomatic: 3 } }), { cyclomatic: 3, cognitive: Infinity });
  const rules = normalizeRules({ 'FUNC-001': { severity: 'warning', budgets: { domain: { cyclomatic: 20, cognitive: 20 } } } });
  assert.deepEqual(layerViolationOptsFor({ rules }, 'domain').functionBudget, { cyclomatic: 20, cognitive: 20 });
  assert.deepEqual(layerViolationOptsFor({ rules: DEFAULT_RULES }, 'hook').functionBudget, { cyclomatic: 10, cognitive: 10 });
  assert.equal(layerViolationOptsFor({ rules: normalizeRules({ 'FUNC-001': 'off' }) }, 'domain').functionBudget, null);
});

function project(yml, source = BRANCHY) {
  const root = makeTempDir('func001-');
  fs.mkdirSync(path.join(root, 'features/grades/services'), { recursive: true });
  fs.writeFileSync(path.join(root, 'features/grades/services/grade.ts'), source);
  if (yml) fs.writeFileSync(path.join(root, 'architecture.yml'), yml);
  return root;
}
const hits = (root, opts = {}) => validateArchitecture(root, { files: ['features/grades/services/grade.ts'], ...opts }).violations.filter((v) => v.rule === 'FUNC-001');

test('FUNC-001 through validateArchitecture: a warning by default, silenced or re-budgeted from architecture.yml', () => {
  const byDefault = hits(project());
  assert.equal(byDefault.length, 1);
  assert.equal(byDefault[0].severity, 'warning');
  assert.deepEqual(hits(project('version: 1\nrules:\n  FUNC-001: off\n')), []);
  assert.deepEqual(hits(project('version: 1\nrules:\n  FUNC-001:\n    severity: warning\n    budgets:\n      service:\n        cyclomatic: 12\n')), []);
  assert.equal(hits(project('version: 1\nrules:\n  FUNC-001: error\n'))[0].severity, 'error');
});

test('FUNC-001 through validateArchitecture: a fallow health report adds the cognitive check (absolute or relative paths)', () => {
  const root = project(null, NESTED);
  assert.deepEqual(hits(root), []);
  const report = { functions: [{ path: path.join(root, 'features/grades/services/grade.ts'), name: 'pick', line: 1, cognitive: 11 }] };
  assert.match(hits(root, { fallowHealth: report })[0].message, /cognitive 11\/10/);
  assert.equal(hits(root, { fallowHealth: { functions: [{ file: 'features/grades/services/grade.ts', line: 1, cognitive: 11 }] } }).length, 1);
});

test('FUNC-001: the construct init scaffold (both frameworks, with generated layers) and the bench starter raise none', () => {
  for (const framework of ['nextjs', 'react-spa']) {
    const root = makeTempDir(`func001-init-${framework}-`);
    assert.equal(spawnSync(process.execPath, [CLI, 'init', root, '--framework', framework], { encoding: 'utf8' }).status, 0);
    const gen = spawnSync(process.execPath, [CLI, 'generate', 'layer', 'core', '--feature', 'core', '--layers', 'domain,service,workflow,hook,component,page,controller'], { cwd: root, encoding: 'utf8' });
    assert.equal(gen.status, 0, gen.stderr);
    assert.deepEqual(validateArchitecture(root).violations.filter((v) => v.rule === 'FUNC-001'), [], framework);
  }
  assert.deepEqual(validateArchitecture(path.join(REPO, 'bench/ecommerce/starter')).violations.filter((v) => v.rule === 'FUNC-001'), []);
});

test('FUNC-001: every construct store slice validates under the default budgets (the list reducer is the most complex)', async () => {
  const { storeFiles, STORE_SHAPES } = await import('../packages/core/store.mjs');
  for (const shape of STORE_SHAPES) {
    for (const f of storeFiles('/x', { name: 'Cart', feature: 'shop', shape, fields: 'id:string,name:string,done:boolean' })) {
      const layer = f.path.includes('/domain/') ? 'domain' : f.path.includes('/hooks/') ? 'hook' : null;
      if (layer) assert.deepEqual(func001(layer, f.content, functionBudgetFor(layer)), [], `${shape} ${path.basename(f.path)}`);
    }
  }
});
