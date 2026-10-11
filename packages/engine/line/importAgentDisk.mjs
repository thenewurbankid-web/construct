// ci2 -- the Import agent on disk: the pure process (importAgent.mjs) with the real scan and plan (import.mjs, static rules)
// and its file, <folder>/line/import-plan.json, written only through Construct's transactional writer inside the folder.
import fs from 'node:fs';
import path from 'node:path';
import { IMPORT_PLAN_FILE, LineOpError } from './contract.mjs';
import { scanImport, planImport } from './import.mjs';
import { createTransaction } from '../transactionalWriter.mjs';
import { aggregateValidation } from '@line/construct-core/registry';
import { enforcersForRoot } from '@line/construct-core/profiles';
import { folderRootOf } from './importTools.mjs';
import { snapshotFolder, rollbackFolder } from './importUndo.mjs';
import { createImportAgent } from './importAgent.mjs';

export { createImportAgent, nextState, decideWith, agentView, MAX_ROUNDS } from './importAgent.mjs';
export { snapshotFolder, rollbackFolder, IMPORT_UNDO_FILE } from './importUndo.mjs';

const lower = (s) => String(s).charAt(0).toLowerCase() + String(s).slice(1);
const asSentence = (s) => { const t = String(s ?? '').trim().replace(/\s+/g, ' '); return /[.?!]$/.test(t) ? t : `${t}.`; };

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
      const fr = folderRoot();
      const key = (v) => `${v.rule}\u0000${v.file}\u0000${v.message}`;
      const txn = createTransaction(fr);
      try {
        txn.writeFile(IMPORT_PLAN_FILE, `${JSON.stringify(doc, null, 2)}\n`);
        const r = txn.commit({
          validate: (shadow) => {
            const files = [IMPORT_PLAN_FILE];
            const before = new Set(aggregateValidation(fr, enforcersForRoot(fr), { files }).violations.map(key));
            const added = aggregateValidation(shadow, enforcersForRoot(shadow), { files }).violations.filter((v) => !before.has(key(v)));
            return { violations: added, ok: !added.some((v) => v.severity === 'error') };
          },
        });
        if (!r.committed) throw new LineOpError(`The import plan could not be saved: ${lower(asSentence(r.violations.find((v) => v.severity === 'error')?.message ?? 'the checks refused it'))}`, 'NOT_SAVED');
      } catch (e) {
        txn.reset();
        if (/** @type {any} */ (e)?.name === 'LineOpError') throw e;
        throw new LineOpError('The import plan could not be saved on disk.', 'NOT_SAVED', String(/** @type {any} */ (e)?.message ?? e));
      }
    },
  };
}

/**
 * The Import agent for one folder of a project on disk.
 * @param {Omit<Parameters<typeof createImportAgent>[0], 'store' | 'importOps'> & Partial<Parameters<typeof createImportAgent>[0]>} o
 * @returns {any}
 */
export function createImportAgentOnDisk(o) {
  return createImportAgent({
    store: fileStore(o.root, o.folder),
    importOps: { scan: scanImport, plan: planImport },
    checkFolder: () => folderRootOf(o.root, o.folder),
    snapshot: snapshotFolder,
    rollback: rollbackFolder,
    ...o,
  });
}
