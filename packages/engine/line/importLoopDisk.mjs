// Line Import v2 -- the import loop's ops on a real project (importLoop.mjs LoopOps), so the Import agent maps,
// characterizes, fits and checks every step on disk with the real Import v2 blocks:
//
//   closure     importV2/route.mjs readRouteFamily (a route: its feature files, and the shared files other routes use
//               too), or the folder's own code files
//   buildMap    logicMap.mjs buildLogicMap: the closure's files still there, plus where moved files land (a route: the
//               folder's library/ and features/<feature>/; a folder: every code file of the folder). A route's shared
//               files are never mapped.
//   compare     logicMap.mjs compareLogicMaps
//   fit         importV2/fit.mjs fitLogic -> FitProposal, and planFitSteps -> the extract steps that land each block
//   characterize characterize.mjs characterize: tests generated in the app's own jest, every one passing on the
//               unmodified app (an app without jest says so in one sentence: there are no tests to run)
//   runTests    importVerify.mjs runCharTests (the app's own runner)
//   behaviour   importVerify.mjs checkBehaviour (core check-change's path-mapped variant)
//
// The baseline map, the baseline sources and the fit are Line state inside the folder (<folder>/line/logic-map.json,
// line/import-baseline.json, line/fit.json), written through Construct's writer (writeLineState); each step's
// ImportLoopState is appended to the plan records, slotted (records.mjs createImportLoopRecorder:
// records/import-loop.jsonl).
//
// The slow stages are cached by content hash under <folder>/line/cache/ (importV2/cache.mjs, through writeLineState):
// each file's logic units, the characterizer's analysis, each subject's cases and each locked test file's coverage, and
// each test file that passed in the app's runner. A second start on unchanged files reuses all of it; a changed file
// invalidates only its own entries and those of the files that import it. `cache: false` turns it off.
import fs from 'node:fs';
import path from 'node:path';
import { LineOpError } from './contract.mjs';
import { createTransaction, writeLineState } from '../transactionalWriter.mjs';
import { aggregateValidation } from '@line/construct-core/registry';
import { enforcersForRoot } from '@line/construct-core/profiles';
import { folderRootOf } from './importUndo.mjs';
import { buildLogicMap, compareLogicMaps, writeLogicMap, readLogicMap, fileUnits } from './logicMap.mjs';
import { readRouteFamily, familyFeature } from './importV2/route.mjs';
import { fitLogic, planFitSteps } from './importV2/fit.mjs';
import { appDependsOn } from './importV2/extract.mjs';
import { FIT_FILE, ATOMS_FILE, assertFitProposal } from './importV2/contract.mjs';
import { breakDownImport } from './importV2/breakdown.mjs';
import { characterize, CHAR_DIR, jestRunnerFor } from './characterize.mjs';
import { runCharTests, checkBehaviour } from './importVerify.mjs';
import { createImportLoopRecorder } from './records.mjs';
import { createLineCache, createDepHasher, charSalt, hashOf } from './importV2/cache.mjs';
import { unresolvedImports, brokenImports } from './importV2/resolve.mjs';
import { listFiles } from '@line/construct-core/profiles/line/checks';
import { stayInPlace } from './import.mjs';

export { readRouteFamily, buildLogicMap };

const CODE = /\.(?:[cm]?[jt]sx?)$/;
const TEST = /\.(test|spec|stories)\.[cm]?[jt]sx?$/;
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'coverage', 'line', CHAR_DIR]);
const BASELINE_FILE = 'line/import-baseline.json';
const lower = (s) => String(s).charAt(0).toLowerCase() + String(s).slice(1);
const asSentence = (s) => { const t = String(s ?? '').trim().replace(/\s+/g, ' '); return /[.?!]$/.test(t) ? t : `${t}.`; };
const toRel = (root, abs) => path.relative(root, abs).split(path.sep).join('/');

/**
 * Write one file under `<folder>/` through Construct's transactional writer with the folder as root; the writer's check
 * refuses it only when it adds a problem for that one file (the "only new problems" rule of applyChange).
 * @param {string} root
 * @param {string} folder
 * @param {string} rel Folder-relative path, such as line/import-plan.json.
 * @param {string} content
 * @returns {void}
 */
export function writeFolderFile(root, folder, rel, content) {
  const fr = folderRootOf(root, folder);
  const key = (v) => `${v.rule}\u0000${v.file}\u0000${v.message}`;
  const txn = createTransaction(fr);
  try {
    txn.writeFile(rel, content);
    const r = txn.commit({
      validate: (shadow) => {
        const files = [rel];
        const before = new Set(aggregateValidation(fr, enforcersForRoot(fr), { files }).violations.map(key));
        const added = aggregateValidation(shadow, enforcersForRoot(shadow), { files }).violations.filter((v) => !before.has(key(v)));
        return { violations: added, ok: !added.some((v) => v.severity === 'error') };
      },
    });
    if (!r.committed) throw new LineOpError(`${rel} could not be saved: ${lower(asSentence(r.violations.find((v) => v.severity === 'error')?.message ?? 'the checks refused it'))}`, 'NOT_SAVED');
  } catch (e) {
    txn.reset();
    if (/** @type {any} */ (e)?.name === 'LineOpError') throw e;
    throw new LineOpError(`${rel} could not be saved on disk.`, 'NOT_SAVED', String(/** @type {any} */ (e)?.message ?? e));
  }
}

/**
 * The code files of a folder (project-relative), without tests, stories, declarations, Line's own state and the
 * generated characterization tests.
 * @param {string} root
 * @param {string} folder
 * @returns {string[]}
 */
export function folderCodeFiles(root, folder) {
  const out = [];
  const visit = (abs, top) => {
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      if (e.name.startsWith('.') || (SKIP_DIRS.has(e.name) && (e.name !== 'line' || top))) continue;
      const p = path.join(abs, e.name);
      if (e.isDirectory()) visit(p, false);
      else if (CODE.test(e.name) && !TEST.test(e.name) && !e.name.endsWith('.d.ts')) out.push(toRel(root, p));
    }
  };
  const abs = path.join(root, folder);
  if (fs.existsSync(abs)) visit(abs, true);
  return out.sort();
}

/** The code files of a list that are still there (closure files are app-relative; JSON and other data have no units). */
const codeFiles = (root, files) => [...new Set(files)].filter((f) => CODE.test(f) && !TEST.test(f) && !f.split('/').includes(CHAR_DIR) && fs.existsSync(path.join(root, f))).sort();

/**
 * The import loop's ops on a real project (importLoop.mjs LoopOps), for one folder.
 * @param {string} root
 * @param {string} folder
 * @param {{recorder?: {record: (state: any) => any}, characterize?: object, characterizeWith?: (root: string, folder: string, closure: any, map: any) => Promise<{tests: any[], sentence: string}>, cache?: boolean, log?: (line: string) => void, breakdown?: Parameters<typeof breakDownImport>[2] | false}} [o]
 *   `characterize`: options for characterize.mjs (budgets, seed; tests pass small ones); `characterizeWith` replaces the
 *   characterizer (a test that brings its own tests); `cache: false` turns the content-hash cache off; `log` hears each
 *   stage's time and the cache's hits. `breakdown`: options for the static breakdown into atoms (importV2/breakdown.mjs;
 *   tests pass the mock converter), `false` turns the step off.
 * @returns {any}
 */
export function createLogicOnDisk(root, folder, o = {}) {
  const recorder = o.recorder ?? createImportLoopRecorder(root);
  const fr = () => folderRootOf(root, folder);
  const files = { 'logic-map': 'line/logic-map.json', baseline: BASELINE_FILE, fit: FIT_FILE, atoms: ATOMS_FILE };
  const load = async (name) => {
    if (name === 'logic-map') return readLogicMap(fr());
    try { return JSON.parse(fs.readFileSync(path.join(root, folder, files[name]), 'utf8')); } catch (e) {
      if (/** @type {any} */ (e)?.code === 'ENOENT') return null;
      throw e;
    }
  };
  const log = o.log ?? (() => {});
  const cacheOn = o.cache !== false;
  const cache = () => (cacheOn ? createLineCache(fr()) : null);
  // A file's logic units depend on its path and its text only.
  const cachedUnits = (c) => (source, rel, renames) => {
    if (!c) return fileUnits(source, rel, renames);
    const key = hashOf('logic-units', rel, source, renames);
    const hit = c.get('logic-units', key);
    if (hit) return hit;
    const units = fileUnits(source, rel, renames);
    c.put('logic-units', key, units);
    return units;
  };
  const timed = async (stage, fn, c = null) => {
    const t0 = Date.now();
    const r = await fn();
    const hits = c ? Object.entries(c.stats).map(([k, v]) => `${k} ${v.hits}/${v.hits + v.misses}`).join(', ') : '';
    log(`${stage}: ${Date.now() - t0} ms${c ? ` (cache hits: ${hits || 'none asked'})` : ''}`);
    return r;
  };
  /** The key of one test file's pass: its text and every in-app file it imports, the characterizer and the app's setup. */
  const passKey = (deps, salt, file) => hashOf(salt, 'jest-pass', file, deps.depsHash(file));
  const passedNow = (c, testFiles) => {
    const deps = createDepHasher(root);
    const salt = hashOf(charSalt(root), jestRun()?.home ?? '');
    for (const file of testFiles) c.put('jest-pass', passKey(deps, salt, file), { ok: true });
  };
  /** runCharTests, skipping the test files that passed before on exactly the same inputs. */
  // jest: the app's own, else $LINE_CHAR_JEST_HOME with a config in the folder's line/jest/ (characterize.mjs jestRunnerFor)
  const jestRun = () => jestRunnerFor(root, { stateRoot: fr() });
  const runTestsCached = (f, tests, { full = false } = {}) => {
    const jr = jestRun();
    const via = jr?.home ? { jest: jr } : {};
    const list = Array.isArray(tests) ? tests : [];
    const c = list.length && jr ? cache() : null;
    if (!c) return runCharTests(root, f, list, via);
    const deps = createDepHasher(root);
    const salt = hashOf(charSalt(root), jestRun()?.home ?? '');
    // `full` (verify): every file runs; a step runs only the files whose inputs changed since they last passed
    const known = full ? new Set() : new Set([...new Set(list.map((t) => t.file))].filter((file) => fs.existsSync(path.join(root, file)) && c.get('jest-pass', passKey(deps, salt, file))));
    const rest = list.filter((t) => !known.has(t.file));
    const r = rest.length ? runCharTests(root, f, rest, via) : null;
    const failedFiles = new Set((r?.failures ?? []).map((x) => x.file));
    for (const file of new Set(rest.map((t) => t.file))) if (!failedFiles.has(file)) c.put('jest-pass', passKey(deps, salt, file), { ok: true });
    if (!r) return { state: 'pass', passed: list.length, failed: 0, total: list.length, failures: [], sentence: `The ${list.length} characterization test${list.length === 1 ? '' : 's'} pass (jest; unchanged since they last passed).` };
    return { ...r, passed: list.length - r.failed, total: list.length, sentence: r.failed ? `${r.failed} of ${list.length} characterization tests fail (jest).` : `The ${list.length} characterization test${list.length === 1 ? '' : 's'} pass (jest).` };
  };
  // Where the import's moves land: for a route only Line's own library/ and features/<feature>/ of the folder (the rest
  // of the folder is other features' code, out of scope); for a folder every code file of it.
  const landing = (f, closure) => (closure?.routes?.length
    ? [...folderCodeFiles(root, `${f}/library`), ...folderCodeFiles(root, `${f}/features/${closure.feature ?? familyFeature(closure.routes[0].route)}`)]
    : folderCodeFiles(root, f));
  const feature = (closure) => (closure?.routes?.length ? closure.feature : path.posix.basename(folder).replace(/[^a-z0-9-]+/gi, '-').toLowerCase() || 'imported');
  return {
    closure: async (_r, f, route, feature) => (route ? readRouteFamily(root, route, feature ? { feature } : {}) : { appRoot: root, routes: [], files: folderCodeFiles(root, f), shared: [], external: [] }),
    // The map now: the closure's files that are still there, and where moved files land.
    buildMap: async (_r, f, closure) => { const c = cache(); return timed('map', () => buildLogicMap(root, codeFiles(root, [...(closure?.files ?? []), ...landing(f, closure)]), { unitsOf: cachedUnits(c) }), c); },
    compare: async (before, after, options = {}) => compareLogicMaps(before, after, options),
    fit: async (_r, f, closure, map) => timed('fit', async () => {
      const c = { appRoot: root, routes: closure?.routes ?? [], ...(closure?.feature ? { feature: closure.feature } : {}), files: closure?.files ?? [], shared: closure?.shared ?? [], external: closure?.external ?? [] };
      const proposal = fitLogic(map, c, { feature: feature(closure) });
      assertFitProposal(proposal, map.units.map((u) => u.fingerprint));
      const planned = planFitSteps(proposal, { folder: f, closure: c });
      // A workflow needs xstate in the app: without it the step is left for a person, said once here, not refused later.
      const noXstate = !appDependsOn(path.join(root, f), 'xstate');
      // A file Import leaves in place (follow-up a: Next.js finds it by its path, or LINE-SHARED would refuse it) is not
      // extracted from either; the skipped list says why in one sentence.
      const stays = (s) => { const rel = `${f}/${s.args.from}`; try { return stayInPlace(rel, fs.readFileSync(path.join(root, rel), 'utf8')); } catch { return null; } };
      const kept = planned.steps.filter((s) => !stays(s));
      const steps = kept.filter((s) => !(noXstate && s.tool === 'line.import.extractWorkflow'));
      const skipped = [...planned.skipped, ...planned.steps.filter((s) => !kept.includes(s)).map((s) => ({ block: s.blocks[0], sentence: /** @type {string} */ (stays(s)) })), ...kept.filter((s) => !steps.includes(s)).map((s) => ({ block: s.blocks[0], sentence: `${s.args.name} stays where it is: the app does not depend on xstate, so a Line workflow would not compile in it.` }))];
      return { proposal, steps, skipped };
    }),
    characterize: async (_r, f, closure, map) => {
      if (o.characterizeWith) return o.characterizeWith(root, f, closure, map);
      const jr = jestRun();
      if (!jr) {
        return { tests: [], sentence: 'The app has no jest installed (and no LINE_CHAR_JEST_HOME is set), so Line cannot write characterization tests; behaviour is checked by the logic map and the behaviour check.' };
      }
      const c = { files: codeFiles(root, closure?.files ?? folderCodeFiles(root, f)), routes: closure?.routes ?? [] };
      const lc = cache();
      const r = await timed('characterize', () => characterize(root, c, map, { dir: f, log, runner: jr, stateRoot: fr(), ...(o.characterize ?? {}), ...(lc ? { cache: lc } : {}) }), lc);
      log(`characterize stages: ${Object.entries(r.stats?.timing ?? {}).map(([k, v]) => `${k} ${v} ms`).join(', ')}`);
      // the tests just passed on these exact files: the baseline run that follows need not run them again
      if (lc && r.failed === 0) passedNow(lc, r.files.filter((x) => TEST.test(x)));
      const dropped = r.dropped.length ? ` ${r.dropped.length} did not reproduce on a second run and were dropped.` : '';
      const reached = r.runtime ? ` (${r.runtime.reached.length} reached at runtime)` : '';
      return { tests: r.tests, coverage: r.coverage, runtime: r.runtime, sentence: `Line wrote ${r.tests.length} characterization test${r.tests.length === 1 ? '' : 's'} in ${r.files.length - 1} file${r.files.length === 2 ? '' : 's'} (jest), covering ${r.coverage.covered.length} of ${map.units.length} logic units${reached}.${dropped}` };
    },
    // The static breakdown (owner, 2026-10-14): each domain function of the fit as atom calls, checked in QuickJS against
    // the original; the parts it leaves untranslated come back as refusals for construct.repair (the agent runs them).
    ...(o.breakdown === false ? {} : { breakdown: async (_r, _f, _closure, fit) => timed('breakdown', () => breakDownImport(root, fit, o.breakdown || {})) }),
    runTests: async (_r, f, tests, how) => timed('tests', () => runTestsCached(f, tests, how)),
    behaviour: async (_r, f, diff) => checkBehaviour(root, diff, (await load('baseline'))?.sources ?? {}, f),
    // Every import of the app still resolves (importV2/resolve.mjs): the specifiers that name no file now and did before
    // the import began. Null when the baseline predates this check (it then says so instead of guessing).
    imports: async () => {
      const b = await load('baseline');
      return Array.isArray(b?.unresolved) ? brokenImports(root, listFiles(root), b.unresolved) : null;
    },
    save: async (name, data) => {
      if (name === 'logic-map') { writeLogicMap(fr(), data); return; }
      // The baseline keeps each file's source, for the behaviour check after the files moved, and the imports that
      // already named no file before the import (the app's own; the imports check reports only new ones).
      const body = name === 'baseline' ? { sources: Object.fromEntries((data.files ?? []).filter((x) => fs.existsSync(path.join(root, x))).map((x) => [x, fs.readFileSync(path.join(root, x), 'utf8')])), unresolved: unresolvedImports(root, listFiles(root)).map(({ file, spec }) => ({ file, spec })) } : data;
      writeLineState(fr(), files[name], `${JSON.stringify(body)}\n`);
    },
    load,
    record: (state) => recorder.record(state),
  };
}
