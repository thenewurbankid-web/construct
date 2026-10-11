// Line Import v2 contract (packages/engine/line/importV2/contract.mjs) over its mock (mock.mjs): every mock value
// passes its assert*, and each assert refuses a broken value with one sentence naming the field.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertLogicUnit, assertLogicMap, assertMapDiff, assertRouteClosure, assertCharTest, assertUnitCoverage, assertFitProposal, assertImportLoopState,
  LOGIC_UNIT_KINDS, LOGIC_MAP_FILE,
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

test('import v2 contract: the mock fit places every mapped unit exactly once', () => {
  const placed = MOCK_FIT_PROPOSAL.blocks.flatMap((b) => b.units).sort();
  assert.deepEqual(placed, MOCK_LOGIC_MAP.units.map((u) => u.fingerprint).sort());
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
  refuses(() => assertImportLoopState({ ...MOCK_IMPORT_LOOP_STATE, status: 'done' }), 'status must be one of ok, stopped');
});
