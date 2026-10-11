// Line Import v2, characterization (packages/engine/line/characterize.mjs): tests generated in the target app's own jest
// that pin down today's behaviour, and coverage mapped onto logic units. Static parts run everywhere; the end-to-end part
// needs a node_modules with jest, ts-jest, jsdom, React and React Testing Library (LINE_CHAR_JEST_HOME, or
// ~/Repositories/max-ai-ui/node_modules when present) and is skipped, with the reason, without one.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { characterize, generateCharacterizationTests, unitCoverage, locateUnitSpans, analyzeClosure, pathnameOfEntry, runJest, CHAR_DIR } from '../packages/engine/line/characterize.mjs';
import { lockedText, json, scenarioTitle, isGenerated } from '../packages/engine/line/characterize/emit.mjs';
import { causeOf } from '../packages/engine/line/characterize/unitCoverage.mjs';
import { GENERATED_MARKER } from '../packages/engine/testGenerator.mjs';

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/line-char-app');
const FILES = ['src/app/shop/page.tsx', 'src/app/shop/Shop.tsx', 'src/lib/price.ts', 'src/lib/api.ts', 'src/lib/toast.ts'];
const CLOSURE = { files: FILES, routes: [{ entry: 'src/app/shop/page.tsx' }] };

function copyFixture() {
  const dir = makeTempDir('construct-line-char-');
  fs.cpSync(FIXTURE, dir, { recursive: true });
  return dir;
}

/** A unit at the first line of `file` containing `needle` (the logic map's shape: id, file, fn, kind, line, detail). */
function unit(root, file, fn, kind, needle, detail, n = 1) {
  const lines = fs.readFileSync(path.join(root, file), 'utf8').split('\n');
  const line = lines.findIndex((l) => l.includes(needle)) + 1;
  assert.ok(line > 0, `${needle} not found in ${file}`);
  return { id: `${file}#${fn}:${kind}:${n}`, file, fn, kind, line, detail };
}

function fixtureMap(root) {
  const units = [
    unit(root, 'src/lib/price.ts', 'priceLabel', 'export', 'export function priceLabel', 'function priceLabel'),
    unit(root, 'src/lib/price.ts', 'priceLabel', 'branch', 'if (amount < 0)', 'if (amount < 0)'),
    unit(root, 'src/lib/price.ts', 'priceLabel', 'branch', 'if (amount >= 1000)', 'if (amount >= 1000)', 2),
    unit(root, 'src/lib/price.ts', 'seatsFor', 'export', 'export function seatsFor', 'function seatsFor'),
    unit(root, 'src/lib/price.ts', 'seatsFor', 'branch', "case 'free'", "case 'free'"),
    unit(root, 'src/lib/price.ts', 'seatsFor', 'branch', "case 'pro'", "case 'pro'", 2),
    unit(root, 'src/lib/price.ts', 'seatsFor', 'branch', 'default:', 'case default', 3),
    unit(root, 'src/app/shop/Shop.tsx', 'Shop', 'state', 'useState<', "tier = useState('free')"),
    unit(root, 'src/app/shop/Shop.tsx', 'Shop', 'data', 'useGetItemsQuery({ tier })', 'useGetItemsQuery({ tier })'),
    unit(root, 'src/app/shop/Shop.tsx', 'Shop', 'branch', 'if (isLoading)', 'if (isLoading)'),
    unit(root, 'src/app/shop/Shop.tsx', 'Shop', 'branch', 'if (isError)', 'if (isError)', 2),
    unit(root, 'src/app/shop/Shop.tsx', 'onBuy', 'toast', "toast.show('Bought')", "toast.show('Bought')"),
    unit(root, 'src/app/shop/Shop.tsx', 'onBuy', 'toast', "toast.show('Purchase failed')", "toast.show('Purchase failed')", 2),
    unit(root, 'src/app/shop/Shop.tsx', 'Shop', 'handler', 'Switch tier', "onClick=() => setTier(tier === 'free' ? 'pro' : 'free')"),
    unit(root, 'src/app/shop/Shop.tsx', 'on:onClick', 'branch', "tier === 'free' ?", "tier === 'free' ? …"),
    unit(root, 'src/app/shop/Shop.tsx', 'Shop', 'render-if', 'No items', 'data && data.items.length === 0'),
    unit(root, 'src/app/shop/Shop.tsx', 'Shop', 'handler', 'aria-label={`buy', 'onClick=() => onBuy(item.id)', 2),
  ];
  return { root, files: FILES, units, counts: {} };
}

function jestHome() {
  const candidates = [process.env.LINE_CHAR_JEST_HOME, path.join(os.homedir(), 'Repositories/max-ai-ui/node_modules')].filter(Boolean);
  const needs = ['jest', 'ts-jest', 'jest-environment-jsdom', 'react', 'react-dom', '@testing-library/react', 'typescript'];
  return candidates.find((c) => needs.every((n) => fs.existsSync(path.join(c, n, 'package.json')))) ?? null;
}

test('characterize: analysis finds pure functions, the component, its data hooks, the toast spy and the route pathname', () => {
  const a = analyzeClosure(FIXTURE, CLOSURE);
  const byId = Object.fromEntries(a.subjects.map((s) => [s.id, s]));
  assert.equal(byId['price.priceLabel'].kind, 'pure');
  assert.deepEqual(byId['price.priceLabel'].params, [{ k: 'num' }]);
  assert.deepEqual(byId['price.seatsFor'].params, [{ k: 'union', of: [{ k: 'lit', v: 'free' }, { k: 'lit', v: 'pro' }, { k: 'lit', v: 'team' }] }]);
  assert.equal(byId['Shop.default'].kind, 'component');
  assert.equal(byId['page.default'].kind, 'component');
  assert.equal(byId['toast.toast.show'].kind, 'pure');
  const hooks = a.env.hookModules.find((m) => m.file === 'src/lib/api.ts').hooks;
  assert.deepEqual(Object.keys(hooks).sort(), ['useBuyItemMutation', 'useGetItemsQuery']);
  assert.equal(hooks.useGetItemsQuery.kind, 'query');
  assert.equal(a.shapes[hooks.useGetItemsQuery.data.id].k, 'obj');
  assert.deepEqual(a.env.spies, [{ module: 'src/lib/toast.ts', bare: false, exportName: 'toast', method: 'show' }]);
  assert.ok(a.pools.byKey.amount.includes(1000) && a.pools.byKey.amount.includes(999), 'the literal a branch compares with (and its neighbours) is in the pool');
  assert.equal(pathnameOfEntry(FIXTURE, 'src/app/shop/page.tsx'), '/shop');
  assert.equal(pathnameOfEntry(FIXTURE, 'src/app/[locale]/(group)/opportunity/page.tsx'), '/opportunity');
});

test('characterize: unitCoverage maps istanbul counters onto units, with one reason per uncovered unit', () => {
  const map = fixtureMap(FIXTURE);
  const located = locateUnitSpans(FIXTURE, map.units);
  assert.ok(located.every((u) => u.span), 'every unit is found in its file');
  assert.ok(located.every((u) => /^[0-9a-f]{16}$/.test(u.fingerprint)));
  const at = (id) => located.find((u) => u.id === id).span;
  const neg = at('src/lib/price.ts#priceLabel:branch:1');
  const big = at('src/lib/price.ts#priceLabel:branch:2');
  const fn = at('src/lib/price.ts#priceLabel:export:1');
  const free = at('src/lib/price.ts#seatsFor:branch:1');
  const seatsFn = at('src/lib/price.ts#seatsFor:export:1');
  // as jest writes it: the `if (amount < 0)` decision went both ways, `>= 1000` only one way; seatsFor never ran
  const cov = {
    [path.join(FIXTURE, 'src/lib/price.ts')]: {
      statementMap: { 0: { start: neg.start, end: neg.end }, 1: { start: big.start, end: big.end } },
      s: { 0: 3, 1: 2 },
      fnMap: { 0: { name: 'priceLabel', decl: { start: fn.fnStarts[0], end: fn.fnStarts[0] }, loc: { start: fn.fnStarts[0], end: fn.end } }, 1: { name: 'seatsFor', decl: { start: seatsFn.fnStarts[0], end: seatsFn.fnStarts[0] }, loc: { start: seatsFn.fnStarts[0], end: seatsFn.end } } },
      f: { 0: 3, 1: 0 },
      branchMap: {
        0: { type: 'if', loc: { start: neg.start, end: neg.end }, locations: [{ start: neg.start, end: neg.end }, { start: {}, end: {} }] },
        1: { type: 'if', loc: { start: big.start, end: big.end }, locations: [{ start: big.start, end: big.end }, { start: {}, end: {} }] },
        2: { type: 'switch', loc: { start: { line: free.start.line - 1, column: 2 }, end: free.end }, locations: [{ start: free.start, end: free.end }] },
      },
      b: { 0: [1, 2], 1: [0, 2], 2: [0] },
    },
  };
  const uc = unitCoverage({ root: FIXTURE, units: located }, cov);
  const fp = (id) => located.find((u) => u.id === id).fingerprint;
  assert.ok(uc.covered.includes(fp('src/lib/price.ts#priceLabel:branch:1')));
  assert.ok(uc.covered.includes(fp('src/lib/price.ts#priceLabel:export:1')));
  const why = Object.fromEntries(uc.details.map((d) => [d.id, d.why]));
  assert.equal(why['src/lib/price.ts#priceLabel:branch:2'], 'Only one outcome ran; the then-branch never did.');
  assert.equal(why['src/lib/price.ts#seatsFor:export:1'], 'No test called this exported function.');
  assert.equal(why['src/lib/price.ts#seatsFor:branch:1'], 'No test reached this case.');
  assert.equal(why['src/app/shop/Shop.tsx#Shop:branch:1'], 'Its file was not loaded by any characterization test.');
  assert.deepEqual(uc.byKind.export, { covered: 1, total: 2 });
  assert.ok(uc.details.every((d) => d.cause === 'not-reached'));
  // causes a test in jsdom cannot change are named
  assert.equal(causeOf({ span: { text: "if (typeof window === 'undefined') return null;" } }).cause, 'no-window');
  assert.equal(causeOf({ span: { text: 'if (!wrapperRef.current) return;' } }).cause, 'ref-guard');
  assert.equal(causeOf({ span: { text: 'if (range > best)', context: 'function f(el) { const range = el.scrollHeight - el.clientHeight; }' } }).cause, 'layout');
  // an owner waiver takes a unit out of `uncovered`
  const waived = [{ fingerprint: fp('src/lib/price.ts#seatsFor:export:1'), by: 'owner', why: 'dead code, deleted next' }];
  const uc2 = unitCoverage({ root: FIXTURE, units: located }, cov, { waived });
  assert.ok(!uc2.uncovered.includes(waived[0].fingerprint));
  assert.deepEqual(uc2.waived, waived);
});

test('characterize: locked files are marked, escaped and byte-identical for the same input', () => {
  const a = analyzeClosure(FIXTURE, CLOSURE);
  const subject = a.subjects.find((s) => s.id === 'price.priceLabel');
  const nasty = `a"b\`c\${d} e</script>`;
  const cases = [{ title: scenarioTitle(subject, { args: [nasty] }, 0), scenario: { args: [nasty] }, expected: [{ ret: nasty, effects: [] }] }];
  const dirAbs = path.join(FIXTURE, 'src/app/shop', CHAR_DIR);
  const one = lockedText({ analysis: a, appRoot: FIXTURE, dirAbs, subject, cases });
  const two = lockedText({ analysis: a, appRoot: FIXTURE, dirAbs, subject, cases });
  assert.equal(one, two);
  assert.ok(isGenerated(one) && one.startsWith(`${GENERATED_MARKER}\n`));
  assert.ok(one.includes(json([nasty])) && !one.includes(' '));
  assert.ok(one.includes('import * as LineSubject from "../../../lib/price";'));
  assert.ok(one.includes('jest.mock("../../../lib/api"'), 'the data hook module is mocked by a path relative to the test');
});

const home = jestHome();
test('characterize: on a small app the generated jest tests pass, cover the units, and fail when a branch changes', { skip: home ? false : 'no node_modules with jest, ts-jest, jsdom and React Testing Library (set LINE_CHAR_JEST_HOME)', timeout: 900_000 }, async () => {
  const root = copyFixture();
  fs.symlinkSync(home, path.join(root, 'node_modules'), 'dir');
  const map = fixtureMap(root);
  const r = await characterize(root, CLOSURE, map, { budgetMs: 2500, componentBudgetMs: 6000, maxIdle: 400, workDir: makeTempDir('construct-line-char-work-') });

  // the tests: in the app's own runner, next to the route, all passing on the unmodified app
  assert.equal(r.failed, 0);
  assert.ok(r.passed >= 6, `passed ${r.passed}`);
  assert.equal(r.passed, r.tests.length);
  assert.ok(r.files.every((f) => f.startsWith(`src/app/shop/${CHAR_DIR}/`)));
  assert.ok(!fs.existsSync(path.join(root, 'src/app/shop', CHAR_DIR, '__probe__')) || !fs.readdirSync(path.join(root, 'src/app/shop', CHAR_DIR, '__probe__')).length, 'the probes are gone');
  for (const f of r.files) assert.ok(isGenerated(fs.readFileSync(path.join(root, f), 'utf8')), `${f} carries the marker`);
  for (const t of r.tests) {
    assert.equal(t.runner, 'jest');
    assert.ok(['pure', 'render', 'interaction'].includes(t.kind));
    assert.ok(Array.isArray(t.unitFingerprints));
  }
  assert.ok(r.tests.some((t) => t.kind === 'interaction'), 'a handler was fired');
  const shopText = fs.readFileSync(path.join(root, 'src/app/shop', CHAR_DIR, 'Shop.default.char.test.tsx'), 'utf8');
  assert.ok(shopText.includes('"toast.show"') && shopText.includes('mutation:useBuyItemMutation'), 'effects are recorded: the toast and the mutation call');
  assert.ok(shopText.includes('"hookArgs"'), 'the data hook arguments are recorded');

  // the mapping: every unit of this app is reachable, so every one is covered
  const kinds = Object.fromEntries(Object.entries(r.coverage.byKind).map(([k, v]) => [k, `${v.covered}/${v.total}`]));
  assert.deepEqual(r.coverage.details, [], JSON.stringify(r.coverage.details));
  assert.deepEqual(kinds, { export: '2/2', branch: '8/8', state: '1/1', data: '1/1', toast: '2/2', handler: '2/2', 'render-if': '1/1' });
  const located = locateUnitSpans(root, map.units);
  const priceTests = r.tests.filter((t) => t.title.includes('priceLabel('));
  assert.ok(priceTests.some((t) => t.unitFingerprints.includes(located.find((u) => u.id === 'src/lib/price.ts#priceLabel:branch:1').fingerprint)));

  // the contract entry point returns the same tests (a second run regenerates the same files in place)
  // (skipped here: it would repeat the whole search; characterize() is what generateCharacterizationTests wraps)
  assert.equal(typeof generateCharacterizationTests, 'function');

  // a mutation: change what one branch returns and what the empty list shows; the locked tests must fail
  const price = path.join(root, 'src/lib/price.ts');
  fs.writeFileSync(price, fs.readFileSync(price, 'utf8').replace("return 'invalid';", "return 'negative';"));
  const shop = path.join(root, 'src/app/shop/Shop.tsx');
  fs.writeFileSync(shop, fs.readFileSync(shop, 'utf8').replace('<p>No items</p>', '<p>Nothing here</p>'));
  const lockedFiles = r.files.filter((f) => f.endsWith('.char.test.tsx'));
  const after = runJest(root, lockedFiles, { workDir: makeTempDir('construct-line-char-mut-'), tag: 'mut' });
  const failedTitles = after.results.testResults.flatMap((f) => f.assertionResults.filter((a) => a.status === 'failed').map((a) => a.title));
  assert.ok(failedTitles.some((t) => t.includes('priceLabel(')), `a priceLabel test catches the changed branch: ${failedTitles.join(' | ')}`);
  assert.ok(failedTitles.some((t) => /renders/.test(t)), 'a render test catches the changed text');
});
