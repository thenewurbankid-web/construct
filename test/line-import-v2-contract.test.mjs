// Line Import v2 contract (packages/engine/line/importV2/contract.mjs) over its mock (mock.mjs): every mock value
// passes its assert*, and each assert refuses a broken value with one sentence naming the field.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertLogicUnit, assertLogicMap, assertMapDiff, assertRouteClosure, assertCharTest, assertUnitCoverage, assertFitProposal, assertImportLoopState,
  assertImportLogic, LOGIC_UNIT_KINDS, LOGIC_MAP_FILE, FIT_FILE, IMPORT_LOOP_RECORDS, KIND_FOLDER, FIT_BLOCK_KINDS,
} from '../packages/engine/line/importV2/contract.mjs';
import {
  MOCK_LOGIC_MAP, MOCK_LOGIC_MAP_AFTER, MOCK_MAP_DIFF, MOCK_ROUTE_CLOSURE, MOCK_CHAR_TEST, MOCK_UNIT_COVERAGE, MOCK_FIT_PROPOSAL, MOCK_IMPORT_LOOP_STATE,
} from '../packages/engine/line/importV2/mock.mjs';

const ONE_SENTENCE = /^[A-Z][^\n]*\.$/;
const refuses = (fn, field) => assert.throws(fn, (e) => e instanceof TypeError && ONE_SENTENCE.test(e.message) && e.message.includes(field));

test('import v2 contract: every mock value passes its shape check', () => {
  assertLogicMap(MOCK_LOGIC_MAP);
  assertLogicMap(MOCK_LOGIC_MAP_AFTER);
  assertMapDiff(MOCK_MAP_DIFF);
  assertRouteClosure(MOCK_ROUTE_CLOSURE);
  assertCharTest(MOCK_CHAR_TEST);
  assertUnitCoverage(MOCK_UNIT_COVERAGE);
  assertFitProposal(MOCK_FIT_PROPOSAL);
  assertImportLoopState(MOCK_IMPORT_LOOP_STATE);
  assert.equal(LOGIC_UNIT_KINDS.length, 14);
  assert.equal(LOGIC_MAP_FILE, 'line/logic-map.json');
});

test('import v2 contract: the mock fit places every mapped unit exactly once (in a block, or unassigned with a sentence)', () => {
  const placed = [...MOCK_FIT_PROPOSAL.blocks.flatMap((b) => b.units), ...MOCK_FIT_PROPOSAL.unassigned.map((u) => u.unit)].sort();
  assert.deepEqual(placed, MOCK_LOGIC_MAP.units.map((u) => u.fingerprint).sort());
  assertFitProposal(MOCK_FIT_PROPOSAL, MOCK_LOGIC_MAP.units.map((u) => u.fingerprint));
  refuses(() => assertFitProposal(MOCK_FIT_PROPOSAL, [...MOCK_LOGIC_MAP.units.map((u) => u.fingerprint), 'ffffffffffffffff']), 'be in a block or listed as unassigned');
  assert.ok(MOCK_FIT_PROPOSAL.blocks.every((b) => ['feature', 'library'].includes(b.area)));
});

test('import v2 contract: one place for every shape -- the plan-file loop record, coverage per kind, waivers by the owner only', () => {
  assertImportLogic({ route: '/opportunity', closure: null, map: MOCK_IMPORT_LOOP_STATE.mapBefore, fit: { feature: 'opportunity', blocks: 3, unassigned: 1, sentence: 'The logic fits 3 blocks.' }, tests: [MOCK_CHAR_TEST], baselineTests: null, waivers: MOCK_UNIT_COVERAGE.waived, loop: [MOCK_IMPORT_LOOP_STATE], last: null });
  refuses(() => assertImportLogic({ route: null, closure: null, map: null, tests: [], baselineTests: null, waivers: [{ fingerprint: 'x', by: 'agent', why: 'An agent tried.' }], loop: [], last: null }), 'an agent never waives');
  refuses(() => assertUnitCoverage({ ...MOCK_UNIT_COVERAGE, byKind: { branch: { covered: 3, total: 2 } } }), 'be at most its total');
  refuses(() => assertUnitCoverage({ ...MOCK_UNIT_COVERAGE, byKind: { loop: { covered: 0, total: 1 } } }), 'byKind key');
  assert.deepEqual(Object.keys(KIND_FOLDER).sort(), [...FIT_BLOCK_KINDS].sort());
  assert.equal(IMPORT_LOOP_RECORDS, 'records/import-loop.jsonl');
  assert.equal(FIT_FILE, 'line/fit.json');
});

test('import v2 contract: refusals are one sentence naming the field', () => {
  const u = MOCK_LOGIC_MAP.units[0];
  refuses(() => assertLogicUnit({ ...u, kind: 'loop' }), "kind must be one of");
  refuses(() => assertLogicUnit({ ...u, line: 0 }), "line must be an integer from 1");
  refuses(() => assertLogicMap({ ...MOCK_LOGIC_MAP, counts: { ...MOCK_LOGIC_MAP.counts, branch: 9 } }), 'count for branch');
  refuses(() => assertLogicMap({ ...MOCK_LOGIC_MAP, units: [u, u], counts: { export: 2 } }), 'be unique within the map');
  refuses(() => assertMapDiff({ ...MOCK_MAP_DIFF, missing: [{ ...MOCK_MAP_DIFF.missing[0], sentence: 'lost' }] }), "Missing unit 0's sentence");
  refuses(() => assertRouteClosure({ ...MOCK_ROUTE_CLOSURE, routes: [] }), 'name at least one route');
  refuses(() => assertCharTest({ ...MOCK_CHAR_TEST, runner: 'vitest' }), 'runner must be jest');
  refuses(() => assertUnitCoverage({ ...MOCK_UNIT_COVERAGE, uncovered: [...MOCK_UNIT_COVERAGE.uncovered, MOCK_UNIT_COVERAGE.covered[0]] }), 'only one of covered');
  const [b0, ...rest] = MOCK_FIT_PROPOSAL.blocks;
  refuses(() => assertFitProposal({ ...MOCK_FIT_PROPOSAL, blocks: [b0, ...rest, { ...b0, name: 'again' }] }), 'go to exactly one block');
  refuses(() => assertFitProposal({ ...MOCK_FIT_PROPOSAL, blocks: [{ ...b0, area: 'elsewhere' }, ...rest] }), 'area must be one of feature, library');
  refuses(() => assertFitProposal({ ...MOCK_FIT_PROPOSAL, unassigned: [{ unit: '4e5f60718293a4b5', sentence: 'no' }] }), "Unassigned unit 0's sentence");
  refuses(() => assertImportLoopState({ ...MOCK_IMPORT_LOOP_STATE, status: 'done' }), 'status must be one of ok, stopped');
});
