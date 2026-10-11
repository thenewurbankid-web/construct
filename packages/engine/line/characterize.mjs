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
import { createTransaction } from '../transactionalWriter.mjs';
import { analyzeClosure } from './characterize/analyze.mjs';
import { CHAR_DIR, PROBE_DIR, RUNTIME_FILE, runtimeText, probeText, lockedText, scenarioTitle, testKind, isGenerated } from './characterize/emit.mjs';
import { locateUnitSpans, unitCoverage, unitsTouched } from './characterize/unitCoverage.mjs';

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
 * @property {number} [budgetMs] Search time per subject (default 20 s; components get `componentBudgetMs`).
 * @property {number} [componentBudgetMs] Search time per component or hook subject (default 60 s).
 * @property {number} [maxTests] Most tests kept per subject (default 150).
 * @property {string} [resumeFrom] The workDir of an earlier run: its search state is continued instead of starting over.
 * @property {number} [maxIdle] Stop a subject's search after this many runs in a row reach nothing new (default 3000 pure, 2500 others).
 * @property {number} [roundMs] Longest search round per subject in one jest process (default 45 s); later rounds resume.
 * @property {number} [seed] Sampling seed (default 7).
 * @property {string} [workDir] Folder for the probes' input and output (default a fresh temp folder).
 * @property {string} [dir] App-relative folder for the tests (default the route entry's folder).
 * @property {(subject: object) => boolean} [only] Characterize only the subjects this accepts.
 * @property {(line: string) => void} [log]
 * @property {number} [maxWorkers] Jest workers (default 2).
 */

const posix = (p) => p.split(path.sep).join('/');

function jestBin(appRoot) {
  const candidates = [path.join(appRoot, 'node_modules/jest/bin/jest.js'), path.join(appRoot, 'node_modules/.bin/jest')];
  const found = candidates.find((c) => fs.existsSync(c));
  if (!found) throw new Error(`No jest found in ${appRoot}/node_modules, so the characterization tests cannot run there; install the app's dependencies first.`);
  return found;
}

/**
 * Run jest in the app on some test files, with coverage collected from `coverFiles`.
 * @param {string} appRoot
 * @param {string[]} testFiles App-relative test paths.
 * @param {{coverFiles?: string[], workDir: string, tag: string, env?: object, maxWorkers?: number, related?: string[], timeoutMs?: number}} o
 * @returns {{status: number|null, results: any, coverage: any, stderr: string}}
 */
export function runJest(appRoot, testFiles, o) {
  const covDir = path.join(o.workDir, `cov-${o.tag}`);
  const resFile = path.join(o.workDir, `res-${o.tag}.json`);
  fs.rmSync(covDir, { recursive: true, force: true });
  fs.rmSync(resFile, { force: true });
  const bin = jestBin(appRoot);
  const args = [
    ...(o.related ? ['--findRelatedTests', ...o.related] : ['--runTestsByPath', ...testFiles]),
    '--ci', '--watchman=false', `--maxWorkers=${o.maxWorkers ?? 2}`,
    '--json', `--outputFile=${resFile}`,
  ];
  if (o.coverFiles) {
    args.push('--coverage', '--coverageReporters=json', `--coverageDirectory=${covDir}`, '--coverageThreshold={}');
    for (const f of o.coverFiles) args.push(`--collectCoverageFrom=${f}`);
  }
  const r = spawnSync(bin.endsWith('.js') ? process.execPath : bin, bin.endsWith('.js') ? [bin, ...args] : args, {
    cwd: appRoot,
    encoding: 'utf8',
    // a search over a large page keeps many renders' worth of state; give each worker room (two workers on a 15 GB box)
    env: { ...process.env, CI: '1', LINE_CHAR_DIR: o.workDir, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --max-old-space-size=4096`.trim(), ...(o.env ?? {}) },
    timeout: o.timeoutMs ?? 3_600_000,
    maxBuffer: 256 * 1024 * 1024,
  });
  const read = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
  return { status: r.status, results: read(resFile), coverage: o.coverFiles ? read(path.join(covDir, 'coverage-final.json')) : null, stderr: String(r.stderr ?? '').slice(-20000) };
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
 * @returns {Promise<{tests: CharTest[], coverage: import('./characterize/unitCoverage.mjs').UnitCoverage, files: string[], subjects: object[], stats: object, dropped: object[], workDir: string, passed: number, failed: number}>}
 *   `dropped` lists each test that did not reproduce on its second run (removed, with the reason); `passed`/`failed` are
 *   the final jest run's counts.
 */
export async function characterize(appRoot, closure, map, opts = {}) {
  const log = opts.log ?? (() => {});
  const workDir = opts.workDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'line-char-'));
  fs.mkdirSync(workDir, { recursive: true });
  const analysis = analyzeClosure(appRoot, closure);
  const subjects = analysis.subjects.filter((s) => (opts.only ? opts.only(s) : true));
  const charRel = posix(path.join(routeDirOf(appRoot, closure, opts), CHAR_DIR));
  const charAbs = path.join(appRoot, charRel);
  const probeAbs = path.join(charAbs, PROBE_DIR);
  const coverFiles = closure.files.map((f) => posix(path.isAbsolute(f) ? path.relative(appRoot, f) : f));
  const located = locateUnitSpans(appRoot, map.units);
  const budget = (s) => (s.kind === 'pure' ? opts.budgetMs ?? 20_000 : opts.componentBudgetMs ?? 60_000);
  log(`characterize: ${subjects.length} subjects, ${located.length} units, tests in ${charRel}`);

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

  // 2. search
  const probeRel = (s, mode) => posix(path.join(charRel, PROBE_DIR, `${s.id}.${mode}.test.tsx`));
  const files = [[posix(path.join(charRel, RUNTIME_FILE)), runtimeText()]];
  for (const s of subjects) {
    files.push([probeRel(s, 'fuzz'), probeText({ analysis, appRoot, dirAbs: probeAbs, subject: s, mode: 'fuzz', timeoutMs: budget(s) + 300_000 })]);
  }
  writeOwnedTests(appRoot, charRel, files);
  // the search runs in rounds of at most `roundMs` per subject, each a fresh jest process resuming the last round's
  // state; a subject stops when a round ends because nothing new was reached for `maxIdle` runs, when a round gains
  // nothing, or when its budget is spent
  const chosen = new Map();
  const stats = { subjects: {} };
  const spent = new Map(subjects.map((s) => [s.id, 0]));
  const roundMs = new Map(subjects.map((s) => [s.id, opts.roundMs ?? 45_000]));
  let active = subjects.slice();
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
    fuzzRun = runJest(appRoot, active.map((s) => probeRel(s, 'fuzz')), { coverFiles, workDir, tag: `fuzz${round}`, maxWorkers: opts.maxWorkers });
    const next = [];
    for (const s of active) {
      let out = null;
      try { out = JSON.parse(fs.readFileSync(path.join(workDir, `${s.id}.fuzz.out.json`), 'utf8')); } catch { out = null; }
      if (!out) {
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
  if (!chosen.size) throw new Error(`The search probes did not run in ${appRoot}: ${fuzzRun?.stderr.slice(-2000)}`);

  // 3. record
  const recorded = subjects.filter((s) => chosen.get(s.id)?.length);
  const recFiles = [];
  for (const s of recorded) {
    fs.writeFileSync(path.join(workDir, `${s.id}.record.in.json`), JSON.stringify({ ...baseInput(s), scenarios: chosen.get(s.id) }));
    recFiles.push([probeRel(s, 'record'), probeText({ analysis, appRoot, dirAbs: probeAbs, subject: s, mode: 'record', timeoutMs: 1_800_000 })]);
  }
  writeOwnedTests(appRoot, charRel, recFiles);
  log('characterize: recording');
  runJest(appRoot, recorded.map((s) => probeRel(s, 'record')), { coverFiles, workDir, tag: 'record', maxWorkers: opts.maxWorkers });

  // 4. lock
  const cases = new Map();
  for (const s of recorded) {
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
  const lockedRel = (s) => posix(path.join(charRel, `${s.id}.char.test.tsx`));
  const cleanup = [...subjects.map((s) => [probeRel(s, 'fuzz'), null]), ...recorded.map((s) => [probeRel(s, 'record'), null])];
  const dropped = [];
  let final = null;
  for (let round = 0; round < 4; round++) {
    const lockFiles = [];
    for (const s of recorded) {
      const list = cases.get(s.id);
      lockFiles.push([lockedRel(s), list?.length ? lockedText({ analysis, appRoot, dirAbs: charAbs, subject: s, cases: list }) : null]);
    }
    writeOwnedTests(appRoot, charRel, round === 0 ? [...lockFiles, ...cleanup] : lockFiles);
    // 5. verify
    const live = recorded.filter((s) => cases.get(s.id)?.length);
    log(`characterize: verifying (round ${round + 1})`);
    final = runJest(appRoot, live.map(lockedRel), { coverFiles, workDir, tag: `verify${round}`, maxWorkers: opts.maxWorkers });
    const outcomes = testOutcomes(final.results);
    let changed = false;
    for (const s of live) {
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
    }
    if (!changed) break;
  }

  /** @type {CharTest[]} */
  const tests = [];
  for (const s of recorded) for (const c of cases.get(s.id) ?? []) tests.push({ file: lockedRel(s), runner: 'jest', kind: testKind(s, c.scenario), unitFingerprints: c.units, title: c.title });
  const coverage = unitCoverage({ root: appRoot, units: located }, final?.coverage ?? {}, { appRoot });
  const written = [posix(path.join(charRel, RUNTIME_FILE)), ...recorded.filter((s) => cases.get(s.id)?.length).map(lockedRel)];
  return { tests, coverage, files: written, subjects, stats, dropped, workDir, passed: final?.results?.numPassedTests ?? 0, failed: final?.results?.numFailedTests ?? 0 };
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
