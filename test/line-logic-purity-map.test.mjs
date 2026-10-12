// #861 (Line logic verification spec step 2): the purity class feeds the logic map and G1's unit nodes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildLogicMap } from '../packages/engine/line/logicMap.mjs';
import { classifyFile } from '../packages/engine/line/logicVerify/purity.mjs';
import { assertLineGraph } from '../packages/engine/line/graph/contract.mjs';
import { buildLineGraph } from '../packages/engine/line/graph/build.mjs';

const SRC = [
  'export function isAdult(age: number) {\n  if (age >= 18) return true;\n  return false;\n}\n',
  "export async function load(id: string) {\n  if (!id) return null;\n  const r = await fetch('/api/x/' + id);\n  return r.json();\n}\n",
].join('');

test('#861 the logic map carries each function unit\'s purity class and effects when given the classifier', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-lv-purity-map-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'a.ts'), SRC);
  const plain = buildLogicMap(root, ['a.ts']);
  assert.ok(plain.units.every((u) => !('purity' in u)), 'off by default');
  const m = buildLogicMap(root, ['a.ts'], { classify: classifyFile });
  const of = (fn) => m.units.filter((u) => u.fn === fn);
  assert.ok(of('isAdult').length && of('isAdult').every((u) => u.purity === 'pure' && u.effects.length === 0));
  assert.ok(of('load').length && of('load').every((u) => u.purity === 'impure' && u.effects.includes('fetch')));
  assert.deepEqual(m.units.map((u) => u.fingerprint), plain.units.map((u) => u.fingerprint), 'fingerprints unchanged');
  assert.equal(classifyFile(SRC, 'a.ts'), classifyFile(SRC, 'a.ts'), 'cached by content');
});

test('#861 G1 unit nodes carry purity and effects and still meet the graph contract', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-lv-purity-g1-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.cpSync(path.resolve(import.meta.dirname, '../examples/line-sample'), root, { recursive: true, filter: (s) => !/node_modules|\/line\/graph/.test(s) });
  const { graph } = buildLineGraph(root, { write: false });
  assertLineGraph(graph);
  const units = graph.nodes.filter((n) => n.kind === 'unit');
  assert.ok(units.length > 0);
  assert.ok(units.some((n) => n.attrs?.purity === 'pure' || n.attrs?.purity === 'impure'), 'some unit is classified');
  for (const n of units.filter((x) => x.attrs?.purity)) assert.ok(Array.isArray(n.attrs?.effects));
});
