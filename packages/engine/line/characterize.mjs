// iv2-tests -- Line Import v2, stage "characterize": before anything moves, generate tests in the TARGET app's own runner
// (jest + React Testing Library) that pin down what the route's logic does today, and measure which logic units they
// cover. Contract: docs/line/import-v2/CONTRACT.md (CharTest, UnitCoverage).
//
//   generateCharacterizationTests(appRoot, closure, map)   -> CharTest[]   (writes <route>/__line_characterization__/)
//   characterize(appRoot, closure, map, opts)              -> { tests, coverage, files, subjects, stats }
//   unitCoverage(map, coverageJson)                        -> UnitCoverage
//   measureCoverage(appRoot, map, { tests | related })     -> UnitCoverage of existing tests (the "before" number)
//
// How (no LLM; deterministic for a given seed):
//   1. analyze   the closure's exported functions, hooks and components with the TypeScript checker: input shapes from
//                their declared types, literal pools mined from the code, the data hooks / router / effect objects to
//                mock or watch, the app's own render helper and global hosts (characterize/analyze.mjs)
//   2. search    a probe test per subject runs inside the app's jest with coverage on, samples inputs from the shapes,
//                renders, fires the handlers the render exposes, mutates what reached new code and keeps the smallest
//                set of scenarios that reaches everything reached (characterize/runtime.cjs, `fuzz`)
//   3. record    a second probe replays the chosen scenarios in test order and records what each did: return values,
//                rendered text, form values, data-hook arguments, effects (navigation, toasts, analytics, storage
//                writes, mutations, callbacks), plus which counters each one ran
//   4. lock      one test file per subject replays every scenario and expects exactly that (characterize/emit.mjs,
//                GENERATED_MARKER, testSpecRender's escaping); written through Construct's transactional writer
//   5. verify    run the locked files; a test that does not reproduce is dropped (said, not hidden) and the rest re-run
//                until all pass; the final run's coverage is mapped onto the logic map (characterize/unitCoverage.mjs)
// Pure functions are driven the way packages/ast/pureExportEquivalence.mjs drives them (fast-check style sampling from
// the parameter types, outputs compared), xstate machines are left to engine/testUnitGenerator.mjs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createTransaction, writeLineState } from '../transactionalWriter.mjs';
import { readPathAliases } from '@line/construct-core/route-resolver';
import { analyzeClosure } from './characterize/analyze.mjs';
import { CHAR_DIR, PROBE_DIR, RUNTIME_FILE, runtimeText, probeText, lockedText, scenarioTitle, testKind, isGenerated } from './characterize/emit.mjs';
import { locateUnitSpans, unitCoverage, unitsTouched } from './characterize/unitCoverage.mjs';
import { createDepHasher, charSalt, hashOf } from './importV2/cache.mjs';
import { withRuntimeRecorder, runtimeCoverage } from './graph/runtime/index.mjs';

export { unitCoverage, locateUnitSpans, unitsTouched, fingerprintOf, unitVerdict } from './characterize/unitCoverage.mjs';
export { analyzeClosure, pathnameOfEntry } from './characterize/analyze.mjs';
export { CHAR_DIR } from './characterize/emit.mjs';

/**
 * One generated characterization test (contract: CharTest).
 * @typedef {object} CharTest
 * @property {string} file App-relative path of the test file.
 * @property {'jest'} runner
 * @property {'pure'|'render'|'interaction'|'machine'} kind
 * @property {string[]} unitFingerprints The logic units this test runs.
 * @property {string} title The test's title in the file.
 */

/**
 * @typedef {object} CharacterizeOptions
 * @property {number} [budgetMs] Search time per subject (default 10 s; components get `componentBudgetMs`; was 20 s before the speed fix, which measured the same unit coverage on max-ai-ui /opportunity).
 * @property {number} [componentBudgetMs] Search time per component or hook subject (default 25 s; was 60 s).
 * @property {number} [maxTests] Most tests kept per subject (default 150).
 * @property {string} [resumeFrom] The workDir of an earlier run: its search state is continued instead of starting over.
 * @property {number} [maxIdle] Stop a subject's search after this many runs in a row reach nothing new (default 3000 pure, 2500 others).
 * @property {number} [roundMs] Longest search round per subject in one jest process (default 25 s; was 45 s); later rounds resume.
 * @property {number} [seed] Sampling seed (default 7).
 * @property {string} [workDir] Folder for the probes' input and output (default a fresh temp folder).
 * @property {string} [dir] App-relative folder for the tests (default the route entry's folder).
 * @property {(subject: object) => boolean} [only] Characterize only the subjects this accepts.
 * @property {(line: string) => void} [log]
 * @property {number} [maxWorkers] Jest workers (default 2).
 * @property {ReturnType<typeof jestRunnerFor>} [runner] How jest runs (default jestRunnerFor: the app's own, else $LINE_CHAR_JEST_HOME).
 * @property {boolean} [runtime] Record what the locked tests ran (graph/runtime, G2; default true) and report
 *   `runtime`: runtimeCoverage beside istanbul's `coverage`. Only the verify runs are recorded, not the search.
 * @property {string} [stateRoot] The Line folder whose line/ holds a generated jest config (default the app root).
 * @property {{get: (kind: string, key: string) => any, put: (kind: string, key: string, value: any) => void}} [cache]
 *   The content-hash cache (importV2/cache.mjs createLineCache): the analysis, each subject's kept cases and each locked
 *   test file's coverage are reused while the files they depend on are unchanged, so only what changed runs again.
 * @property {ReturnType<typeof createDepHasher>} [deps] The dependency hasher the cache keys use (default a fresh one).
 */

const posix = (p) => p.split(path.sep).join('/');
const FILE_COVERAGE_REPORTER = fileURLToPath(new URL('./characterize/fileCoverageReporter.cjs', import.meta.url));

/** Istanbul coverage keyed by app-relative path (cache form), or back to absolute paths under `appRoot`. */
function rekeyCoverage(cov, appRoot, toAbs) {
  const out = {};
  for (const [k, v] of Object.entries(cov ?? {})) {
    const key = toAbs ? path.resolve(appRoot, k) : posix(path.isAbsolute(k) ? path.relative(appRoot, k) : k);
    out[key] = { ...v, path: key };
  }
  return out;
}

/**
 * Add istanbul coverage maps (hit counts summed per counter; a file's first map wins when their shapes differ).
 * @param {...Record<string, any>} maps coverage-final.json shaped maps; none is changed.
 * @returns {Record<string, any>}
 */
export function mergeCoverage(...maps) {
  const out = {};
  for (const m of maps) {
    for (const [k, v] of Object.entries(m ?? {})) {
      const had = out[k];
      if (!had) { out[k] = JSON.parse(JSON.stringify(v)); continue; }
      if (Object.keys(had.s ?? {}).length !== Object.keys(v.s ?? {}).length) continue;
      for (const [id, n] of Object.entries(v.s ?? {})) had.s[id] = (had.s[id] ?? 0) + n;
      for (const [id, n] of Object.entries(v.f ?? {})) had.f[id] = (had.f[id] ?? 0) + n;
      for (const [id, arms] of Object.entries(v.b ?? {})) had.b[id] = (had.b[id] ?? arms.map(() => 0)).map((x, i) => x + (arms[i] ?? 0));
    }
  }
  return out;
}

/**
 * How jest runs in an app: the app's own jest, else jest from a configured home (`LINE_CHAR_JEST_HOME`: a node_modules
 * with jest, ts-jest, jest-environment-jsdom and React Testing Library) with a config Line generates in its own state
 * folder (`<stateRoot>/line/jest/jest.config.cjs`, through Construct's writer; never in the app's files): ts-jest,
 * jsdom, the app's tsconfig path aliases, and every package the app has (react, react-dom, ...) mapped to the app's
 * OWN copy, so the tests never run on the home's React. Null when neither is there.
 * @param {string} appRoot
 * @param {{stateRoot?: string, home?: string|null}} [o] `stateRoot`: the Line folder whose line/ holds the config
 *   (default the app root); `home`: the jest home (default $LINE_CHAR_JEST_HOME).
 * @returns {{bin: string, args: string[], home: string|null, config: string|null} | null}
 */
export function jestRunnerFor(appRoot, o = {}) {
  const own = [path.join(appRoot, 'node_modules/jest/bin/jest.js'), path.join(appRoot, 'node_modules/.bin/jest')].find((c) => fs.existsSync(c));
  if (own) return { bin: own, args: [], home: null, config: null };
  const home = o.home === undefined ? process.env.LINE_CHAR_JEST_HOME || null : o.home;
  if (!home || !fs.existsSync(path.join(home, 'jest/bin/jest.js'))) return null;
  const stateRoot = o.stateRoot ?? appRoot;
  const rel = 'line/jest/jest.config.cjs';
  writeLineState(stateRoot, 'line/jest/style-stub.cjs', 'module.exports = {};\n');
  writeLineState(stateRoot, rel, jestHomeConfig(appRoot, home, path.join(stateRoot, 'line/jest/style-stub.cjs')));
  const config = path.join(stateRoot, rel);
  return { bin: path.join(home, 'jest/bin/jest.js'), args: ['--config', config, '--rootDir', appRoot], home, config };
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/**
 * The text of the jest config for an app without jest (jestRunnerFor): every path absolute, nothing read from the app's
 * own jest config.
 * @param {string} appRoot
 * @param {string} home
 * @param {string} styleStub
 * @returns {string}
 */
export function jestHomeConfig(appRoot, home, styleStub) {
  const mapper = { '\\.(css|scss|sass|less)$': styleStub };
  for (const a of readPathAliases(appRoot).aliases) mapper[`^${escapeRe(a.prefix)}(.*)$`] = `${a.target}${a.target.endsWith('/') ? '' : '/'}$1`;
  let pkg = {};
  try { pkg = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8')); } catch { pkg = {}; }
  const named = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {}), ...Object.keys(pkg.peerDependencies ?? {}), 'react', 'react-dom']);
  for (const name of [...named].sort()) {
    const dir = path.join(appRoot, 'node_modules', name);
    if (!fs.existsSync(path.join(dir, 'package.json'))) continue;
    mapper[`^${escapeRe(name)}$`] = dir;
    mapper[`^${escapeRe(name)}/(.*)$`] = `${dir}/$1`;
  }
  const config = {
    rootDir: appRoot,
    testEnvironment: path.join(home, 'jest-environment-jsdom'),
    transform: { '^.+\\.[jt]sx?$': [path.join(home, 'ts-jest'), { diagnostics: false, tsconfig: { jsx: 'react-jsx', esModuleInterop: true, allowJs: true } }] },
    moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
    moduleNameMapper: mapper,
    modulePaths: [home],
    testPathIgnorePatterns: ['/node_modules/'],
  };
  return `// Generated by Construct (Line characterize): jest from ${home} for an app without jest; the app's own packages are mapped to its own copies.\nmodule.exports = ${JSON.stringify(config, null, 2)};\n`;
}

function jestBin(appRoot, runner) {
  const r = runner ?? jestRunnerFor(appRoot);
  if (!r) throw new Error(`No jest found in ${appRoot}/node_modules, so the characterization tests cannot run there; install the app's dependencies first, or set LINE_CHAR_JEST_HOME to a node_modules with jest.`);
  return r;
}

/**
 * Run jest in the app on some test files, with coverage collected from `coverFiles`.
 * @param {string} appRoot
 * @param {string[]} testFiles App-relative test paths.
 * @param {{coverFiles?: string[], workDir: string, tag: string, env?: object, maxWorkers?: number, related?: string[], timeoutMs?: number, byFile?: boolean, runner?: ReturnType<typeof jestRunnerFor>, runtime?: boolean}} o
 *   `runner`: how jest runs (jestRunnerFor; default the app's own jest, else the configured home). `byFile`: also keep
 *   each test file's own coverage (`coverageByFile`, test file path -> istanbul map). `runtime`: also record what ran
 *   (graph/runtime withRuntimeRecorder on the `coverFiles`; istanbul's output is unchanged) into `runtime`.
 * @returns {{status: number|null, results: any, coverage: any, stderr: string, coverageByFile?: Map<string, any>, runtime?: any[]}}
 */
export function runJest(appRoot, testFiles, o) {
  const covDir = path.join(o.workDir, `cov-${o.tag}`);
  const resFile = path.join(o.workDir, `res-${o.tag}.json`);
  fs.rmSync(covDir, { recursive: true, force: true });
  fs.rmSync(resFile, { force: true });
  const runner = jestBin(appRoot, o.runner);
  const bin = runner.bin;
  const args = [
    ...runner.args,
    ...(o.related ? ['--findRelatedTests', ...o.related] : ['--runTestsByPath', ...testFiles]),
    '--ci', '--watchman=false', `--maxWorkers=${o.maxWorkers ?? 2}`,
    '--json', `--outputFile=${resFile}`,
  ];
  if (o.coverFiles) {
    args.push('--coverage', '--coverageReporters=json', `--coverageDirectory=${covDir}`, '--coverageThreshold={}');
    for (const f of o.coverFiles) args.push(`--collectCoverageFrom=${f}`);
  }
  const byFileDir = path.join(o.workDir, `covfile-${o.tag}`);
  if (o.coverFiles && o.byFile) {
    fs.rmSync(byFileDir, { recursive: true, force: true });
    args.push('--reporters=default', `--reporters=${FILE_COVERAGE_REPORTER}`);
  }
  const rtDir = path.join(o.workDir, `rt-${o.tag}`);
  if (o.runtime) fs.mkdirSync(rtDir, { recursive: true });
  const rec = o.runtime ? withRuntimeRecorder(args, { appRoot, files: o.coverFiles ?? [], workDir: rtDir }) : null;
  const argv = rec ? rec.args : args;
  const r = spawnSync(bin.endsWith('.js') ? process.execPath : bin, bin.endsWith('.js') ? [bin, ...argv] : argv, {
    cwd: appRoot,
    encoding: 'utf8',
    // a search over a large page keeps many renders' worth of state; give each worker room (two workers on a 15 GB box)
    env: { ...process.env, CI: '1', LINE_CHAR_DIR: o.workDir, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --max-old-space-size=4096`.trim(), ...(o.coverFiles && o.byFile ? { LINE_CHAR_COVER_BY_FILE: byFileDir } : {}), ...(rec ? rec.env : {}), ...(o.env ?? {}) },
    timeout: o.timeoutMs ?? 3_600_000,
    maxBuffer: 256 * 1024 * 1024,
  });
  const read = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
  /** @type {Map<string, any> | undefined} */
  let coverageByFile;
  if (o.coverFiles && o.byFile) {
    coverageByFile = new Map();
    for (const f of fs.existsSync(byFileDir) ? fs.readdirSync(byFileDir) : []) {
      const e = read(path.join(byFileDir, f));
      if (e?.testFilePath) coverageByFile.set(posix(e.testFilePath), e.coverage);
    }
  }
  return { status: r.status, results: read(resFile), coverage: o.coverFiles ? read(path.join(covDir, 'coverage-final.json')) : null, stderr: String(r.stderr ?? '').slice(-20000), ...(coverageByFile ? { coverageByFile } : {}), ...(rec ? { runtime: rec.read() } : {}) };
}

/** Write (or delete, content null) files under the characterization folder through Construct's transactional writer. */
function writeOwnedTests(appRoot, charRel, files) {
  const txn = createTransaction(appRoot);
  for (const [rel, content] of files) {
    if (content === null) txn.deleteFile(rel);
    else txn.writeFile(rel, content);
  }
  const r = txn.commit({
    validate: () => {
      const violations = [];
      for (const [rel] of files) {
        if (!posix(rel).startsWith(`${charRel}/`)) violations.push({ severity: 'error', rule: 'LINE-CHAR', file: rel, message: `${rel} is outside ${charRel}, the only folder the characterizer writes.` });
        const abs = path.join(appRoot, rel);
        if (fs.existsSync(abs) && !isGenerated(fs.readFileSync(abs, 'utf8'))) violations.push({ severity: 'error', rule: 'LINE-CHAR', file: rel, message: `${rel} exists and was not generated by Construct, so it is not overwritten.` });
      }
      return { violations, ok: violations.length === 0 };
    },
  });
  if (!r.committed) throw new Error(r.violations.map((v) => v.message).join(' '));
}

/**
 * Per-test outcome from jest's --json results: `file::title` -> true (passed), false (did not reproduce: the recorded
 * expectation differs), or the failure text (anything else: a harness problem, which stops the run instead of dropping).
 */
function testOutcomes(results) {
  const out = new Map();
  for (const f of results?.testResults ?? []) {
    for (const a of f.assertionResults ?? []) {
      const msg = (a.failureMessages ?? []).join('\n');
      out.set(`${posix(f.name)}::${a.title}`, a.status === 'passed' ? true : /expect\(received\)\.toEqual\(expected\)/.test(msg) ? false : msg.slice(0, 2000) || 'failed');
    }
    if (f.status === 'failed' && !(f.assertionResults ?? []).length) out.set(`${posix(f.name)}::<suite>`, String(f.message ?? 'the file did not run').slice(0, 2000));
  }
  return out;
}

const routeDirOf = (appRoot, closure, opts) => {
  if (opts.dir) return opts.dir;
  const entry = closure.routes?.[0]?.entry ?? closure.files[0];
  return posix(path.dirname(path.relative(appRoot, path.resolve(appRoot, entry))));
};

/**
 * Generate, record, lock and verify characterization tests for a route closure, and measure unit coverage.
 *
 * @param {string} appRoot Absolute root of the target app (it must have jest installed).
 * @param {{files: string[], routes?: {route?: string, entry: string}[]}} closure The route closure (app-relative files).
 * @param {{root?: string, units: object[]}} map The closure's logic map.
 * @param {CharacterizeOptions} [opts]
 * @returns {Promise<{tests: CharTest[], coverage: import('./characterize/unitCoverage.mjs').UnitCoverage, runtime: any, files: string[], subjects: object[], stats: object, dropped: object[], workDir: string, passed: number, failed: number}>}
 *   `dropped` lists each test that did not reproduce on its second run (removed, with the reason); `passed`/`failed` are
 *   the final jest run's counts.
 */
export async function characterize(appRoot, closure, map, opts = {}) {
  const log = opts.log ?? (() => {});
  const workDir = opts.workDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'line-char-'));
  fs.mkdirSync(workDir, { recursive: true });
  const cache = opts.cache ?? null;
  const deps = cache ? opts.deps ?? createDepHasher(appRoot) : null;
  // jest: the app's own, else the configured home with a config Line writes in its state folder (jestRunnerFor)
  const runner = jestBin(appRoot, opts.runner ?? jestRunnerFor(appRoot, { stateRoot: opts.stateRoot }) ?? undefined);
  const salt = cache ? hashOf(charSalt(appRoot), runner.home ?? '', runner.config ? fs.readFileSync(runner.config, 'utf8') : '') : '';
  const relFile = (f) => posix(path.isAbsolute(f) ? path.relative(appRoot, f) : f);
  /** @type {Record<string, number>} milliseconds per stage */
  const timing = {};
  let t0 = Date.now();
  const timed = (k) => { timing[k] = (timing[k] ?? 0) + (Date.now() - t0); t0 = Date.now(); };

  // 1. analyze (cached by every closure file's content and imports, and the routes)
  const analysisKey = cache && deps ? hashOf(salt, 'analysis', closure.routes ?? [], closure.files.map(relFile).sort().map((f) => [f, deps.depsHash(f)])) : '';
  let analysis = cache ? cache.get('analysis', analysisKey) : null;
  if (!analysis) {
    analysis = analyzeClosure(appRoot, closure);
    if (cache) cache.put('analysis', analysisKey, analysis);
  }
  timed('analyze');
  const subjects = analysis.subjects.filter((s) => (opts.only ? opts.only(s) : true));
  const charRel = posix(path.join(routeDirOf(appRoot, closure, opts), CHAR_DIR));
  const charAbs = path.join(appRoot, charRel);
  const probeAbs = path.join(charAbs, PROBE_DIR);
  const coverFiles = closure.files.map(relFile);
  const located = locateUnitSpans(appRoot, map.units);
  const budget = (s) => (s.kind === 'pure' ? opts.budgetMs ?? 10_000 : opts.componentBudgetMs ?? 25_000);

  // A subject's kept cases are reused while its file and everything that file imports are unchanged (and the options,
  // the characterizer and the app's test setup are the same).
  const subjectKey = (s) => {
    if (!cache || !deps) return '';
    const within = new Set(deps.depsOf(s.file));
    const units = located.filter((u) => within.has(posix(u.file))).map((u) => u.fingerprint).sort();
    return hashOf(salt, 'subject', s, deps.depsHash(s.file), units, opts.seed ?? 7, budget(s), opts.maxTests ?? 150, opts.maxIdle ?? null, opts.roundMs ?? null, analysis.env);
  };
  /** @type {Map<string, {cases: any[], stats: any}>} */
  const reused = new Map();
  for (const s of subjects) {
    const hit = cache ? cache.get('subject', subjectKey(s)) : null;
    if (hit) reused.set(s.id, hit);
  }
  const fresh = subjects.filter((s) => !reused.has(s.id));
  log(`characterize: ${subjects.length} subjects (${reused.size} unchanged and reused), ${located.length} units, tests in ${charRel}`);

  const baseInput = (s) => ({
    subject: s,
    shapes: analysis.shapes,
    pools: analysis.pools,
    hooks: Object.assign({}, ...analysis.env.hookModules.map((m) => m.hooks)),
    searchKeys: analysis.env.searchKeys,
    paramKeys: analysis.env.paramKeys,
    storageKeys: analysis.env.storageKeys,
    seed: opts.seed ?? 7,
    rootDir: appRoot,
  });

  // 2. search (only the subjects the cache does not hold)
  const probeRel = (s, mode) => posix(path.join(charRel, PROBE_DIR, `${s.id}.${mode}.test.tsx`));
  const files = [[posix(path.join(charRel, RUNTIME_FILE)), runtimeText()]];
  for (const s of fresh) {
    files.push([probeRel(s, 'fuzz'), probeText({ analysis, appRoot, dirAbs: probeAbs, subject: s, mode: 'fuzz', timeoutMs: budget(s) + 300_000 })]);
  }
  writeOwnedTests(appRoot, charRel, files);
  // the search runs in rounds of at most `roundMs` per subject, each a fresh jest process resuming the last round's
  // state; a subject stops when a round ends because nothing new was reached for `maxIdle` runs, when a round gains
  // nothing, or when its budget is spent
  const chosen = new Map();
  const stats = { subjects: {}, timing, cache: cache ? { reused: reused.size, fresh: fresh.length } : null };
  for (const [id, r] of reused) stats.subjects[id] = { ...r.stats, cached: true };
  const spent = new Map(fresh.map((s) => [s.id, 0]));
  const roundMs = new Map(fresh.map((s) => [s.id, opts.roundMs ?? 25_000]));
  let active = fresh.slice();
  let fuzzRun = null;
  for (let round = 0; active.length; round++) {
    for (const s of active) {
      const statePath = path.join(workDir, `${s.id}.fuzz.out.json.state.json`);
      // round 0 may continue an earlier characterization's search (`resumeFrom`, its workDir): iterating accumulates
      const earlier = round === 0 && opts.resumeFrom ? path.join(opts.resumeFrom, `${s.id}.fuzz.out.json.state.json`) : null;
      const from = round > 0 ? statePath : earlier;
      const resume = from && fs.existsSync(from) ? JSON.parse(fs.readFileSync(from, 'utf8')) : undefined;
      const ms = Math.min(roundMs.get(s.id), budget(s) - spent.get(s.id));
      spent.set(s.id, spent.get(s.id) + ms);
      fs.writeFileSync(path.join(workDir, `${s.id}.fuzz.in.json`), JSON.stringify({ ...baseInput(s), budgetMs: ms, maxIdle: opts.maxIdle ?? (s.kind === 'pure' ? 3000 : 2500), maxTests: opts.maxTests ?? 150, seed: (opts.seed ?? 7) + round, resume }));
    }
    log(`characterize: searching, round ${round + 1} (${active.length} subjects)`);
    fuzzRun = runJest(appRoot, active.map((s) => probeRel(s, 'fuzz')), { coverFiles, workDir, tag: `fuzz${round}`, maxWorkers: opts.maxWorkers, runner });
    const next = [];
    const outcomes = testOutcomes(fuzzRun.results);
    for (const s of active) {
      let out = null;
      try { out = JSON.parse(fs.readFileSync(path.join(workDir, `${s.id}.fuzz.out.json`), 'utf8')); } catch { out = null; }
      if (!out) {
        // a probe whose file did not even load (a transform or import error in the app) fails the same way every time:
        // said once, and kept (no cases) so an unchanged subject is not searched again
        const abs = posix(path.join(appRoot, probeRel(s, 'fuzz')));
        const real = (() => { try { return posix(fs.realpathSync(path.join(appRoot, probeRel(s, 'fuzz')))); } catch { return abs; } })();
        const loadError = outcomes.get(`${abs}::<suite>`) ?? outcomes.get(`${real}::<suite>`);
        if (typeof loadError === 'string') { stats.subjects[s.id] = { notLoaded: loadError.split('\n').find((l) => l.trim())?.trim().slice(0, 300) ?? 'the probe did not load' }; continue; }
        // a round that ran out of memory is retried once more with half the time, from the last saved state
        stats.subjects[s.id] ??= { error: 'the search did not finish' };
        if (roundMs.get(s.id) > 10_000 && spent.get(s.id) < budget(s)) { roundMs.set(s.id, roundMs.get(s.id) / 2); next.push(s); }
        continue;
      }
      fs.rmSync(path.join(workDir, `${s.id}.fuzz.out.json`), { force: true });
      stats.subjects[s.id] = { runs: out.runs, kept: out.kept, chosen: out.scenarios.length, reached: out.reached, rounds: round + 1, stoppedBy: out.stoppedBy };
      chosen.set(s.id, out.scenarios);
      if (out.stoppedBy === 'budget' && out.gained > 0 && spent.get(s.id) < budget(s)) next.push(s);
    }
    active = next;
  }
  // nothing at all to characterize (no subject searched, none reused): the probes themselves did not run
  if (fresh.length && !chosen.size && ![...reused.values()].some((r) => r.cases?.length)) throw new Error(`The search probes did not run in ${appRoot}: ${fuzzRun?.stderr.slice(-2000)}`);
  timed('search');

  // 3. record
  const recordedFresh = fresh.filter((s) => chosen.get(s.id)?.length);
  const recFiles = [];
  for (const s of recordedFresh) {
    fs.writeFileSync(path.join(workDir, `${s.id}.record.in.json`), JSON.stringify({ ...baseInput(s), scenarios: chosen.get(s.id) }));
    recFiles.push([probeRel(s, 'record'), probeText({ analysis, appRoot, dirAbs: probeAbs, subject: s, mode: 'record', timeoutMs: 1_800_000 })]);
  }
  if (recFiles.length) {
    writeOwnedTests(appRoot, charRel, recFiles);
    log('characterize: recording');
    runJest(appRoot, recordedFresh.map((s) => probeRel(s, 'record')), { coverFiles, workDir, tag: 'record', maxWorkers: opts.maxWorkers, runner });
  }
  timed('record');

  // 4. lock
  const cases = new Map();
  for (const s of recordedFresh) {
    let out = null;
    try { out = JSON.parse(fs.readFileSync(path.join(workDir, `${s.id}.record.out.json`), 'utf8')); } catch { out = null; }
    if (!out) continue;
    const list = [];
    chosen.get(s.id).forEach((sc, i) => {
      const r = out.results[i];
      if (!r || r.obs.some((o) => o.missing)) return;
      list.push({ scenario: sc, expected: r.obs, units: unitsTouched(located, r.hits, out.maps) });
    });
    list.forEach((c, i) => { c.title = scenarioTitle(s, c.scenario, i); });
    if (list.length) cases.set(s.id, list);
  }
  for (const [id, r] of reused) if (r.cases?.length) cases.set(id, r.cases);
  const recorded = subjects.filter((s) => cases.has(s.id) || recordedFresh.includes(s));
  const lockedRel = (s) => posix(path.join(charRel, `${s.id}.char.test.tsx`));
  const cleanup = [...fresh.map((s) => [probeRel(s, 'fuzz'), null]), ...recordedFresh.map((s) => [probeRel(s, 'record'), null])];
  const dropped = [];
  let final = null;
  // a locked file whose text and inputs are unchanged keeps its cached coverage and is not run again
  const covKey = (s, text) => (cache && deps ? hashOf(salt, 'jest-cov', text, deps.depsHash(s.file)) : '');
  /** @type {Map<string, any>} subject id -> its locked file's cached coverage (app-relative keys) */
  const cachedCov = new Map();
  /** @type {Map<string, {text: string, cov: any}>} subject id -> what this run measured, for the cache */
  const ranCov = new Map();
  for (let round = 0; round < 4; round++) {
    const lockFiles = [];
    const texts = new Map();
    for (const s of recorded) {
      const list = cases.get(s.id);
      const text = list?.length ? lockedText({ analysis, appRoot, dirAbs: charAbs, subject: s, cases: list }) : null;
      texts.set(s.id, text);
      lockFiles.push([lockedRel(s), text]);
    }
    writeOwnedTests(appRoot, charRel, round === 0 ? [...lockFiles, ...cleanup] : lockFiles);
    // 5. verify (only the locked files the cache does not hold)
    const live = recorded.filter((s) => cases.get(s.id)?.length);
    if (cache && round === 0) {
      for (const s of live) {
        const hit = reused.has(s.id) ? cache.get('jest-cov', covKey(s, texts.get(s.id))) : null;
        if (hit?.coverage) cachedCov.set(s.id, hit);
      }
    }
    const run = live.filter((s) => !cachedCov.has(s.id));
    if (!run.length) break;
    log(`characterize: verifying (round ${round + 1}, ${run.length} of ${live.length} test files)`);
    final = runJest(appRoot, run.map(lockedRel), { coverFiles, workDir, tag: `verify${round}`, maxWorkers: opts.maxWorkers, byFile: Boolean(cache), runner, runtime: opts.runtime !== false });
    const outcomes = testOutcomes(final.results);
    let changed = false;
    ranCov.clear();
    for (const s of run) {
      const abs = posix(path.join(appRoot, lockedRel(s)));
      const real = (() => { try { return posix(fs.realpathSync(path.join(appRoot, lockedRel(s)))); } catch { return abs; } })();
      const outcome = (t) => outcomes.get(`${abs}::${t}`) ?? outcomes.get(`${real}::${t}`);
      const suite = outcome('<suite>');
      if (typeof suite === 'string' || [...outcomes.keys()].every((k) => !k.startsWith(`${abs}::`) && !k.startsWith(`${real}::`))) {
        throw new Error(`The characterization tests for ${s.id} could not run in the app (${lockedRel(s)}): ${typeof suite === 'string' ? suite : 'jest did not report the file'}`);
      }
      const harness = cases.get(s.id).map((c) => outcome(c.title)).find((o) => typeof o === 'string');
      if (harness) throw new Error(`A characterization test for ${s.id} failed for a reason other than its recorded behaviour, so nothing was dropped: ${harness}`);
      const keep = cases.get(s.id).filter((c) => outcome(c.title) !== false);
      for (const c of cases.get(s.id)) if (outcome(c.title) === false) dropped.push({ subject: s.id, title: c.title, why: 'It did not reproduce what was recorded on a second run.' });
      if (keep.length !== cases.get(s.id).length) { changed = true; keep.forEach((c, i) => { c.title = scenarioTitle(s, c.scenario, i); }); cases.set(s.id, keep); }
      const cov = final.coverageByFile?.get(abs) ?? final.coverageByFile?.get(real);
      // this file's runtime records: the ones its tests named ("<file> > <test>"), and those no test named (module loads)
      const base = `${path.basename(lockedRel(s))} > `;
      const runtime = (final.runtime ?? []).filter((x) => !x.test || String(x.test).startsWith(base));
      if (cov) ranCov.set(s.id, { text: /** @type {string} */ (texts.get(s.id)), cov: rekeyCoverage(cov, appRoot, false), runtime });
    }
    if (!changed) break;
  }
  timed('verify');

  /** @type {CharTest[]} */
  const tests = [];
  for (const s of recorded) for (const c of cases.get(s.id) ?? []) tests.push({ file: lockedRel(s), runner: 'jest', kind: testKind(s, c.scenario), unitFingerprints: c.units, title: c.title });
  // With the cache, coverage is the sum of each locked file's own coverage (cached or measured now), so a warm run
  // gives the same number as the cold one; when a file's own coverage is missing, the last jest run's total stands in.
  let coverageJson = final?.coverage ?? {};
  /** @type {any[]} the runtime records of the locked tests (G2) */
  let records = final?.runtime ?? [];
  const liveNow = recorded.filter((s) => cases.get(s.id)?.length);
  if (cache) {
    const ranAll = liveNow.filter((s) => !cachedCov.has(s.id)).every((s) => ranCov.has(s.id));
    const parts = liveNow.map((s) => cachedCov.get(s.id)?.coverage ?? ranCov.get(s.id)?.cov).filter(Boolean);
    const merged = ranAll ? mergeCoverage(...parts) : mergeCoverage(final?.coverage ? rekeyCoverage(final.coverage, appRoot, false) : {}, ...[...cachedCov.values()].map((v) => v.coverage));
    records = [...[...cachedCov.values()].flatMap((v) => v.runtime ?? []), ...(ranAll ? [...ranCov.values()].flatMap((v) => v.runtime) : final?.runtime ?? [])];
    coverageJson = rekeyCoverage(merged, appRoot, true);
    // keep what this run found: every searched subject's cases (an empty list too: nothing to search again), and the
    // coverage of every locked file that ran in full
    for (const s of fresh) if (!stats.subjects[s.id]?.error) cache.put('subject', subjectKey(s), { cases: cases.get(s.id) ?? [], stats: stats.subjects[s.id] ?? {} });
    for (const [id, r] of ranCov) {
      const s = subjects.find((x) => x.id === id);
      if (s && cases.get(id)?.length) cache.put('jest-cov', covKey(s, r.text), { coverage: r.cov, runtime: r.runtime });
    }
  }
  const coverage = unitCoverage({ root: appRoot, units: located }, coverageJson, { appRoot });
  // what the tests reached at runtime (function level, G2), beside istanbul's statement-level coverage
  const runtime = opts.runtime === false ? null : runtimeCoverage({ units: map.units }, records);
  timed('coverage');
  const written = [posix(path.join(charRel, RUNTIME_FILE)), ...liveNow.map(lockedRel)];
  const failed = final?.results?.numFailedTests ?? 0;
  return { tests, coverage, runtime, files: written, subjects, stats, dropped, workDir, passed: tests.length - failed, failed };
}

/**
 * The contract's entry point: generate the characterization tests and return them.
 * @param {string} appRoot
 * @param {{files: string[], routes?: {route?: string, entry: string}[]}} closure
 * @param {{units: object[]}} map
 * @param {CharacterizeOptions} [opts]
 * @returns {Promise<CharTest[]>}
 */
export async function generateCharacterizationTests(appRoot, closure, map, opts = {}) {
  return (await characterize(appRoot, closure, map, opts)).tests;
}

/**
 * Unit coverage of tests that already exist: the given test files, or (`related`) every test jest finds related to the
 * closure's files. The "before" number the characterization is measured against.
 * @param {string} appRoot
 * @param {{files: string[]}} closure
 * @param {{units: object[]}} map
 * @param {{tests?: string[], related?: boolean, workDir?: string}} [o]
 * @returns {{coverage: import('./characterize/unitCoverage.mjs').UnitCoverage, passed: number, failed: number, suites: number}}
 */
export function measureCoverage(appRoot, closure, map, o = {}) {
  const workDir = o.workDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'line-char-'));
  const coverFiles = closure.files.map((f) => posix(path.isAbsolute(f) ? path.relative(appRoot, f) : f));
  const r = runJest(appRoot, o.tests ?? [], { coverFiles, workDir, tag: `measure-${Date.now()}`, related: o.related ? coverFiles : undefined });
  return {
    coverage: unitCoverage({ root: appRoot, units: map.units }, r.coverage ?? {}, { appRoot }),
    passed: r.results?.numPassedTests ?? 0,
    failed: r.results?.numFailedTests ?? 0,
    suites: r.results?.numTotalTestSuites ?? 0,
  };
}
