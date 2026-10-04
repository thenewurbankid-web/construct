// TYPE-002 (LIN-148 ask #2): an exported function's parameter or return value with no type
// annotation (an implicit any) at a unit's boundary. Off by default, layer-agnostic, opt-in
// like DOMAIN-002/WORKFLOW-004/STATE-001/SERVICE-003.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_RULES } from '../packages/core/config.mjs';
import { detectLayerViolations, validateArchitecture } from '../packages/core/architecture-enforcer.mjs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';

const UNTYPED_PARAM = 'export function greet(name): string {\n  return `hi ${name}`;\n}\n';
const UNTYPED_RETURN = 'export function greet(name: string) {\n  return `hi ${name}`;\n}\n';
const FULLY_TYPED = 'export function greet(name: string): string {\n  return `hi ${name}`;\n}\n';
const ARROW_EXPORT_UNTYPED = 'export const greet = (name) => `hi ${name}`;\n';
const DEFAULT_EXPORT_UNTYPED = 'export default function greet(name) {\n  return `hi ${name}`;\n}\n';
const INTERNAL_HELPER_UNTYPED = 'function helper(name) {\n  return name;\n}\n\nexport function greet(name: string): string {\n  return helper(name);\n}\n';

const ruleIds = (source) => detectLayerViolations('domain', source).map((v) => v.rule);
const on002 = (source) => detectLayerViolations('domain', source, { exportedTypeAnnotations: true }).filter((v) => v.rule === 'TYPE-002');

test('TYPE-002 is registered off by default and reports nothing unless opted in', () => {
  assert.equal(DEFAULT_RULES['TYPE-002'].severity, 'off');
  assert.deepEqual(ruleIds(UNTYPED_PARAM), []);
});

test('TYPE-002: fires once for an untyped exported param, naming the param', () => {
  const v = on002(UNTYPED_PARAM);
  assert.equal(v.length, 1);
  assert.equal(v[0].line, 1);
  assert.match(v[0].message, /"name"/);
  assert.equal(v[0].expected[0], 'an explicit type on every exported parameter and return value');
});

test('TYPE-002: fires once for a typed param but untyped return', () => {
  const v = on002(UNTYPED_RETURN);
  assert.equal(v.length, 1);
  assert.match(v[0].message, /return value/);
});

test('TYPE-002: silent when both the param and the return are typed', () => {
  assert.deepEqual(on002(FULLY_TYPED), []);
});

test('TYPE-002: also checks an exported const bound to an arrow function', () => {
  const v = on002(ARROW_EXPORT_UNTYPED);
  assert.equal(v.length, 2); // untyped param + no return type
  assert.deepEqual(v.map((x) => x.kind ?? x.message).some((m) => /"name"/.test(m)), true);
});

test('TYPE-002: also checks a default export', () => {
  const v = on002(DEFAULT_EXPORT_UNTYPED);
  assert.equal(v.length, 2);
});

test('TYPE-002: never reports an internal (non-exported) helper, only the exported boundary', () => {
  assert.deepEqual(on002(INTERNAL_HELPER_UNTYPED), []);
});

test('TYPE-002: validateArchitecture has the same violation shape as other rules and honours the architecture.yml opt-in', () => {
  const dir = makeTempDir('construct-type002-');
  const yml = (rules) => `version: 1\npreset: strict-nextjs\nfeatures:\n  root: features\n${rules}`;
  fs.writeFileSync(path.join(dir, 'architecture.yml'), yml(''));
  fs.mkdirSync(path.join(dir, 'features/shop/domain'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'features/shop/domain/greet.ts'), UNTYPED_PARAM);
  const all = () => validateArchitecture(dir).violations;
  assert.deepEqual(all().filter((v) => v.rule === 'TYPE-002'), []);
  fs.writeFileSync(path.join(dir, 'architecture.yml'), yml('rules:\n  TYPE-002: warning\n'));
  const found = all().filter((v) => v.rule === 'TYPE-002');
  assert.equal(found.length, 1);
  const [v] = found;
  assert.equal(v.severity, 'warning');
  assert.equal(v.file, 'features/shop/domain/greet.ts');
  assert.deepEqual(Object.keys(v).sort(), ['docsUrl', 'expected', 'file', 'line', 'message', 'module', 'rule', 'severity', 'suggestedFix', 'why']);
});
