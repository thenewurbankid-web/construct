// Line Import v2, Fix 3 (speed): the content-hash cache under <folder>/line/cache/ (packages/engine/line/importV2/cache.mjs),
// layered into importLoopDisk.mjs (the logic map per file) and characterize.mjs's entry (the analysis, each subject's
// cases, each locked test file's coverage). A warm run reuses it and gives the same result; editing one file re-runs only
// what depends on it. The jest part needs a node_modules with jest (LINE_CHAR_JEST_HOME) and is skipped without one.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { jestHome, NO_JEST_HOME } from '../test-utils/jestHome.mjs';
import { createLineCache, createDepHasher, hashOf } from '../packages/engine/line/importV2/cache.mjs';
import { createLogicOnDisk } from '../packages/engine/line/importLoopDisk.mjs';
import { characterize, locateUnitSpans, mergeCoverage, jestRunnerFor, runJest } from '../packages/engine/line/characterize.mjs';
import { buildLogicMap } from '../packages/engine/line/logicMap.mjs';
import { runCharTests } from '../packages/engine/line/importVerify.mjs';
import { characterizeBudgets } from '../packages/engine/line/importAgentDisk.mjs';

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/line-char-app');
const FILES = ['src/app/shop/page.tsx', 'src/app/shop/Shop.tsx', 'src/lib/price.ts', 'src/lib/api.ts', 'src/lib/toast.ts'];
const CLOSURE = { files: FILES, routes: [{ entry: 'src/app/shop/page.tsx' }] };

function copyFixture() {
  const dir = makeTempDir('construct-line-cache-');
  fs.cpSync(FIXTURE, dir, { recursive: true });
  return dir;
}
const touch = (root, rel) => fs.appendFileSync(path.join(root, rel), '\n// edited\n');

test('cache: a file\'s deps hash covers what it imports, so an edit invalidates the file and its importers only', () => {
  const root = copyFixture();
  const before = createDepHasher(root);
  assert.deepEqual(before.depsOf('src/app/shop/page.tsx'), ['src/app/shop/Shop.tsx', 'src/app/shop/page.tsx', 'src/lib/api.ts', 'src/lib/price.ts', 'src/lib/toast.ts']);
  const was = Object.fromEntries(FILES.map((f) => [f, before.depsHash(f)]));
  touch(root, 'src/lib/toast.ts');
  const after = createDepHasher(root);
  const changed = FILES.filter((f) => after.depsHash(f) !== was[f]).sort();
  assert.deepEqual(changed, ['src/app/shop/Shop.tsx', 'src/app/shop/page.tsx', 'src/lib/toast.ts']);
});

test('cache: entries are Line state under line/cache, written through the writer, counted as hits and misses', () => {
  const root = copyFixture();
  const c = createLineCache(root);
  assert.equal(c.get('analysis', 'k1'), null);
  c.put('analysis', 'k1', { a: 1 });
  assert.deepEqual(c.get('analysis', 'k1'), { a: 1 });
  assert.ok(fs.existsSync(path.join(root, 'line/cache/analysis/k1.json')));
  assert.deepEqual(c.stats.analysis, { hits: 1, misses: 1 });
  assert.notEqual(hashOf('a', 'b'), hashOf('ab'));
});

test('cache: the logic map is rebuilt from cached units with the same result; an edited file is the only miss', async () => {
  const root = copyFixture();
  const lines = [];
  const logic = createLogicOnDisk(root, 'src', { log: (l) => lines.push(l) });
  const closure = { appRoot: root, routes: [], files: FILES, external: [] };
  const cold = await logic.buildMap(root, 'src', closure);
  const warm = await logic.buildMap(root, 'src', closure);
  assert.deepEqual(warm, cold);
  assert.deepEqual(warm, buildLogicMap(root, cold.files), 'the same map as without the cache');
  const n = cold.files.length;
  assert.match(lines[0], new RegExp(`logic-units 0/${n}`));
  assert.match(lines[1], new RegExp(`logic-units ${n}/${n}`));
  touch(root, 'src/lib/price.ts');
  await logic.buildMap(root, 'src', closure);
  assert.match(lines[2], new RegExp(`logic-units ${n - 1}/${n}`), 'only the edited file is mapped again');
  const off = createLogicOnDisk(root, 'src', { cache: false, log: (l) => lines.push(l) });
  await off.buildMap(root, 'src', closure);
  assert.doesNotMatch(lines[3], /cache/);
});

test('cache: coverage maps add up per counter', () => {
  const a = { '/x.ts': { path: '/x.ts', statementMap: { 0: {}, 1: {} }, s: { 0: 1, 1: 0 }, f: { 0: 1 }, b: { 0: [1, 0] } } };
  const b = { '/x.ts': { path: '/x.ts', statementMap: { 0: {}, 1: {} }, s: { 0: 0, 1: 2 }, f: { 0: 0 }, b: { 0: [0, 3] } }, '/y.ts': { s: { 0: 1 }, f: {}, b: {} } };
  const m = mergeCoverage(a, b);
  assert.deepEqual(m['/x.ts'].s, { 0: 1, 1: 2 });
  assert.deepEqual(m['/x.ts'].b, { 0: [1, 3] });
  assert.ok(m['/y.ts']);
  assert.deepEqual(a['/x.ts'].s, { 0: 1, 1: 0 }, 'the inputs are not changed');
});

const home = jestHome();
test('cache + jest: a warm characterize reuses every subject and runs no jest, with the same tests and coverage; an edit re-runs only its dependants', { skip: home ? false : NO_JEST_HOME, timeout: 900_000 }, async () => {
  const root = copyFixture();
  fs.symlinkSync(home, path.join(root, 'node_modules'), 'dir');
  const map = buildLogicMap(root, FILES);
  const opts = { budgetMs: 2500, componentBudgetMs: 6000, maxIdle: 400 };
  const run = async () => {
    const lines = [];
    const cache = createLineCache(root);
    const r = await characterize(root, CLOSURE, map, { ...opts, cache, log: (l) => lines.push(l), workDir: makeTempDir('construct-line-cache-work-') });
    return { r, lines, cache };
  };
  const view = (r) => ({ tests: r.tests, covered: [...r.coverage.covered].sort(), uncovered: [...r.coverage.uncovered].sort(), reached: [...(r.runtime?.reached ?? [])].sort(), files: r.files, failed: r.failed, passed: r.passed });

  const cold = await run();
  assert.equal(cold.r.failed, 0);
  assert.ok(cold.r.tests.length >= 6, `${cold.r.tests.length} tests`);
  assert.equal(cold.r.stats.cache.reused, 0);
  assert.ok(cold.r.coverage.covered.length > 0);
  assert.ok(cold.r.runtime.reached.length > 0, 'the runtime recorder (G2) reports what the tests reached, beside istanbul');

  const warm = await run();
  assert.deepEqual(view(warm.r), view(cold.r), 'the warm run gives the same tests and coverage');
  assert.equal(warm.r.stats.cache.fresh, 0, 'every subject is reused');
  assert.ok(!warm.lines.some((l) => /searching|recording|verifying/.test(l)), `no jest run: ${warm.lines.join(' | ')}`);
  assert.equal(warm.cache.stats.analysis.hits, 1);

  // edit the toast module: its subject and the components that import it are characterized again; price's are reused
  touch(root, 'src/lib/toast.ts');
  const edited = await run();
  const fresh = Object.entries(edited.r.stats.subjects).filter(([, s]) => !s.cached).map(([id]) => id).sort();
  const reused = Object.entries(edited.r.stats.subjects).filter(([, s]) => s.cached).map(([id]) => id).sort();
  assert.ok(fresh.length > 0 && fresh.every((id) => /^(toast|Shop|page)\./.test(id)), `re-run: ${fresh.join(', ')}`);
  assert.ok(reused.some((id) => id.startsWith('price.')), `reused: ${reused.join(', ')}`);
  assert.ok(!reused.some((id) => /^(toast|Shop|page)\./.test(id)), 'nothing that depends on the edit is reused');
  assert.equal(edited.r.failed, 0);
  assert.deepEqual([...edited.r.coverage.covered].sort(), view(cold.r).covered, 'a comment changes no behaviour, so coverage is the same');
  assert.ok(locateUnitSpans(root, map.units).length === map.units.length);
});

// ------------------------------------------------------------------ an app without jest: jest from LINE_CHAR_JEST_HOME
/** The fixture app with no jest of its own: no jest config, and only its own React (copied from the home, marked). */
function appWithoutJest(jestHomeDir) {
  const root = copyFixture();
  fs.rmSync(path.join(root, 'jest.config.js'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'no-jest-app', private: true, dependencies: { react: '*', 'react-dom': '*' } }));
  for (const name of ['react', 'react-dom']) {
    fs.cpSync(fs.realpathSync(path.join(jestHomeDir, name)), path.join(root, 'node_modules', name), { recursive: true, dereference: true });
  }
  fs.appendFileSync(path.join(root, 'node_modules/react/index.js'), '\nmodule.exports.__lineAppCopy = true;\n');
  return root;
}

test('jest home: an app without jest gets a config in Line\'s state folder, its own React and its path aliases mapped', () => {
  const root = copyFixture();
  fs.rmSync(path.join(root, 'jest.config.js'));
  fs.mkdirSync(path.join(root, 'node_modules/react'), { recursive: true });
  fs.writeFileSync(path.join(root, 'node_modules/react/package.json'), '{"name":"react"}');
  assert.equal(jestRunnerFor(root, { home: null }), null, 'no jest and no home: nothing to run');
  const fakeHome = makeTempDir('construct-line-jesthome-');
  fs.mkdirSync(path.join(fakeHome, 'jest/bin'), { recursive: true });
  fs.writeFileSync(path.join(fakeHome, 'jest/bin/jest.js'), '');
  const state = path.join(root, 'src');
  const r = jestRunnerFor(root, { home: fakeHome, stateRoot: state });
  assert.ok(r);
  assert.equal(r.bin, path.join(fakeHome, 'jest/bin/jest.js'));
  assert.equal(r.config, path.join(state, 'line/jest/jest.config.cjs'), 'the config is Line state');
  assert.ok(!fs.readdirSync(root).some((f) => /^jest\.config\./.test(f)), 'no jest config in the app\'s own files');
  const text = fs.readFileSync(/** @type {string} */ (r.config), 'utf8');
  const config = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  assert.equal(config.moduleNameMapper['^react$'], path.join(root, 'node_modules/react'), 'react is the app\'s own copy');
  assert.equal(config.moduleNameMapper['^@\\/(.*)$'], `${path.join(root, 'src')}/$1`, 'the tsconfig alias');
  assert.deepEqual(config.modulePaths, [fakeHome]);
  assert.equal(config.testEnvironment, path.join(fakeHome, 'jest-environment-jsdom'));
  assert.deepEqual(r.args, ['--config', r.config, '--rootDir', root]);
});

test('jest home + jest: an app without jest is characterized with jest from the home, on its own React', { skip: home ? false : NO_JEST_HOME, timeout: 900_000 }, async () => {
  const root = appWithoutJest(/** @type {string} */ (home));
  const runner = jestRunnerFor(root, { home });
  assert.ok(runner?.home, 'the home runs jest');
  // the app's own React is the one the tests get, even through React Testing Library
  fs.writeFileSync(path.join(root, 'src/react-check.test.tsx'), "import * as RTL from '@testing-library/react';\nimport React from 'react';\ntest('own react', () => { expect(typeof RTL.render).toBe('function'); expect((require('react') as any).__lineAppCopy).toBe(true); expect(React.createElement).toBeDefined(); });\n");
  const check = runJest(root, ['src/react-check.test.tsx'], { workDir: makeTempDir('construct-line-jesthome-check-'), tag: 'check', runner: /** @type {any} */ (runner) });
  assert.equal(check.results?.numPassedTests, 1, check.stderr.slice(-2000));
  fs.rmSync(path.join(root, 'src/react-check.test.tsx'));

  const map = buildLogicMap(root, FILES);
  const r = await characterize(root, CLOSURE, map, { budgetMs: 2500, componentBudgetMs: 6000, maxIdle: 400, runner: /** @type {any} */ (runner), workDir: makeTempDir('construct-line-jesthome-work-') });
  assert.equal(r.failed, 0);
  assert.ok(r.tests.length >= 6, `${r.tests.length} tests`);
  assert.ok(r.coverage.covered.length > 0);
  const runs = runCharTests(root, 'src', r.tests, { jest: runner });
  assert.equal(runs.state, 'pass', runs.detail);
  assert.ok(!fs.existsSync(path.join(root, 'jest.config.js')), 'no jest config was written into the app');
});

test('budgets: the speed defaults stay unless the agent (characterize.budgets) or LINE_CHAR_BUDGETS asks for more, e.g. one cold pass at the old 20/60/45 s', () => {
  assert.deepEqual(characterizeBudgets(undefined, {}), {}, 'none given: the characterizer keeps 10 s / 25 s / 25 s');
  assert.deepEqual(characterizeBudgets({ pureMs: 20_000, componentMs: 60_000, roundMs: 45_000 }, {}), { budgetMs: 20_000, componentBudgetMs: 60_000, roundMs: 45_000 });
  assert.deepEqual(characterizeBudgets(undefined, { LINE_CHAR_BUDGETS: '20,60,45' }), { budgetMs: 20_000, componentBudgetMs: 60_000, roundMs: 45_000 });
  assert.deepEqual(characterizeBudgets({ componentMs: 40_000 }, { LINE_CHAR_BUDGETS: '20,60,45' }), { componentBudgetMs: 40_000 }, 'the agent\'s option wins over the environment');
  assert.deepEqual(characterizeBudgets(undefined, { LINE_CHAR_BUDGETS: 'x,0,-1' }), {}, 'nonsense is ignored');
});
