// #600 -- the Import Wizard's route/folder picker lists ONE directory of the OPEN PROJECT at a time. Containment is
// the workspace rule (#365) applied with the project as the base: `..`, absolute paths and symlinks that leave the
// project are refused before anything is read. Hidden folders and build output are never listed.
import fs from 'node:fs';
import path from 'node:path';
import { contain, WorkspaceError } from './workspace.mjs';

const HIDDEN_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'coverage']);
const CODE_EXT = new Set(['.tsx', '.ts', '.jsx', '.js', '.mjs']);
const PAGE_FILE = /^page\.(tsx|ts|jsx|js)$/;
const MAX_ENTRIES = 500;

/**
 * List one directory of the project for the wizard's picker.
 *
 * @param {string} projectRoot Real path of the open project.
 * @param {unknown} relPath Project-relative directory ('' or undefined for the project root).
 * @returns {{status:number, body:object}} 200 with `{path, parent, entries}` (entries: dirs first, each `{name, path, kind, route}`), or the containment error.
 */
export function listProjectTree(projectRoot, relPath) {
  const requested = relPath === undefined || relPath === '' ? '.' : relPath;
  if (typeof requested !== 'string') return { status: 400, body: { ok: false, error: 'path must be a single string.' } };
  let dir;
  try {
    dir = contain(projectRoot, requested, { base: projectRoot, mustBeDir: true });
  } catch (e) {
    if (e instanceof WorkspaceError) return { status: e.status, body: { ok: false, code: e.code, error: e.message } };
    throw e;
  }
  const rel = (abs) => path.relative(projectRoot, abs).split(path.sep).join('/');
  const entries = [];
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (d.name.startsWith('.') || HIDDEN_DIRS.has(d.name)) continue;
    const abs = path.join(dir, d.name);
    let isDir = d.isDirectory();
    if (d.isSymbolicLink()) {
      // A link is shown only when it resolves to somewhere inside the project.
      try {
        contain(projectRoot, abs, { base: projectRoot });
        isDir = fs.statSync(abs).isDirectory();
      } catch {
        continue;
      }
    }
    if (isDir) {
      const route = fs.readdirSync(abs).some((n) => PAGE_FILE.test(n));
      entries.push({ name: d.name, path: rel(abs), kind: 'dir', route });
    } else if (CODE_EXT.has(path.extname(d.name))) {
      entries.push({ name: d.name, path: rel(abs), kind: 'file', route: false });
    }
  }
  entries.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1));
  const here = rel(dir);
  return {
    status: 200,
    body: { ok: true, path: here, parent: here === '' ? null : rel(path.dirname(dir)), entries: entries.slice(0, MAX_ENTRIES), truncated: entries.length > MAX_ENTRIES },
  };
}
