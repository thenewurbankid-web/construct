// Line Import v2 logic map (packages/engine/line/logicMap.mjs): every unit kind is found, fingerprints survive a file
// move, a rename and any reformatting, and compareLogicMaps names what went missing or changed in one sentence each.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import path from 'node:path';
import fc from 'fast-check';
import { buildLogicMap, compareLogicMaps, writeLogicMap, readLogicMap } from '../packages/engine/line/logicMap.mjs';
import { assertLogicMap, assertMapDiff, LOGIC_UNIT_KINDS } from '../packages/engine/line/importV2/contract.mjs';

const APP = path.join(path.dirname(new URL(import.meta.url).pathname), 'fixtures/logic-map/app');
const CLIENT = 'src/opportunity/OpportunityClient.tsx';
const PAGE = 'src/opportunity/page.tsx';
const MACHINE = 'src/opportunity/machine.ts';
const FILES = [PAGE, CLIENT, MACHINE];
const ORIGINAL = Object.fromEntries(FILES.map((f) => [f, fs.readFileSync(path.join(APP, f), 'utf8')]));

/** Build a map over in-memory files (relative path -> source). */
const mapOf = (files, options = {}) => buildLogicMap('/app', Object.keys(files), { ...options, read: (abs) => files[path.relative('/app', abs)] });
const edit = (file, from, to) => {
  assert.ok(ORIGINAL[file].includes(from), `fixture has ${from}`);
  return { ...ORIGINAL, [file]: ORIGINAL[file].replace(from, to) };
};

test('logic map: every unit kind is detected in the fixture', () => {
  const map = buildLogicMap(APP, FILES);
  assertLogicMap(map);
  for (const k of LOGIC_UNIT_KINDS) assert.ok(map.counts[k] > 0, `kind ${k} found`);
  const detail = (kind) => map.units.filter((u) => u.kind === kind).map((u) => u.detail);
  assert.deepEqual(detail('render-if'), ['isLoading && …', 'data ? … : …']);
  assert.ok(detail('branch').includes("if (activeTab !== 'all')"));
  assert.ok(detail('branch').includes('machine filters: all --PICK--> filtered'), 'xstate transitions come from extractMachines');
  assert.deepEqual(detail('url-read'), ["searchParams.get('category')"]);
  assert.deepEqual(detail('navigation').length, 3, 'router.push and the two params.set calls');
  assert.deepEqual(detail('handler'), ["onClick=() => handleTabChange('all')", 'onClick=save']);
  assert.ok(map.units.find((u) => u.kind === 'navigation' && u.detail.startsWith('router.push')).fn === 'handleTabChange', 'a useCallback body is named by its const');
  assert.ok(map.units.every((u) => !u.fingerprint.includes('/') && u.fingerprint.length === 16));
});

test('logic map: moving a file keeps every fingerprint, so the diff is all moved and nothing missing', () => {
  const before = mapOf(ORIGINAL);
  const after = mapOf({ [PAGE]: ORIGINAL[PAGE], 'features/opportunity/pages/OpportunityClient.tsx': ORIGINAL[CLIENT], [MACHINE]: ORIGINAL[MACHINE] });
  const diff = compareLogicMaps(before, after);
  assertMapDiff(diff);
  assert.equal(diff.missing.length, 0);
  assert.equal(diff.changed.length, 0);
  assert.equal(diff.added.length, 0);
  assert.equal(diff.moved.length, before.units.filter((u) => u.file === CLIENT).length);
  assert.ok(diff.moved.every((m) => m.from.fingerprint === m.to.fingerprint && m.to.file.startsWith('features/')));
});

test('logic map: deleting a branch makes it missing, with a sentence', () => {
  const diff = compareLogicMaps(mapOf(ORIGINAL), mapOf(edit(CLIENT, "  if (selectedCategory) params.set('category', selectedCategory);\n", '')));
  assertMapDiff(diff);
  const branch = diff.missing.find((u) => u.kind === 'branch');
  assert.ok(branch, 'the branch is missing');
  assert.equal(branch.sentence, `The branch "if (selectedCategory)" in buildOpportunityUrlParams (${CLIENT}:10) is missing after the import.`);
  assert.deepEqual(diff.missing.map((u) => u.kind).sort(), ['branch', 'navigation']);
  assert.equal(diff.changed.length, 0);
});

test('logic map: editing a condition makes the branch changed, not missing', () => {
  const diff = compareLogicMaps(mapOf(ORIGINAL), mapOf(edit(CLIENT, "if (activeTab !== 'all')", "if (activeTab !== 'recent')")));
  assertMapDiff(diff);
  assert.equal(diff.missing.length, 0);
  assert.equal(diff.added.length, 0);
  assert.equal(diff.changed.length, 1);
  assert.equal(diff.changed[0].sentence, `The branch in buildOpportunityUrlParams changed from "if (activeTab !== 'all')" to "if (activeTab !== 'recent')".`);
});

test('logic map: a rename through the table keeps fingerprints', () => {
  const renames = { OpportunityClient: 'OpportunityView', buildOpportunityUrlParams: 'buildParams' };
  const renamed = { ...ORIGINAL, [CLIENT]: ORIGINAL[CLIENT].replaceAll('OpportunityClient', 'OpportunityView').replaceAll('buildOpportunityUrlParams', 'buildParams'), [PAGE]: ORIGINAL[PAGE].replaceAll('OpportunityClient', 'OpportunityView') };
  const before = mapOf(ORIGINAL);
  const after = mapOf(renamed);
  const without = compareLogicMaps(before, after);
  assert.ok(without.missing.length + without.changed.length > 0, 'without the table the rename shows');
  const diff = compareLogicMaps(before, after, { renames });
  assertMapDiff(diff);
  assert.equal(diff.missing.length, 0);
  assert.equal(diff.changed.length, 0);
  assert.equal(diff.kept.length, before.units.length);
  // the table given at build time gives the same fingerprints directly
  assert.deepEqual(mapOf(ORIGINAL, { renames }).units.map((u) => u.fingerprint), after.units.map((u) => u.fingerprint));
});

test('logic map: the same logic twice in one function gets distinct fingerprints, by order', () => {
  const src = 'export function f(a) {\n  if (a) return 1;\n  if (a) return 2;\n}\n';
  const map = mapOf({ 'x.ts': src });
  assertLogicMap(map);
  const branches = map.units.filter((u) => u.kind === 'branch');
  assert.equal(branches.length, 2);
  assert.notEqual(branches[0].fingerprint, branches[1].fingerprint);
  assert.deepEqual(mapOf({ 'y/z.ts': src }).units.map((u) => u.fingerprint), map.units.map((u) => u.fingerprint));
});

test('#856 an export unit carries exportName additively; fn stays <module> so fingerprints do not move', () => {
  const src = 'export function Button() { return null; }\nexport const a = 1, b = () => 2;\nexport default function () { return 1; }\n';
  const map = mapOf({ 'Button.tsx': src });
  assertLogicMap(map);
  const ex = map.units.filter((u) => u.kind === 'export');
  assert.deepEqual(ex.map((u) => [u.fn, u.exportName]), [['<module>', 'Button'], ['<module>', 'a, b'], ['<module>', 'default']]);
  assert.ok(map.units.filter((u) => u.kind !== 'export').every((u) => !('exportName' in u)));
});

test('logic map: the map is stored at line/logic-map.json through writeLineState', () => {
  const dir = makeTempDir('logic-map-');
  try {
    const map = buildLogicMap(APP, FILES);
    assert.equal(writeLogicMap(dir, map), 'line/logic-map.json');
    assert.deepEqual(readLogicMap(dir), JSON.parse(JSON.stringify(map)));
    assert.throws(() => writeLogicMap(dir, map, { stateDir: '../outside' }), /Line state is written only inside/);
    assert.equal(readLogicMap(path.join(dir, 'none')), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('logic map property: reformatting or reordering imports never changes a fingerprint', () => {
  const lines = ORIGINAL[CLIENT].split('\n');
  const importIdx = lines.map((l, i) => (l.startsWith('import ') ? i : -1)).filter((i) => i >= 0);
  const jsxFrom = lines.findIndex((l) => l.includes('return ('));
  const expected = mapOf(ORIGINAL).units.map((u) => u.fingerprint);
  fc.assert(fc.property(
    fc.shuffledSubarray(importIdx, { minLength: importIdx.length, maxLength: importIdx.length }),
    fc.integer({ min: 0, max: 6 }),
    fc.array(fc.boolean(), { minLength: lines.length, maxLength: lines.length }),
    fc.array(fc.boolean(), { minLength: lines.length, maxLength: lines.length }),
    fc.boolean(),
    (order, indent, blank, comment, doubleQuotes) => {
      const out = lines.map((l, i) => (importIdx.includes(i) ? lines[order[importIdx.indexOf(i)]] : l)).map((l, i) => {
        let s = l.replace(/^( +)/, (m) => ' '.repeat(Math.round((m.length / 2) * indent)));
        if (i < jsxFrom && doubleQuotes) s = s.replace(/'([^'"\\`$]*)'/g, '"$1"');
        if (i < jsxFrom && comment[i] && s.trim() && !s.trim().startsWith("'use")) s += ' // note';
        return blank[i] && i < jsxFrom ? `${s}\n` : s;
      }).join('\n');
      const got = mapOf({ ...ORIGINAL, [CLIENT]: out }).units.map((u) => u.fingerprint);
      assert.deepEqual(got, expected);
    },
  ), { numRuns: 60, seed: 4242 });
});
