// iv2-bugs -- undoing an import that landed step by step (the Import agent's plan steps, Cockpit's Apply through the plan):
// before the first import step lands, the folder is saved to `<folder>/line/import-undo.json` (Line's own state, through
// the writer's Line-state path); when a later step is refused, the person can put every file back in ONE transaction of
// Construct's writer. Plan tools line.import.save and line.import.undo (importTools.mjs) and the agent's snapshot and
// rollback options (importAgentDisk.mjs) all call these two functions.
import fs from 'node:fs';
import path from 'node:path';
import { LineOpError, importFolderProblem } from './contract.mjs';
import { createTransaction, writeLineState } from '../transactionalWriter.mjs';
import { WALK_SKIP_DIRS, isGitCheckout } from '@line/construct-core/fs';

/**
 * The import folder's absolute root, or a LineOpError.
 * @param {any} root
 * @param {any} folder
 * @returns {any}
 */
export function folderRootOf(root, folder) {
  const bad = importFolderProblem(folder);
  if (bad) throw new LineOpError(`The import folder ${bad}.`, 'BAD_FOLDER');
  const abs = path.resolve(root, folder);
  if (!abs.startsWith(path.resolve(root) + path.sep)) throw new LineOpError('The import folder must be inside the project.', 'BAD_FOLDER');
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw new LineOpError(`The project has no folder ${folder}.`, 'BAD_FOLDER');
  return abs;
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

