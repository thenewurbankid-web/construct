#!/usr/bin/env node
// Fast pre-merge test subset (#929): the tests a branch can actually break, so an agent can self-check before handing
// the branch to og, who still runs the one full suite (`packages/tools/dev/heavy.sh npm test`) before push.
//
//   node packages/tools/dev/affected-tests.mjs <base-ref> --list   the selection, one line each with why
//   node packages/tools/dev/affected-tests.mjs <base-ref> --run    run it through heavy.sh: one pass/fail/skip line
//                                                                 plus the failing test names (log path for the rest)
//
// Changed files: `git diff --name-only <base>...HEAD` plus uncommitted and untracked files.
// Selected: changed test files; every test (run-tests.mjs `testFiles`, the same universe `npm test` runs) whose static
// import graph reaches a changed file; the guards (tsc-error and api-coverage ratchets always, golden/characterization
// tests when packages/core or packages/engine changed). A changed dependency manifest/lockfile, the test runner, or a
// helper/fixture many tests share prints FULL SUITE ADVISED and selects everything.
//
// The import graph is TypeScript's own (already a dependency): `ts.preProcessFile` lists a file's static imports,
// re-exports, literal dynamic `import()` and `require()`; `ts.resolveModuleName` (bundler resolution) resolves them,
// workspace packages through node_modules and their package.json `exports`. Two cheap extras cover what imports miss:
// a test that names a repo script by path or unique file name (it spawns the CLI) depends on it, and a changed
// non-code file (fixture, JSON, YAML) is depended on by every graph file that mentions its name.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { testFiles, missingInstalls, INSTALL_COMMAND } from './run-tests.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const CODE = /\.(c|m)?(j|t)sx?$/;
const DECL = /\.d\.(c|m)?ts$/;
const TEST_NAME = /\.test\.(c|m)?(j|t)sx?$/;

/** Always selected, whatever changed. */
export const GUARDS = [
  ['test/tsc-error-ratchet.test.mjs', 'guard: tsc-error ratchet (always)'],
  ['test/api-coverage.test.mjs', 'guard: api-coverage ratchet (always)'],
];

/** A change under these selects the golden/characterization tests too. */
export const GOLDEN_TRIGGER = /^packages\/(core|engine)\//;

/** A changed file matching one of these advises the full suite. */
export const FULL_SUITE = [
  [/(^|\/)package\.json$/, 'a package.json changed'],
  [/(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml)$/, 'a lockfile changed'],
  [/^packages\/tools\/dev\/(run-tests\.mjs|heavy\.sh)$/, 'the test runner changed'],
];

/** A changed shared helper/fixture with at least this many dependent tests advises the full suite. */
export const SHARED_THRESHOLD = 20;

/** Shared test infrastructure: test-utils/, any fixtures/ folder, or a non-*.test file inside a test/ folder. */
export function isTestHelper(file) {
  return /^test-utils\//.test(file) || /(^|\/)fixtures\//.test(file) || (/(^|\/)test\//.test(file) && !TEST_NAME.test(file));
}

/** A golden/characterization test: the name says so, or it reads a golden/ folder. */
export function isGoldenTest(file, text = '') {
  return TEST_NAME.test(file) && (/golden|characteri[sz]/i.test(path.basename(file)) || /['"`/]golden['"`/]/.test(text));
}

const sh = (args, cwd) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${(r.stderr || '').trim()}`);
  return r.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
};

/**
 * Files changed on the branch since `base` (merge-base diff), plus uncommitted and untracked ones.
 * @param {string} base
 * @param {string} [root]
 * @returns {string[]} Root-relative, sorted, unique.
 */
export function changedFiles(base, root = ROOT) {
  return [...new Set([
    ...sh(['diff', '--name-only', `${base}...HEAD`], root),
    ...sh(['diff', '--name-only', 'HEAD'], root),
    ...sh(['ls-files', '--others', '--exclude-standard'], root),
  ])].sort();
}

/**
 * The static import graph reachable from `entries`.
 * @param {string} root Repo root.
 * @param {string[]} entries Root-relative files to start from (the tests).
 * @param {{files?: string[]}} [opts] files: every repo file, for resolving a test's spawned-script names.
 * @returns {{deps: Map<string, Set<string>>, text: Map<string, string>}} deps: file -> what it imports (root-relative,
 *   inside the repo, never node_modules); text: each visited file's source.
 */
export function buildGraph(root, entries, { files = [] } = {}) {
  root = fs.realpathSync(root);
  const options = { allowJs: true, resolveJsonModule: true, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, target: ts.ScriptTarget.ES2022 };
  const host = { fileExists: ts.sys.fileExists, readFile: ts.sys.readFile, realpath: ts.sys.realpath, directoryExists: ts.sys.directoryExists, getDirectories: ts.sys.getDirectories };
  const cache = ts.createModuleResolutionCache(root, (s) => s, options);
  const byBase = new Map();
  for (const f of files) { const b = path.basename(f); byBase.set(b, byBase.has(b) ? null : f); }
  const inRepo = (abs) => {
    let p; try { p = fs.realpathSync(abs); } catch { return null; }
    const r = path.relative(root, p).replaceAll(path.sep, '/');
    return r.startsWith('..') || path.isAbsolute(r) || r.split('/').includes('node_modules') ? null : r;
  };
  const deps = new Map(); const text = new Map();
  const queue = [...entries];
  while (queue.length) {
    const f = queue.pop();
    if (deps.has(f)) continue;
    const out = new Set(); deps.set(f, out);
    const abs = path.join(root, f);
    let src; try { src = fs.readFileSync(abs, 'utf8'); } catch { continue; }
    text.set(f, src);
    if (!CODE.test(f)) continue;
    const add = (r) => { if (r && r !== f) { out.add(r); if (!deps.has(r)) queue.push(r); } };
    for (const { fileName } of ts.preProcessFile(src, true, true).importedFiles) {
      const res = ts.resolveModuleName(fileName, abs, options, host, cache).resolvedModule;
      if (!res) continue;
      const r = inRepo(res.resolvedFileName);
      if (!r) continue;
      add(r);
      // A declaration (contract.d.ts next to contract.mjs) stands for the JS beside it, which is what runs.
      if (DECL.test(r)) for (const ext of ['.mjs', '.js', '.cjs']) { const js = r.replace(DECL, ext); if (fs.existsSync(path.join(root, js))) add(js); }
    }
    // A test that names a script (path.join(ROOT, 'packages', 'cli', 'construct.mjs')) runs it as a child process.
    if (TEST_NAME.test(f)) {
      for (const m of src.matchAll(/['"`]([\w@./-]+\.(?:c|m)?(?:j|t)sx?)['"`]/g)) {
        const s = m[1];
        if (s.includes('/')) { for (const base of [path.dirname(abs), root]) { const r = inRepo(path.resolve(base, s)); if (r && fs.statSync(path.join(root, r)).isFile()) { add(r); break; } } }
        else if (byBase.get(s)) add(byBase.get(s));
      }
    }
  }
  return { deps, text };
}

/**
 * Which tests to run for a set of changed files.
 * @param {{changed: string[], tests: string[], deps: Map<string, Set<string>>, text?: Map<string, string>}} input
 * @returns {{full: string[], selected: {file: string, reason: string}[]}} full: why the full suite is advised (empty
 *   when it is not); selected: tests in run order with one reason each (everything when `full` is non-empty).
 */
export function selectTests({ changed, tests, deps, text = new Map() }) {
  const testSet = new Set(tests);
  // Reverse edges: file -> who imports it. Changed non-code files are also "imported" by every graph file naming them.
  const rdeps = new Map();
  const link = (from, to) => { if (!rdeps.has(to)) rdeps.set(to, new Set()); rdeps.get(to).add(from); };
  for (const [f, out] of deps) for (const d of out) link(f, d);
  for (const c of changed) {
    if (CODE.test(c) && deps.has(c)) continue;
    const keys = [c];
    const base = path.basename(c);
    const fx = c.match(/(?:^|\/)fixtures\/([^/]+)\//);
    if (fx) keys.push(`fixtures/${fx[1]}`, `'${fx[1]}'`, `"${fx[1]}"`);
    else if (base.length >= 6 && !CODE.test(c)) keys.push(base);
    for (const [f, src] of text) if (f !== c && keys.some((k) => src.includes(k))) link(f, c);
  }
  // From each changed file, walk importers backwards; the first path found to a test is its reason.
  const reasonOf = new Map();
  const dependents = new Map(); // changed file -> tests reaching it
  for (const c of changed) {
    if (testSet.has(c) && !reasonOf.has(c)) reasonOf.set(c, 'changed test file');
    const seen = new Map([[c, null]]); const queue = [c]; const hit = [];
    while (queue.length) {
      const f = queue.shift();
      for (const p of rdeps.get(f) || []) {
        if (seen.has(p)) continue;
        seen.set(p, f); queue.push(p);
        if (testSet.has(p)) hit.push(p);
      }
    }
    dependents.set(c, hit);
    for (const t of hit) {
      if (reasonOf.has(t)) continue;
      const chain = []; for (let f = seen.get(t); f && f !== c; f = seen.get(f)) chain.push(f);
      reasonOf.set(t, `reaches ${c}${chain.length ? ` (via ${chain.length > 2 ? `${chain[0]} ... ${chain.at(-1)}` : chain.join(' -> ')})` : ''}`);
    }
  }
  for (const [g, why] of GUARDS) if (testSet.has(g) && !reasonOf.has(g)) reasonOf.set(g, why);
  const coreChanged = changed.find((c) => GOLDEN_TRIGGER.test(c));
  if (coreChanged) for (const t of tests) if (!reasonOf.has(t) && isGoldenTest(t, text.get(t))) reasonOf.set(t, `golden/characterization (${coreChanged} changed)`);

  const full = [];
  for (const c of changed) for (const [re, why] of FULL_SUITE) if (re.test(c)) full.push(`${why}: ${c}`);
  for (const c of changed) if (isTestHelper(c) && (dependents.get(c) || []).length >= SHARED_THRESHOLD) full.push(`shared helper/fixture ${c} reaches ${dependents.get(c).length} tests`);
  if (full.length) return { full, selected: tests.map((file) => ({ file, reason: reasonOf.get(file) || 'full suite' })) };
  return { full, selected: tests.filter((t) => reasonOf.has(t)).map((file) => ({ file, reason: reasonOf.get(file) })) };
}

/**
 * Summarize `node --test --test-reporter=tap` output: counts plus failing test names (subtests, not the file wrappers).
 * @param {string} tap
 * @returns {{pass: number, fail: number, skip: number, failing: string[]}}
 */
export function summarizeTap(tap) {
  const n = (k) => Number((tap.match(new RegExp(`^# ${k} (\\d+)$`, 'm')) || [])[1] || 0);
  const failing = [...new Set([...tap.matchAll(/^\s*not ok \d+ - (.+?)(?:\s+#.*)?$/gm)].map((m) => m[1].trim()))];
  return { pass: n('pass'), fail: n('fail'), skip: n('skipped') + n('todo'), failing };
}

function main(argv) {
  const base = argv.find((a) => !a.startsWith('--'));
  if (!base) { process.stderr.write('usage: affected-tests.mjs <base-ref> [--list] [--run]\n'); return 2; }
  const tests = testFiles(ROOT);
  const changed = changedFiles(base, ROOT);
  const all = sh(['ls-files', '-co', '--exclude-standard'], ROOT);
  const { deps, text } = buildGraph(ROOT, tests, { files: all });
  const { full, selected } = selectTests({ changed, tests, deps, text });
  const head = `affected-tests: ${changed.length} changed file(s) since ${base}; ${selected.length} of ${tests.length} test files selected`;
  process.stdout.write(`${head}\n`);
  if (full.length) process.stdout.write(`FULL SUITE ADVISED\n${full.map((s) => `  ${s}`).join('\n')}\n`);
  if (argv.includes('--list') || !argv.includes('--run')) for (const s of selected) process.stdout.write(`  ${s.file}  -- ${s.reason}\n`);
  if (!argv.includes('--run')) return 0;
  const missing = missingInstalls(ROOT);
  if (missing.length) { process.stderr.write(`dependencies missing in: ${missing.join(', ')}; run ${INSTALL_COMMAND}\n`); return 1; }
  if (!selected.length) { process.stdout.write('nothing to run\n'); return 0; }
  const log = path.join(fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'affected-tests-')), 'run.tap');
  const r = spawnSync(path.join(ROOT, 'packages/tools/dev/heavy.sh'),
    [process.execPath, '--test', '--test-concurrency=1', '--test-reporter=tap', ...selected.map((s) => s.file)],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 512 << 20 });
  fs.writeFileSync(log, `${r.stdout || ''}${r.stderr || ''}`);
  const s = summarizeTap(r.stdout || '');
  process.stdout.write(`${s.fail ? 'FAIL' : 'PASS'}  pass ${s.pass}  fail ${s.fail}  skip ${s.skip}  (${selected.length} files; log ${log})\n`);
  for (const f of s.failing.slice(0, 40)) process.stdout.write(`  not ok: ${f}\n`);
  return s.fail || r.status ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
