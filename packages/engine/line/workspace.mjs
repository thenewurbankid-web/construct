// Line workspace (cu6, contract.mjs LineWorkspace): the one folder of a project that Line may change. Everything
// outside it is read-only for Line; applyChange (ops.mjs) refuses any staged file outside it. Stored per project in
// `<state>/workspace.json` (Line's own state folder, `line/` by default), written only through Construct's writer
// (createTransaction().commit()), so the save is all-or-nothing. No file, or `folder: ''`, means the whole project.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '@line/construct-core/config';
import { normalizeLineConfig } from '@line/construct-core/profiles/line/contract';
import { resolveLayout } from '@line/construct-core/profiles/line/checks';
import { createTransaction } from '../transactionalWriter.mjs';
import { LineOpError } from './contract.mjs';

/**
 * Path of the workspace file in a project.
 * @param {string} root
 * @returns {string}
 */
export function workspaceFile(root) {
  let state = 'line';
  try { state = resolveLayout(root, normalizeLineConfig(/** @type {any} */ (loadConfig(root)).line)).state || 'line'; } catch { /* no architecture.yml: default */ }
  return `${state}/workspace.json`;
}

/**
 * The folder as Line stores it (posix, no leading or trailing slash, '' = whole project), or a LineOpError when it is
 * not a plain path inside the project. Shape only; `mustExist` also checks it is a real folder that does not lead
 * outside the project through a link.
 * @param {string} root
 * @param {unknown} folder
 * @param {{mustExist?: boolean}} [opts]
 * @returns {string}
 */
export function normalizeFolder(root, folder, { mustExist = false } = {}) {
  if (typeof folder !== 'string') throw new LineOpError('Pick a workspace folder inside the project.', 'BAD_FOLDER');
  const raw = folder.trim().replace(/\/+$/, '');
  if (raw === '' || raw === '.') return '';
  const segs = raw.split('/');
  if (raw.includes('\0') || raw.includes('\\') || path.isAbsolute(raw) || /^[a-zA-Z]:/.test(raw)
    || segs.some((s) => s === '' || s === '.' || s === '..' || s === '.git')) {
    throw new LineOpError(`"${folder}" is not a folder inside the project; pick one from the project's folders.`, 'BAD_FOLDER');
  }
  if (mustExist) {
    const realRoot = fs.realpathSync(root);
    const abs = path.join(realRoot, raw);
    const st = fs.lstatSync(abs, { throwIfNoEntry: false });
    if (!st || !st.isDirectory()) throw new LineOpError(`There is no folder "${raw}" in the project; pick an existing folder.`, 'BAD_FOLDER');
    const real = fs.realpathSync(abs);
    if (real !== realRoot && !real.startsWith(realRoot + path.sep)) throw new LineOpError(`"${raw}" leads outside the project; pick a folder inside it.`, 'BAD_FOLDER');
  }
  return raw;
}

/**
 * True when the root-relative file `rel` lies inside `folder` ('' = the whole project).
 * @param {string} folder
 * @param {string} rel
 * @returns {boolean}
 */
export function isInsideWorkspace(folder, rel) {
  return folder === '' || rel === folder || rel.startsWith(`${folder}/`);
}

/**
 * The project's Line workspace. No workspace file means the whole project.
 * @param {string} root Project root.
 * @returns {import('./contract.mjs').LineWorkspace}
 * @throws {LineOpError} BAD_WORKSPACE when the stored file is unreadable or names a path outside the project.
 */
export function readWorkspace(root) {
  const file = workspaceFile(root);
  let text;
  try { text = fs.readFileSync(path.join(root, file), 'utf8'); } catch { return { root, folder: '', readOnly: true }; }
  let folder;
  try {
    folder = normalizeFolder(root, JSON.parse(text)?.folder);
  } catch {
    throw new LineOpError(`The workspace file ${file} cannot be read, so Line changes nothing; pick the workspace folder again.`, 'BAD_WORKSPACE');
  }
  return { root, folder, readOnly: true };
}

/**
 * Set the project's workspace folder (an existing folder inside the project, or '' for the whole project) and store it
 * in `<state>/workspace.json` through Construct's writer.
 * @param {string} root Project root.
 * @param {import('./contract.mjs').WorkspaceRequest} req
 * @returns {import('./contract.mjs').LineWorkspace}
 * @throws {LineOpError} BAD_FOLDER, or WRITE_FAILED when the writer refuses.
 */
export function setWorkspace(root, { folder } = /** @type {any} */ ({})) {
  const next = normalizeFolder(root, folder, { mustExist: true });
  const txn = createTransaction(root);
  txn.writeFile(workspaceFile(root), `${JSON.stringify({ folder: next }, null, 2)}\n`);
  let result;
  try {
    result = txn.commit({ validate: () => ({ violations: [], ok: true }) });
  } catch {
    txn.reset();
    result = { committed: false };
  }
  if (!result.committed) throw new LineOpError('The workspace folder could not be saved; nothing was changed.', 'WRITE_FAILED');
  return { root, folder: next, readOnly: true };
}
