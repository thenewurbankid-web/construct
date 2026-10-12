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
import fs from 'node:fs';
import path from 'node:path';
import { LineOpError } from './contract.mjs';
import { createTransaction, writeLineState } from '../transactionalWriter.mjs';
import { aggregateValidation } from '@line/construct-core/registry';
import { enforcersForRoot } from '@line/construct-core/profiles';
import { folderRootOf } from './importUndo.mjs';
import { buildLogicMap, compareLogicMaps, writeLogicMap, readLogicMap } from './logicMap.mjs';
import { readRouteFamily, familyFeature } from './importV2/route.mjs';
import { fitLogic, planFitSteps } from './importV2/fit.mjs';
import { appDependsOn } from './importV2/extract.mjs';
import { FIT_FILE, assertFitProposal } from './importV2/contract.mjs';
import { characterize, CHAR_DIR } from './characterize.mjs';
import { runCharTests, checkBehaviour, testRunnerOf } from './importVerify.mjs';
import { createImportLoopRecorder } from './records.mjs';
import { createStateCache } from './importV2/cache.mjs';

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
 * @param {{recorder?: {record: (state: any) => any}, characterize?: object, characterizeWith?: (root: string, folder: string, closure: any, map: any) => Promise<{tests: any[], sentence: string}>}} [o]
 *   `characterize`: options for characterize.mjs (budgets, seed; tests pass small ones); `characterizeWith` replaces the
 *   characterizer (a test that brings its own tests).
 * @returns {any}
 */
export function createLogicOnDisk(root, folder, o = {}) {
  const recorder = o.recorder ?? createImportLoopRecorder(root);
  const fr = () => folderRootOf(root, folder);
  const files = { 'logic-map': 'line/logic-map.json', baseline: BASELINE_FILE, fit: FIT_FILE };
  const load = async (name) => {
    if (name === 'logic-map') return readLogicMap(fr());
    try { return JSON.parse(fs.readFileSync(path.join(root, folder, files[name]), 'utf8')); } catch (e) {
      if (/** @type {any} */ (e)?.code === 'ENOENT') return null;
      throw e;
    }
  };
  // Where the import's moves land: for a route only Line's own library/ and features/<feature>/ of the folder (the rest
  // of the folder is other features' code, out of scope); for a folder every code file of it.
  const landing = (f, closure) => (closure?.routes?.length
    ? [...folderCodeFiles(root, `${f}/library`), ...folderCodeFiles(root, `${f}/features/${familyFeature(closure.routes[0].route)}`)]
    : folderCodeFiles(root, f));
  const feature = (closure) => (closure?.routes?.length ? undefined : path.posix.basename(folder).replace(/[^a-z0-9-]+/gi, '-').toLowerCase() || 'imported');
  return {
    closure: async (_r, f, route) => (route ? readRouteFamily(root, route) : { appRoot: root, routes: [], files: folderCodeFiles(root, f), shared: [], external: [] }),
    // The map now: the closure's files that are still there, and where moved files land.
    buildMap: async (_r, f, closure) => buildLogicMap(root, codeFiles(root, [...(closure?.files ?? []), ...landing(f, closure)]), { cache: createStateCache(fr(), 'logic-units') }),
    compare: async (before, after) => compareLogicMaps(before, after),
    fit: async (_r, f, closure, map) => {
      const c = { appRoot: root, routes: closure?.routes ?? [], files: closure?.files ?? [], shared: closure?.shared ?? [], external: closure?.external ?? [] };
      const proposal = fitLogic(map, c, { feature: feature(closure) });
      assertFitProposal(proposal, map.units.map((u) => u.fingerprint));
      const planned = planFitSteps(proposal, { folder: f, closure: c });
      // A workflow needs xstate in the app: without it the step is left for a person, said once here, not refused later.
      const noXstate = !appDependsOn(path.join(root, f), 'xstate');
      const steps = planned.steps.filter((s) => !(noXstate && s.tool === 'line.import.extractWorkflow'));
      const skipped = [...planned.skipped, ...planned.steps.filter((s) => !steps.includes(s)).map((s) => ({ block: s.blocks[0], sentence: `${s.args.name} stays where it is: the app does not depend on xstate, so a Line workflow would not compile in it.` }))];
      return { proposal, steps, skipped };
    },
    characterize: async (_r, f, closure, map) => {
      if (o.characterizeWith) return o.characterizeWith(root, f, closure, map);
      if (testRunnerOf(root) !== 'jest') {
        return { tests: [], sentence: 'The app has no jest installed, so Line cannot write characterization tests in its own runner; behaviour is checked by the logic map and the behaviour check.' };
      }
      const c = { files: codeFiles(root, closure?.files ?? folderCodeFiles(root, f)), routes: closure?.routes ?? [] };
      const r = await characterize(root, c, map, { dir: f, cache: createStateCache(fr(), 'characterize'), ...(o.characterize ?? {}) });
      const dropped = r.dropped.length ? ` ${r.dropped.length} did not reproduce on a second run and were dropped.` : '';
      return { tests: r.tests, coverage: r.coverage, sentence: `Line wrote ${r.tests.length} characterization test${r.tests.length === 1 ? '' : 's'} in ${r.files.length - 1} file${r.files.length === 2 ? '' : 's'} (jest), covering ${r.coverage.covered.length} of ${map.units.length} logic units.${dropped}` };
    },
    runTests: async (_r, f, tests) => runCharTests(root, f, tests),
    behaviour: async (_r, f, diff) => checkBehaviour(root, diff, (await load('baseline'))?.sources ?? {}, f),
    save: async (name, data) => {
      if (name === 'logic-map') { writeLogicMap(fr(), data); return; }
      // The baseline keeps each file's source, for the behaviour check after the files moved.
      const body = name === 'baseline' ? { sources: Object.fromEntries((data.files ?? []).filter((x) => fs.existsSync(path.join(root, x))).map((x) => [x, fs.readFileSync(path.join(root, x), 'utf8')])) } : data;
      writeLineState(fr(), files[name], `${JSON.stringify(body)}\n`);
    },
    load,
    record: (state) => recorder.record(state),
  };
}
