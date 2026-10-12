// ci2 -- the Import agent on disk: the pure process (importAgent.mjs) with the real scan and plan (import.mjs, static rules)
// and its file, <folder>/line/import-plan.json, written only through Construct's transactional writer inside the folder;
// the Line Import v2 loop runs on importLoopDisk.mjs (the logic map, the characterization tests, the behaviour check).
import fs from 'node:fs';
import path from 'node:path';
import { IMPORT_PLAN_FILE, LineOpError } from './contract.mjs';
import { scanImport, planImport } from './import.mjs';
import { folderRootOf } from './importTools.mjs';
import { snapshotFolder, rollbackFolder } from './importUndo.mjs';
import { createImportAgent } from './importAgent.mjs';
import { createLogicOnDisk, writeFolderFile } from './importLoopDisk.mjs';
import { createRepairer } from './repair.mjs';
import { decide as lineDecide } from '@line/construct-core/line-decide';
import { memoryOf } from './memory/index.mjs';

export { createImportAgent, nextState, decideWith, agentView, MAX_ROUNDS } from './importAgent.mjs';
export { snapshotFolder, rollbackFolder, IMPORT_UNDO_FILE } from './importUndo.mjs';
export { createLogicOnDisk, readRouteFamily, buildLogicMap } from './importLoopDisk.mjs';

/**
 * The default store: read the file; write it through Construct's transactional writer with the folder as root. The writer's check compares the folder's problems for the plan file before and after (the same "only new problems" rule as applyChange, scoped to this one data file, so a folder that is not a Line project yet can still keep its plan).
 * @param {any} root
 * @param {any} folder
 * @returns {any}
 */
export function fileStore(root, folder) {
  const folderRoot = () => folderRootOf(root, folder);
  return {
    read() {
      try { return JSON.parse(fs.readFileSync(path.join(folderRoot(), IMPORT_PLAN_FILE), 'utf8')); } catch (e) {
        if (/** @type {any} */ (e)?.code === 'ENOENT') return null;
        throw e;
      }
    },
    write(doc) {
      try { writeFolderFile(root, folder, IMPORT_PLAN_FILE, `${JSON.stringify(doc, null, 2)}\n`); } catch (e) {
        if (/** @type {any} */ (e)?.code === 'NOT_SAVED' && /could not be saved: /.test(String(/** @type {any} */ (e).sentence))) throw new LineOpError(String(/** @type {any} */ (e).sentence).replace(`${IMPORT_PLAN_FILE} could not be saved`, 'The import plan could not be saved'), 'NOT_SAVED');
        if (/** @type {any} */ (e)?.name === 'LineOpError' && /** @type {any} */ (e).code === 'NOT_SAVED') throw new LineOpError('The import plan could not be saved on disk.', 'NOT_SAVED', /** @type {any} */ (e).detail);
        throw e;
      }
    },
  };
}

/**
 * The characterizer's search budgets (characterize.mjs budgetMs, componentBudgetMs, roundMs) from the agent's
 * `characterize.budgets`, else LINE_CHAR_BUDGETS ("pure,component,round" in seconds, e.g. "20,60,45"), else none (the
 * characterizer's defaults: 10 s pure, 25 s components, 25 s rounds). A cold pass with larger budgets raises coverage
 * when the defaults leave too many units untested.
 * @param {{pureMs?: number, componentMs?: number, roundMs?: number}} [budgets]
 * @param {Record<string, string|undefined>} [env]
 * @returns {{budgetMs?: number, componentBudgetMs?: number, roundMs?: number}}
 */
export function characterizeBudgets(budgets, env = process.env) {
  const ok = (n) => Number.isFinite(n) && n > 0;
  let b = budgets ?? null;
  if (!b && env.LINE_CHAR_BUDGETS) {
    const [p, c, r] = String(env.LINE_CHAR_BUDGETS).split(',').map((x) => Number(x.trim()) * 1000);
    b = { pureMs: p, componentMs: c, roundMs: r };
  }
  if (!b) return {};
  return { ...(ok(b.pureMs) ? { budgetMs: b.pureMs } : {}), ...(ok(b.componentMs) ? { componentBudgetMs: b.componentMs } : {}), ...(ok(b.roundMs) ? { roundMs: b.roundMs } : {}) };
}

/**
 * The Import agent for one folder of a project on disk.
 * @param {Omit<Parameters<typeof createImportAgent>[0], 'store' | 'importOps'> & Partial<Parameters<typeof createImportAgent>[0]> & {characterize?: {budgets?: {pureMs?: number, componentMs?: number, roundMs?: number}}}} o
 *   `characterize.budgets`: the characterizer's search budgets (characterizeBudgets; default its own, or LINE_CHAR_BUDGETS).
 * @returns {any}
 */
export function createImportAgentOnDisk(o) {
  const budgets = characterizeBudgets(o.characterize?.budgets);
  return createImportAgent({
    store: fileStore(o.root, o.folder),
    // A route-seeded import plans the route family's files (import.mjs planImport with {route, folder}).
    importOps: { scan: scanImport, plan: (root, folder, answers, x) => planImport(root, x?.route ? { route: x.route, folder, ...(x.feature ? { feature: x.feature } : {}) } : folder, answers) },
    logic: createLogicOnDisk(o.root, o.folder, Object.keys(budgets).length ? { characterize: budgets } : {}),
    checkFolder: () => folderRootOf(o.root, o.folder),
    snapshot: snapshotFolder,
    rollback: rollbackFolder,
    // Line's one decide(): classify questions (construct.chooser, off: the static order) and which typed fix to try
    // (construct.fix: the picker when it runs, else Construct's recommended fix).
    decide: lineDecide,
    // im2: a refused fix gets the repair loop (construct.repair, the local 1.5B; off or Ollama down: the person decides).
    repair: createRepairer(o.root, { where: 'import' }),
    // im3: plan edits are remembered in the project's memory (the browser mock has none).
    memory: memoryOf(o.root),
    ...o,
  });
}
