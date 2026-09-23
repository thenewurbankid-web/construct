// WORKFLOW-004: transition-table completeness (off by default, opt-in like DOMAIN-002).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_RULES } from '../packages/core/config.mjs';
import { detectLayerViolations, validateArchitecture } from '../packages/core/architecture-enforcer.mjs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';

const wf = (states) => `import { createMachine } from 'xstate';\nexport const m = createMachine({ initial: 'a', states: ${states} });\n`;
const HOLEY = wf(`{
    a: { on: { GO: 'b', CANCEL: 'c' } },
    b: { on: { GO: 'c' } },
    c: { type: 'final' },
  }`);
const ruleIds = (source) => detectLayerViolations('workflow', source).map((v) => v.rule);
const on004 = (source) => detectLayerViolations('workflow', source, { workflowTransitionTable: true }).filter((v) => v.rule === 'WORKFLOW-004');

test('WORKFLOW-004 is registered off by default and reports nothing unless opted in', () => {
  assert.equal(DEFAULT_RULES['WORKFLOW-004'].severity, 'off');
  assert.deepEqual(ruleIds(HOLEY), []);
});

test('WORKFLOW-004: one violation per (state, event) hole, at the state line, with the standard fields', () => {
  const v = on004(HOLEY);
  assert.equal(v.length, 1);
  assert.equal(v[0].line, 4);
  assert.match(v[0].message, /"b".*"CANCEL"/);
  assert.equal(v[0].why, 'an event with no decision for this state does nothing, and nobody chose that');
  assert.equal(v[0].suggestedFix, 'add a transition for CANCEL in b, or mark it ignored');
  const two = on004(wf(`{ a: { on: { GO: 'b', X: 'b', Y: 'b' } }, b: { on: { GO: 'c' } }, c: { type: 'final' } }`));
  assert.deepEqual(two.map((x) => x.message.match(/event "(\w+)"/)[1]), ['X', 'Y']);
});

test('WORKFLOW-004: fully handled machine and the explicit ignore form `EVENT: {}` report nothing', () => {
  assert.deepEqual(on004(wf(`{ a: { on: { GO: 'b', CANCEL: 'c' } }, b: { on: { GO: 'c', CANCEL: 'c' } }, c: { type: 'final' } }`)), []);
  assert.deepEqual(on004(wf(`{ a: { on: { GO: 'b', CANCEL: 'c' } }, b: { on: { GO: 'c', CANCEL: {} } }, c: { type: 'final' } }`)), []);
  // an event handled by a parent state is decided for its children
  assert.deepEqual(on004(wf(`{ p: { on: { STOP: 'z' }, initial: 'a', states: { a: { on: { GO: 'b' } }, b: { on: { GO: 'a' } } } }, z: { type: 'final' } }`)), []);
});

test('WORKFLOW-004: validateArchitecture (the source of `--format json`) has the same fields as other rules and honours the architecture.yml opt-in', () => {
  const dir = makeTempDir('construct-wf004-');
  const yml = (rules) => `version: 1\npreset: strict-nextjs\nfeatures:\n  root: features\n${rules}`;
  fs.writeFileSync(path.join(dir, 'architecture.yml'), yml(''));
  fs.mkdirSync(path.join(dir, 'features/shop/workflows'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'features/shop/workflows/Holey.ts'), HOLEY);
  fs.writeFileSync(path.join(dir, 'features/shop/workflows/Dead.ts'), wf(`{ a: { on: {} }, b: {} }`));
  const all = () => validateArchitecture(dir).violations;
  assert.deepEqual(all().filter((v) => v.rule === 'WORKFLOW-004'), []);
  fs.writeFileSync(path.join(dir, 'architecture.yml'), yml('rules:\n  WORKFLOW-004: warning\n'));
  const [v] = all().filter((x) => x.rule === 'WORKFLOW-004');
  const other = all().find((x) => x.rule === 'WORKFLOW-003');
  assert.equal(all().filter((x) => x.rule === 'WORKFLOW-004').length, 1);
  assert.equal(v.severity, 'warning');
  assert.equal(v.file, 'features/shop/workflows/Holey.ts');
  assert.equal(v.suggestedFix, 'add a transition for CANCEL in b, or mark it ignored');
  assert.deepEqual(Object.keys(v).sort(), Object.keys(other).sort());
});
