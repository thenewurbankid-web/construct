// UAT walk, rows lv1, lv3, lv5 and lv6: Line logic verification (docs/line/HANDOVER-2026-10-12-import.md, "Line logic
// verification"; packages/engine/line/logicVerify). No CLI command runs it yet (it is wired into Import v2 at build
// step 7), so this walk calls the engine entry points, verifyPair and the contract validators, on the seven planted
// fixtures in test/fixtures/logic-verify (small synthetic snippets).
//   lv1  the contract validators accept every planted verdict and refuse a broken one with a sentence;
//   lv3  a move and a rename are proven same-behaviour at L0 by the canonical compare;
//   lv5  a changed layout threshold is caught by the layout fakes with Window.innerWidth at the boundary;
//   lv6  a flipped condition is found changed by Z3 with a counterexample, and an equal pair is proven equal.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO, say, tempDir, walk } from './walk.mjs';

const FIX = path.join(REPO, 'test/fixtures/logic-verify');
const MOD = (f) => import(pathToFileURL(path.join(REPO, 'packages/engine/line/logicVerify', f)).href);
const CASES = JSON.parse(fs.readFileSync(path.join(FIX, 'cases.json'), 'utf8'));
const expected = (name) => JSON.parse(fs.readFileSync(path.join(FIX, name, 'expected.json'), 'utf8'));
const roots = (name) => ({ beforeRoot: path.join(FIX, name, 'before'), afterRoot: path.join(FIX, name, 'after') });
/** One sentence of a thrown validator error. */
const refusal = (fn) => { try { fn(); } catch (e) { return String(/** @type {any} */ (e).message); } return null; };

const t = tempDir('lv');
await walk('lv1 lv3 lv5 lv6 logic verification', async () => {
  const { assertUnitVerdict } = await MOD('contract.mjs');
  const { verifyPair } = await MOD('verifyPair.mjs');
  const { z3Layer } = await MOD('z3Prove.mjs');
  const pair = async (name) => {
    const c = CASES.find((x) => x.name === name);
    const v = await verifyPair({ ...roots(name), unit: expected(name).unit, transforms: c.transforms, levels: c.levels });
    assertUnitVerdict(v, `The ${name} verdict`);
    return v;
  };

  say('-- lv1. the UnitVerdict contract');
  assert.equal(CASES.length, 7, 'seven planted fixtures');
  for (const c of CASES) assertUnitVerdict(expected(c.name), `The ${c.name} verdict`);
  say(`  > all ${CASES.length} planted verdicts pass assertUnitVerdict (${CASES.map((c) => c.name).join(', ')})`);
  const changed = expected('flipped-condition');
  const handProven = refusal(() => assertUnitVerdict({ ...changed, status: 'proven', location: undefined, input: undefined }));
  assert.match(handProven ?? '', /not be proven, because the unit was edited outside the closed transform set/);
  say(`  > a hand edit marked proven is refused: ${handProven}`);
  const noWhere = refusal(() => assertUnitVerdict({ ...changed, location: undefined }));
  assert.match(noWhere ?? '', /changed unit names its exact location/);
  say(`  > a changed verdict with no location is refused: ${noWhere}`);
  const sampled = refusal(() => assertUnitVerdict({ ...expected('out-of-set'), status: 'proven', transforms: ['move'] }));
  assert.match(sampled ?? '', /only samples inputs/);
  say(`  > proven by a sampling layer is refused: ${sampled}`);

  say('-- lv3. a move and a rename, proven at L0 by the canonical compare');
  for (const name of ['pure-move', 'rename']) {
    const v = await pair(name);
    assert.equal(v.status, 'proven', `${name}: ${v.sentence}`);
    assert.equal(v.layer, 'L0-canonical');
    assert.deepEqual(v, expected(name));
    say(`  > ${name}: ${v.sentence}`);
  }

  say('-- lv5. a changed layout threshold (768 -> 640), caught with the layout fakes');
  const layout = await pair('layout-threshold');
  assert.equal(layout.status, 'changed', layout.sentence);
  assert.equal(layout.layer, 'isolated');
  assert.deepEqual(layout.input, { 'Window.innerWidth': 640 });
  assert.equal(layout.location?.line, 4);
  say(`  > ${layout.sentence}`);

  say('-- lv6. Z3: a flipped condition (>= to >) is changed; an equal rewrite is proven equal');
  const flipped = await pair('flipped-condition');
  assert.equal(flipped.status, 'changed', flipped.sentence);
  assert.equal(flipped.layer, 'z3');
  assert.deepEqual(flipped.input, [18], 'the counterexample is age 18');
  say(`  > ${flipped.sentence}`);
  const before = fs.readFileSync(path.join(FIX, 'flipped-condition/before/src/age.ts'), 'utf8');
  const { buildUnitVerdict } = await MOD('verdict.mjs');
  // A rewrite that looks equal but is not: Z3 works on IEEE doubles, so NaN tells !(age < 18) from age >= 18.
  const nearly = await z3Layer({ beforeSource: before, afterSource: 'export const isAdult = (years: number): boolean => !(years < 18);', fn: 'isAdult', file: 'src/age.ts' });
  assert.equal(nearly.outcome, 'changed');
  assert.ok(Number.isNaN(/** @type {any} */ (nearly.input)[0]), 'the counterexample is NaN');
  const nearlyVerdict = buildUnitVerdict({ unit: expected('flipped-condition').unit, purity: 'pure', effectChain: [], transforms: null, status: 'changed', layer: 'z3', location: nearly.location, input: nearly.input });
  assert.match(nearlyVerdict.sentence, /for input \[NaN\]/);
  say(`  > !(years < 18) looks equal but is not: ${nearlyVerdict.sentence}`);
  const after = 'export const isAdult = (years: number): boolean => 18 <= years;\n';
  fs.mkdirSync(path.join(t.dir, 'before/src'), { recursive: true });
  fs.mkdirSync(path.join(t.dir, 'after/src'), { recursive: true });
  fs.writeFileSync(path.join(t.dir, 'before/src/age.ts'), before);
  fs.writeFileSync(path.join(t.dir, 'after/src/age.ts'), after);
  say(`  wrote an equal rewrite: ${after.trim()}`);
  const proof = await z3Layer({ beforeSource: before, afterSource: after, fn: 'isAdult', file: 'src/age.ts' });
  assert.equal(proof.outcome, 'same-behaviour', `Z3 proves the rewrite equal (${JSON.stringify(proof)})`);
  say('  > Z3: same behaviour for every number, NaN included (a proof, not a sample)');
  const equal = await verifyPair({ beforeRoot: path.join(t.dir, 'before'), afterRoot: path.join(t.dir, 'after'), unit: { ...expected('flipped-condition').unit }, transforms: null, levels: ['L0', 'L1'] });
  assertUnitVerdict(equal, 'The equal-rewrite verdict');
  assert.equal(equal.layer, 'z3', equal.sentence);
  assert.notEqual(equal.status, 'changed', equal.sentence);
  say(`  > verifyPair, as a hand edit: ${equal.sentence}`);
}, t.cleanup);
