// The workspace boundary (#365). ONE directory tree is all the Cockpit server will ever open, browse,
// read, write or run a command in. Everything that accepts a project/dir/file path from a client goes
// through `contain()` here, so "is this path allowed" has one small, deterministic, exhaustively tested
// answer instead of a check re-invented per route.
//
// Rules, all enforced on REAL paths (symlinks resolved), never on the spelling the client sent:
//   - the root is `CONSTRUCT_WORKSPACE_ROOT` (absolute) or `$HOME/workspace`, created if missing and
//     realpath'd once at startup;
//   - a relative request is resolved against the workspace root, never against `process.cwd()`;
//   - `..`, an absolute path elsewhere, a symlink that leads out, a dangling symlink (a write through it
//     would land outside), a NUL byte or an absurdly long path are refused;
//   - "inside" is segment-aware: `/ws-evil` is not inside `/ws`;
//   - a path that does not exist yet is judged by its deepest EXISTING ancestor's real path, so a
//     to-be-created child of a symlink that points out is refused too;
//   - an outside path is refused with the same 403 whether or not it exists (no existence oracle).
// Pure Node (fs/path/os), no HTTP, no LLM. Callers map `WorkspaceError.status` to a response.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const MAX_PATH_LENGTH = 4096;

export class WorkspaceError extends Error {
  /** @param {number} status @param {string} code @param {string} message */
  constructor(status, code, message) {
    super(message);
    this.name = 'WorkspaceError';
    this.status = status;
    this.code = code;
  }
}

/** True when `target` is `root` or nested under it. Both must already be real, absolute paths. */
export function isInside(root, target) {
  if (target === root) return true;
  const rel = path.relative(root, target);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

/** Resolve (and create if missing) the workspace root. Throws a plain Error on a relative or unusable value:
 * the server must refuse to start rather than run with a boundary it cannot establish. */
export function resolveWorkspaceRoot(env = process.env, { home = os.homedir() } = {}) {
  const configured = env.CONSTRUCT_WORKSPACE_ROOT;
  const raw = configured && configured.trim() ? configured : path.join(home, 'workspace');
  if (raw.includes('\0') || !path.isAbsolute(raw)) {
    throw new Error(`CONSTRUCT_WORKSPACE_ROOT must be an absolute path (got "${raw}").`);
  }
  const resolved = path.resolve(raw);
  fs.mkdirSync(resolved, { recursive: true });
  const real = fs.realpathSync.native(resolved);
  if (!fs.statSync(real).isDirectory()) throw new Error(`CONSTRUCT_WORKSPACE_ROOT is not a directory: ${real}`);
  if (real === path.parse(real).root) throw new Error('CONSTRUCT_WORKSPACE_ROOT must not be the filesystem root.');
  return real;
}

/** Real path of `abs`, or of its deepest existing ancestor plus the not-yet-existing tail. */
function realWithTail(abs) {
  let probe = abs;
  const tail = [];
  for (;;) {
    try {
      return { real: fs.realpathSync.native(probe), tail };
    } catch (e) {
      if (e.code === 'ENAMETOOLONG') throw new WorkspaceError(400, 'BAD_PATH', 'That path is too long.');
      if (e.code === 'ELOOP' || e.code === 'EACCES') throw new WorkspaceError(403, 'OUTSIDE_WORKSPACE', 'That path is not allowed.');
      if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') throw new WorkspaceError(403, 'OUTSIDE_WORKSPACE', 'That path is not allowed.');
      // A symlink whose target is missing: anything created "at" it would land wherever it points.
      let isLink = false;
      try {
        isLink = fs.lstatSync(probe).isSymbolicLink();
      } catch {
        /* nothing at this name: walk up */
      }
      if (isLink) throw new WorkspaceError(403, 'OUTSIDE_WORKSPACE', 'That path is a dangling symbolic link.');
      const parent = path.dirname(probe);
      if (parent === probe) throw new WorkspaceError(404, 'NOT_FOUND', 'No such path.');
      tail.unshift(path.basename(probe));
      probe = parent;
    }
  }
}

/**
 * Resolve `requested` to a real path inside `root`, or throw a WorkspaceError.
 * @param {string} root the realpath'd workspace root (from resolveWorkspaceRoot)
 * @param {unknown} requested a client-supplied path (absolute, or relative to `base`)
 * @param {{mustExist?: boolean, mustBeDir?: boolean, mustBeFile?: boolean, base?: string}} [opts]
 * @returns {string} the real absolute path (for a not-yet-existing path: real ancestor + the remainder)
 */
export function contain(root, requested, { mustExist = true, mustBeDir = false, mustBeFile = false, base = root } = {}) {
  if (typeof requested !== 'string' || requested === '') throw new WorkspaceError(400, 'BAD_PATH', 'A path is required.');
  if (requested.includes('\0')) throw new WorkspaceError(400, 'BAD_PATH', 'A path must not contain NUL bytes.');
  if (requested.length > MAX_PATH_LENGTH) throw new WorkspaceError(400, 'BAD_PATH', 'That path is too long.');
  const abs = path.resolve(base, requested);
  const { real, tail } = realWithTail(abs);
  const full = tail.length ? path.join(real, ...tail) : real;
  if (!isInside(root, full)) throw new WorkspaceError(403, 'OUTSIDE_WORKSPACE', 'That path is outside the workspace.');
  if (mustExist || mustBeDir || mustBeFile) {
    if (tail.length) throw new WorkspaceError(404, 'NOT_FOUND', 'No such path in the workspace.');
    const st = fs.statSync(full);
    if (mustBeDir && !st.isDirectory()) throw new WorkspaceError(400, 'NOT_DIRECTORY', 'Not a directory.');
    if (mustBeFile && !st.isFile()) throw new WorkspaceError(400, 'NOT_FILE', 'Not a file.');
  }
  return full;
}

/** Non-throwing form of `contain`: the real path, or null. */
export function containOrNull(root, requested, opts) {
  try {
    return contain(root, requested, opts);
  } catch (e) {
    if (e instanceof WorkspaceError) return null;
    throw e;
  }
}

/** Workspace-relative display form ("" for the root itself, otherwise "a/b"), always with forward slashes. */
export function relativeToWorkspace(root, target) {
  const rel = path.relative(root, target);
  return rel.split(path.sep).join('/');
}

// The process-wide root, resolved lazily so importing a module never creates a directory as a side effect.
let cachedRoot = null;

/** The workspace root for this server process (resolved from the environment on first use). */
export function workspaceRoot() {
  if (cachedRoot === null) cachedRoot = resolveWorkspaceRoot();
  return cachedRoot;
}

/** Test seam: forget the cached root so the next `workspaceRoot()` re-reads the environment. */
export function resetWorkspaceRootForTests() {
  cachedRoot = null;
}

/** contain() against the process workspace root. */
export function containInWorkspace(requested, opts) {
  return contain(workspaceRoot(), requested, opts);
}
