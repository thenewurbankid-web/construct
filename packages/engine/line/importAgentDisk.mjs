// ci2 -- the Import agent on disk: the pure process (importAgent.mjs) with the real scan and plan (import.mjs, static rules)
// and its file, <folder>/line/import-plan.json, written only through Construct's transactional writer inside the folder.
import fs from 'node:fs';
import path from 'node:path';
import { IMPORT_PLAN_FILE, LineOpError } from './contract.mjs';
import { scanImport, planImport } from './import.mjs';
import { createTransaction, writeLineState } from '../transactionalWriter.mjs';
import { WALK_SKIP_DIRS, isGitCheckout } from '@line/construct-core/fs';
import { aggregateValidation } from '@line/construct-core/registry';
import { enforcersForRoot } from '@line/construct-core/profiles';
import { folderRootOf } from './importTools.mjs';
import { createImportAgent } from './importAgent.mjs';

export { createImportAgent, nextState, decideWith, agentView, MAX_ROUNDS } from './importAgent.mjs';

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

/** Where the folder is saved before the first import step lands (Line's own state folder, next to the plan file). */
export const IMPORT_UNDO_FILE = 'line/import-undo.json';

/** Every file and folder of the import folder, folder-relative (no node_modules, .next, .git, nested checkouts or `line/`). */
function folderTree(fr) {
  const files = [];
  const dirs = [];
  const visit = (abs, rel) => {
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (!rel && e.name === 'line') continue;
      if (WALK_SKIP_DIRS.has(e.name)) continue;
      const a = path.join(abs, e.name);
      if (e.isDirectory()) { if (isGitCheckout(a)) continue; dirs.push(r); visit(a, r); } else if (e.isFile()) files.push(r);
    }
  };
  visit(fr, '');
  return { files, dirs };
}

/**
 * Save the import folder as it is (every file's bytes, and its folders) to `<folder>/line/import-undo.json`, through the
 * writer's Line-state path, so rollbackFolder can put it back. Called once, before the first import step lands.
 * @param {string} root Project root.
 * @param {string} folder Project-relative import folder.
 * @returns {{files: number}}
 */
export function snapshotFolder(root, folder) {
  const fr = folderRootOf(root, folder);
  const { files, dirs } = folderTree(fr);
  const saved = Object.fromEntries(files.map((f) => [f, fs.readFileSync(path.join(fr, f)).toString('base64')]));
  writeLineState(fr, IMPORT_UNDO_FILE, `${JSON.stringify({ version: 1, folder, files: saved, dirs })}\n`);
  return { files: files.length };
}

/**
 * Undo an import: put every file of the folder back as snapshotFolder saved it (rewrite what changed, recreate what was
 * removed, remove what the import added), in ONE transaction of Construct's writer, then remove folders the import
 * created and left empty. The writer's check is skipped on purpose: the folder goes back to a state it already had,
 * which was never a Line state. Line's state folder (`line/`, with the plan file) stays; the saved copy goes.
 * @param {string} root Project root.
 * @param {string} folder Project-relative import folder.
 * @returns {{ok: boolean, sentence: string, files: string[]}} `files`: folder-relative paths put back or removed.
 */
export function rollbackFolder(root, folder) {
  const fr = folderRootOf(root, folder);
  let snap;
  try { snap = JSON.parse(fs.readFileSync(path.join(fr, IMPORT_UNDO_FILE), 'utf8')); } catch {
    return { ok: false, sentence: `There is no saved copy of ${folder} to put back, so the import cannot be undone; leave the step or fix it.`, files: [] };
  }
  const saved = new Map(Object.entries(snap.files ?? {}).map(([f, b64]) => [f, Buffer.from(String(b64), 'base64')]));
  const now = folderTree(fr);
  const txn = createTransaction(fr);
  const changed = [];
  try {
    for (const f of now.files) if (!saved.has(f)) { txn.deleteFile(f); changed.push(f); }
    for (const [f, bytes] of saved) {
      const abs = path.join(fr, f);
      if (fs.existsSync(abs) && fs.readFileSync(abs).equals(bytes)) continue;
      txn.writeFile(f, /** @type {any} */ (bytes));
      changed.push(f);
    }
    txn.deleteFile(IMPORT_UNDO_FILE);
    const r = txn.commit({ validate: () => ({ violations: [], ok: true }) });
    if (!r.committed) return { ok: false, sentence: `${folder} could not be put back; nothing was changed.`, files: [] };
  } catch (e) {
    txn.reset();
    return { ok: false, sentence: `${folder} could not be put back (${String(/** @type {any} */ (e)?.code ?? /** @type {any} */ (e)?.message ?? e)}); every file the undo had already written was put back as it was.`, files: [] };
  }
  const keep = new Set(snap.dirs ?? []);
  for (const d of now.dirs.sort((a, b) => b.length - a.length)) {
    if (keep.has(d)) continue;
    try { fs.rmdirSync(path.join(fr, d)); } catch { /* not empty: something outside the import is in it */ }
  }
  return { ok: true, sentence: `Put ${changed.length} file${changed.length === 1 ? '' : 's'} of ${folder} back as ${changed.length === 1 ? 'it was' : 'they were'} before the import.`, files: changed.sort() };
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
