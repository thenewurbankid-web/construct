// Epic #185 / #190 -- WORKFLOW-002 (unreachable state) and WORKFLOW-003
// (non-final state with no way out): default WARNINGS reusing the narrator's findings.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_RULES } from '../src/config.mjs';
import { detectLayerViolations, validateArchitecture } from '../src/architecture-enforcer.mjs';
import { compileWorkflow } from '../packages/engine/workflowGenerator.mjs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'workflow-graphs');
const wf = (states) => `import { createMachine } from 'xstate';\nexport const m = createMachine({ initial: 'a', states: ${states} });\n`;
const ruleIds = (source) => detectLayerViolations('workflow', source).map((v) => v.rule);

test('rules are registered as default WARNINGS beside WORKFLOW-001', () => {
  assert.equal(DEFAULT_RULES['WORKFLOW-001'].severity, 'error');
  assert.equal(DEFAULT_RULES['WORKFLOW-002'].severity, 'warning');
  assert.equal(DEFAULT_RULES['WORKFLOW-003'].severity, 'warning');
});

test('unreachable state -> WORKFLOW-002 on the state line; dead end -> WORKFLOW-003', () => {
  const src = wf(`{
    a: { on: { GO: 'b' } },
    b: { type: 'final' },
    orphan: { on: { X: 'b' } },
  }`);
  const v = detectLayerViolations('workflow', src);
  assert.deepEqual(v.map((x) => x.rule), ['WORKFLOW-002']);
  assert.equal(v[0].line, 5);
  assert.match(v[0].message, /"orphan" can never be reached/);
  assert.deepEqual(ruleIds(wf(`{ a: { on: { GO: 'b' } }, b: {} }`)), ['WORKFLOW-003']);
});

test('healthy machines, unreadable machines and non-workflow layers are not flagged', () => {
  assert.deepEqual(ruleIds(wf(`{ a: { on: { GO: 'b' } }, b: { type: 'final' } }`)), []);
  // extractor cannot read it (spread) -> silently skipped, not an error
  assert.deepEqual(ruleIds(`export const m = createMachine({ ...base, initial: 'a', states: { a: {} } });`), []);
  // a file with no machine at all
  assert.deepEqual(ruleIds(`export const x = 1;`), []);
  assert.deepEqual(detectLayerViolations('service', wf(`{ a: {} }`)).filter((v) => v.rule.startsWith('WORKFLOW')), []);
});

test('the scaffolded one-state stub (states: { idle: {} }) is exempt', () => {
  assert.deepEqual(ruleIds(wf(`{ a: {} }`)), []);
});

test('existing fixtures: generated checkout and refund request raise nothing; only the deliberate dead end is flagged', () => {
  const checkout = compileWorkflow(JSON.parse(fs.readFileSync(path.join(fixtures, 'checkout.json'), 'utf8')), { name: 'Checkout' }).source;
  assert.deepEqual(ruleIds(checkout), []);
  assert.deepEqual(ruleIds(fs.readFileSync(path.join(fixtures, 'refund-request.ts'), 'utf8')), []);
  assert.deepEqual(ruleIds(fs.readFileSync(path.join(fixtures, 'mixed-nested.ts'), 'utf8')), ['WORKFLOW-003']);
});

test('construct validate surfaces them as warnings (not errors); severity is configurable; projects without workflows unaffected', () => {
  const dir = makeTempDir('construct-wf-guard-');
  fs.writeFileSync(path.join(dir, 'architecture.yml'), 'version: 1\npreset: strict-nextjs\nfeatures:\n  root: features\n');
  fs.mkdirSync(path.join(dir, 'features/shop/workflows'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'features/plain/domain'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'features/plain/domain/x.ts'), 'export const x = 1;\n');
  fs.writeFileSync(path.join(dir, 'features/shop/workflows/Broken.ts'), wf(`{ a: { on: { GO: 'b' } }, b: {} }`));
  const found = () => validateArchitecture(dir).violations.filter((v) => v.rule.startsWith('WORKFLOW'));
  const [v] = found();
  assert.equal(v.rule, 'WORKFLOW-003');
  assert.equal(v.severity, 'warning');
  assert.equal(v.file, 'features/shop/workflows/Broken.ts');
  assert.equal(found().length, 1);
  fs.writeFileSync(path.join(dir, 'architecture.yml'), 'version: 1\npreset: strict-nextjs\nfeatures:\n  root: features\nrules:\n  WORKFLOW-003: off\n');
  assert.deepEqual(found(), []);
  assert.equal(validateArchitecture(dir).violations.filter((x) => x.file.includes('features/plain')).length, 0);
});
