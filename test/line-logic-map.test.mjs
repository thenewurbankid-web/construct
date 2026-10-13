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

test('#923 logic map: each unit carries its enclosing function\'s complexity signature; the diff reports complexity deltas', () => {
  const map = mapOf(ORIGINAL);
  const sig = { cyclomatic: 3, cognitive: null, maxNesting: 1, params: 2, returns: 1 }; // cyclomatic from ESLint; cognitive null without fallow
  const inBuild = map.units.filter((u) => u.fn === 'buildOpportunityUrlParams');
  assert.ok(inBuild.length >= 2 && inBuild.every((u) => assert.deepEqual(u.complexity, sig) ?? true));
  assert.ok(map.units.filter((u) => u.fn === '<module>').every((u) => !('complexity' in u)), 'module-level units have no function signature');
  assert.deepEqual(compareLogicMaps(map, mapOf(ORIGINAL)).complexity, [], 'no change, no delta');
  const diff = compareLogicMaps(map, mapOf(edit(CLIENT, "if (activeTab !== 'all')", "if (activeTab !== 'all' && activeTab)")));
  assertMapDiff(diff);
  assert.deepEqual(diff.complexity, [{
    file: CLIENT, fn: 'buildOpportunityUrlParams', before: sig,
    after: { ...sig, cyclomatic: 4 },
    delta: { cyclomatic: 1, cognitive: null, maxNesting: 0, params: 0, returns: 0 },
  }]);
  assert.equal(map.units[0].fingerprint, mapOf(ORIGINAL).units[0].fingerprint, 'the signature is not part of the fingerprint');
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

// #875: an import step that moves a page into the library and renames its component renames it in that file only.
const CARD = (name) => `export function ${name}({ item, onPick }) {\n  if (!item) return null;\n  return <button onClick={() => onPick(item.id)}>{item.title}</button>;\n}\n`;
test('#875 logic map: a per-file rename table renames the moved file only; the same name in another file is unaffected', () => {
  const before = mapOf({ 'src/shop/Card.tsx': CARD('Card'), 'src/blog/Card.tsx': CARD('Card') });
  const after = mapOf({ 'src/shop/library/components/ShopCard.tsx': CARD('ShopCard'), 'src/blog/Card.tsx': CARD('Card') });
  const without = compareLogicMaps(before, after);
  assert.ok(without.missing.length + without.changed.length > 0 && without.added.length + without.changed.length > 0, 'without a table the renamed units read as missing + added');
  const diff = compareLogicMaps(before, after, { fileRenames: { 'src/shop/Card.tsx': { Card: 'ShopCard' } } });
  assertMapDiff(diff);
  assert.deepEqual([diff.missing.length, diff.changed.length, diff.added.length], [0, 0, 0]);
  assert.equal(diff.moved.length, before.units.filter((u) => u.file === 'src/shop/Card.tsx').length);
  assert.ok(diff.moved.every((x) => x.from.file === 'src/shop/Card.tsx' && x.to.file === 'src/shop/library/components/ShopCard.tsx'));
  assert.equal(diff.kept.length, before.units.filter((u) => u.file === 'src/blog/Card.tsx').length, 'the other Card keeps its name and every unit');
  // a project-wide table is wrong: it renames the other copy too, which then reads as missing
  const global = compareLogicMaps(before, after, { renames: { Card: 'ShopCard' } });
  assert.ok(global.missing.length + global.changed.length > 0);
  assert.ok([...global.missing, ...global.changed.map((c) => c.before)].every((u) => u.file === 'src/blog/Card.tsx'));
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
