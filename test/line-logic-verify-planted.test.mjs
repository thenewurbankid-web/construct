// Line logic verification: the planted before/after fixture pairs (test/fixtures/logic-verify/, synthetic snippets) and
// their expected UnitVerdicts. The live tests pin the fixtures to the contract today; each acceptance test is `todo`
// with the build step that turns it on (docs/line/HANDOVER-2026-10-12-import.md "Build order"). A step is done when its
// todo tests pass with `todo` removed. Entry points the later steps provide (see logicVerify/README.md):
//   step 2    logicVerify/purity.mjs      classifyUnit({root, file, fn}) -> {purity, effectChain}
//   step 3-6  logicVerify/verifyPair.mjs  verifyPair({beforeRoot, afterRoot, unit, transforms, levels}) -> Promise<UnitVerdict>
//   step 7    logicVerify/verifyPair.mjs  verifyStep({step, beforeRoot, afterRoot, units}) -> Promise<StepSummary>
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertUnitVerdict, assertLayerResult, assertStepSummary } from '../packages/engine/line/logicVerify/contract.mjs';
import { buildUnitVerdict, verdictSentence, summarizeStep } from '../packages/engine/line/logicVerify/verdict.mjs';
import { decideUnit, layerOrder, nextLayer } from '../packages/engine/line/logicVerify/escalation.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = path.join(ROOT, 'test/fixtures/logic-verify');
const MOD = path.join(ROOT, 'packages/engine/line/logicVerify');
const CASES = JSON.parse(fs.readFileSync(path.join(FIX, 'cases.json'), 'utf8'));
const expected = (name) => JSON.parse(fs.readFileSync(path.join(FIX, name, 'expected.json'), 'utf8'));
const SUMMARY = JSON.parse(fs.readFileSync(path.join(FIX, 'expected-summary.json'), 'utf8'));
const STEP_NAMES = { 2: 'pure/impure split', 3: 'C1 canonicaliser and round-trip', 4: 'isolated execution', 5: 'layout fakes', 6: 'Z3 / fast-check', 7: 'wiring into Import v2 and the step view', 8: 'L2 dev server' };
const todo = (step) => `step ${step}: ${STEP_NAMES[step]}`;
/** The build steps that have landed: their acceptance tests run; the rest stay `todo`. */
const BUILT = new Set([3, 6]);
const todoUnless = (step) => (BUILT.has(step) ? false : todo(step));

/** A later step's module; a todo test fails with one line until the step adds it. */
async function later(file, step) {
  const p = path.join(MOD, file);
  if (!fs.existsSync(p)) throw new Error(`${file} is not built yet (${todo(step)}).`);
  return import(pathToFileURL(p).href);
}
const roots = (c) => ({ beforeRoot: path.join(FIX, c.name, 'before'), afterRoot: path.join(FIX, c.name, 'after') });
const files = (dir) => fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter((d) => d.isFile()).map((d) => path.relative(dir, path.join(d.parentPath ?? d.path, d.name))).sort();

// ---- live: the fixtures obey the contract ------------------------------------------------------------------------

test('planted fixtures: the seven cases are all there', () => {
  assert.deepEqual(CASES.map((c) => c.name), ['pure-move', 'rename', 'split', 'flipped-condition', 'dropped-effect', 'layout-threshold', 'out-of-set']);
  assert.deepEqual(CASES.map((c) => expected(c.name).status), ['proven', 'proven', 'proven', 'changed', 'changed', 'changed', 'tested']);
});

for (const c of CASES) {
  test(`planted fixture ${c.name}: expected verdict is valid and follows from its layer answers`, () => {
    const v = expected(c.name);
    assertUnitVerdict(v, `The ${c.name} verdict`);
    assert.equal(v.sentence, verdictSentence(v));
    assert.deepEqual(v.transforms, c.transforms);
    assert.ok(fs.existsSync(path.join(FIX, c.name, 'before', c.before.file)), c.before.file);
    // the before and after snippets exist, and the unit's file is in the after tree
    const { beforeRoot, afterRoot } = roots(c);
    assert.ok(files(beforeRoot).length > 0 && files(afterRoot).length > 0);
    assert.ok(fs.existsSync(path.join(afterRoot, v.unit.file)), v.unit.file);
    if (v.location) assert.ok(fs.existsSync(path.join(v.location.side === 'before' ? beforeRoot : afterRoot, v.location.file)), v.location.file);
    // the answers come in layer order and stop at the first decisive one
    c.layerResults.forEach((r, i) => assertLayerResult(r, `The ${c.name} layer result ${i}`));
    const order = layerOrder(v.purity, { levels: c.levels });
    const idx = c.layerResults.map((r) => order.indexOf(r.layer));
    assert.ok(idx.every((n, i) => n >= 0 && (i === 0 || n > idx[i - 1])), `layers ${c.layerResults.map((r) => r.layer)} follow ${order}`);
    assert.equal(nextLayer(order, c.layerResults, c.transforms), null);
    assert.equal(nextLayer(order, c.layerResults.slice(0, -1), c.transforms), c.layerResults.at(-1).layer);
    // decideUnit + buildUnitVerdict reproduce the expected verdict
    const built = buildUnitVerdict({ unit: v.unit, purity: v.purity, effectChain: v.effectChain, transforms: c.transforms, ...decideUnit({ results: c.layerResults, transforms: c.transforms }) });
    assert.deepEqual(built, v);
  });
}

test('planted fixtures: the step summary is "3 proven, 1 tested, 0 unverified, 3 changed"', () => {
  assertStepSummary(SUMMARY);
  assert.deepEqual(summarizeStep(SUMMARY.step, CASES.map((c) => expected(c.name))), SUMMARY);
  assert.equal(SUMMARY.sentence, '3 proven, 1 tested, 0 unverified, 3 changed.');
});

test('planted fixtures: each changed location is exact (file, line and the text at that line)', () => {
  const at = { 'flipped-condition': 'age > 18', 'dropped-effect': "toast.success('Order saved')", 'layout-threshold': 'window.innerWidth < 640' };
  for (const [name, text] of Object.entries(at)) {
    const v = expected(name);
    const c = CASES.find((x) => x.name === name);
    const dir = roots(c)[v.location.side === 'before' ? 'beforeRoot' : 'afterRoot'];
    const line = fs.readFileSync(path.join(dir, v.location.file), 'utf8').split('\n')[v.location.line - 1];
    assert.ok(line.includes(text), `${name}: line ${v.location.line} is "${line.trim()}"`);
  }
});

// ---- acceptance: turned on by the build steps ----------------------------------------------------------------------

for (const c of CASES) {
  test(`step 2 acceptance, ${c.name}: purity and effect chain come from Morpheus's effect analysis`, { todo: todo(2) }, async () => {
    const { classifyUnit } = await later('purity.mjs', 2);
    const v = expected(c.name);
    const got = await classifyUnit({ root: roots(c).beforeRoot, file: c.before.file, fn: c.before.fn });
    assert.deepEqual(got, { purity: v.purity, effectChain: v.effectChain });
  });
}

for (const c of CASES) {
  test(`step ${c.step} acceptance, ${c.name}: verifyPair gives the expected verdict`, { todo: todoUnless(c.step) }, async () => {
    const { verifyPair } = await later('verifyPair.mjs', c.step);
    const v = expected(c.name);
    const got = await verifyPair({ ...roots(c), unit: v.unit, transforms: c.transforms, levels: c.levels });
    assert.deepEqual(got, v);
  });
}

test('step 3 acceptance: an extracted unit that sits in no atom or block is reported not-extracted', { todo: todoUnless(3) }, async () => {
  const { verifyPair } = await later('verifyPair.mjs', 3);
  const c = CASES.find((x) => x.name === 'split');
  const v = expected('split');
  const got = await verifyPair({ ...roots(c), unit: v.unit, transforms: ['extract-function'], levels: ['L0'], blocks: [] });
  assert.equal(got.status, 'not-extracted');
  assert.equal(got.layer, 'round-trip');
});

test('step 7 acceptance: verifyStep over all planted fixtures gives the expected step summary', { todo: todo(7) }, async () => {
  const { verifyStep } = await later('verifyPair.mjs', 7);
  const got = await verifyStep({ step: SUMMARY.step, cases: CASES.map((c) => ({ ...roots(c), unit: expected(c.name).unit, transforms: c.transforms, levels: c.levels })) });
  assert.deepEqual(got, SUMMARY);
});

test('step 8 acceptance: escalating every fixture to L2 changes no verdict (no false stops)', { todo: todo(8) }, async () => {
  const { verifyPair } = await later('verifyPair.mjs', 8);
  for (const c of CASES) {
    const v = expected(c.name);
    const got = await verifyPair({ ...roots(c), unit: v.unit, transforms: c.transforms, levels: ['L0', 'L1', 'L2'] });
    assert.equal(got.status, v.status, c.name);
  }
});
