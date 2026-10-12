// Line logic verification step 7 (wiring): verifyImport's `logic` check, a UnitVerdict per function unit of the
// import folder against the import baseline (logicVerify/importUnits.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { logicCheck, functionUnits, folderCodeFiles, IMPORT_BASELINE_FILE } from '../packages/engine/line/logicVerify/importUnits.mjs';
import { assertUnitVerdict, assertStepSummary } from '../packages/engine/line/logicVerify/contract.mjs';

const AGE = 'export function isAdult(age: number) {\n  if (age >= 18) return true;\n  return false;\n}\n';
const LABEL = "export function label(n: number) {\n  return n > 1 ? `${n} items` : 'one item';\n}\n";

/** A project whose folder src/alerts had two files before the import; `after` writes the folder now. */
function project(after) {
  const root = makeTempDir('construct-lv-import-');
  const sources = { 'src/alerts/age.ts': AGE, 'src/alerts/label.ts': LABEL };
  for (const [rel, text] of Object.entries(after)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  fs.mkdirSync(path.join(root, 'src/alerts/line'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/alerts', IMPORT_BASELINE_FILE), JSON.stringify({ sources, unresolved: [] }));
  return root;
}

test('the folder units: one per function with logic, no Line state, tests or generated tests', (t) => {
  const root = project({ 'src/alerts/domain/age.ts': AGE, 'src/alerts/label.ts': LABEL, 'src/alerts/label.test.ts': LABEL, 'src/alerts/__line_characterization__/x.ts': AGE });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(folderCodeFiles(root, 'src/alerts'), ['src/alerts/domain/age.ts', 'src/alerts/label.ts']);
  assert.deepEqual(functionUnits(root, folderCodeFiles(root, 'src/alerts')).map((u) => `${u.file}#${u.fn}`), ['src/alerts/domain/age.ts#isAdult', 'src/alerts/label.ts#label']);
});

test('a moved, unchanged unit passes with a verdict; every verdict and the summary meet the contract', async (t) => {
  const root = project({ 'src/alerts/domain/age.ts': AGE, 'src/alerts/label.ts': LABEL });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const c = await logicCheck(root, 'src/alerts');
  assert.equal(c.id, 'logic');
  assert.equal(c.state, 'pass', c.detail);
  assert.equal(c.units?.length, 2);
  for (const v of c.units ?? []) assertUnitVerdict(v);
  assertStepSummary(c.summary);
  // nobody says how the import edited a unit (transforms null), so a same result is "tested", never "proven"
  assert.ok(c.units?.every((v) => v.status === 'tested'), c.detail);
  assert.match(c.sentence, /^Logic verification: 0 proven, 2 tested, 0 unverified\.$/);
  assert.match(String(c.detail), /tested src\/alerts\/domain\/age\.ts#isAdult \(L0-canonical\)/);
});

test('a flipped condition fails the check and names the exact location', async (t) => {
  const root = project({ 'src/alerts/age.ts': AGE.replace('>=', '>'), 'src/alerts/label.ts': LABEL });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const c = await logicCheck(root, 'src/alerts');
  assert.equal(c.state, 'fail');
  const changed = c.units?.find((v) => v.status === 'changed');
  assert.equal(changed?.unit.fn, 'isAdult');
  assert.equal(changed?.location?.file, 'src/alerts/age.ts');
  assert.equal(changed?.location?.line, 2);
  assert.equal(c.summary?.divergences.length, 1);
  assert.match(String(c.detail).split('\n')[0], /^changed src\/alerts\/age\.ts#isAdult/);
});

test('a folder with no import baseline is skipped, said in one sentence', async (t) => {
  const root = makeTempDir('construct-lv-import-');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'src/alerts'), { recursive: true });
  const c = await logicCheck(root, 'src/alerts');
  assert.equal(c.state, 'skipped');
  assert.match(c.sentence, /has no import baseline/);
});

/** The import agent's plan with one done step that moved age.ts whole into the library. */
function planMove(root) {
  const step = { id: 's1', tool: 'line.import.toLibrary', args: { from: 'age.ts', kind: 'domains', name: 'age' }, run: 'done', planStepIds: [] };
  fs.writeFileSync(path.join(root, 'src/alerts/line/import-plan.json'), JSON.stringify({ folder: 'src/alerts', steps: [step] }));
}

test('#857 a pure unit the import only moved comes back proven; the untouched one stays tested', async (t) => {
  const root = project({ 'src/alerts/library/domains/age.ts': AGE, 'src/alerts/label.ts': LABEL });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  planMove(root);
  const c = await logicCheck(root, 'src/alerts');
  assert.equal(c.state, 'pass', c.detail);
  for (const v of c.units ?? []) assertUnitVerdict(v);
  const age = c.units?.find((v) => v.unit.fn === 'isAdult');
  assert.equal(age?.status, 'proven', c.detail);
  assert.deepEqual(age?.transforms, ['move', 'repoint-imports']);
  assert.equal(c.units?.find((v) => v.unit.fn === 'label')?.status, 'tested');
  assert.match(c.sentence, /^Logic verification: 1 proven, 1 tested, 0 unverified\.$/);
});

test('#857 a moved unit whose logic changed still fails with its location', async (t) => {
  const root = project({ 'src/alerts/library/domains/age.ts': AGE.replace('>=', '>'), 'src/alerts/label.ts': LABEL });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  planMove(root);
  const c = await logicCheck(root, 'src/alerts');
  assert.equal(c.state, 'fail', c.detail);
  const changed = c.units?.find((v) => v.status === 'changed');
  assert.equal(changed?.unit.fn, 'isAdult');
  assert.equal(changed?.location?.file, 'src/alerts/library/domains/age.ts');
  assert.equal(changed?.location?.line, 2);
});
