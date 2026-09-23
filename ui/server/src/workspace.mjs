// The workspace boundary (#365). ONE directory tree is all the Cockpit server will ever open, browse,
// read, write or run a command in. Everything that accepts a project/dir/file path from a client goes
// through `contain()` here, so "is this path allowed" has one small, deterministic, exhaustively tested
// answer instead of a check re-invented per route.
//
// Rules, all enforced on REAL paths (symlinks resolved), never on the spelling the client sent:
//   - the root is `CONSTRUCT_WORKSPACE_ROOT` (absolute) or `$HOME/workspace`, created if missing and
//     realpath'd once at startup. When login is required (a hosted Cockpit, #566) the root has NO default:
//     DevOps must set it, and it must not overlap `/`, the Construct checkout or the server's cwd;
//   - with a signed-in session every request is scoped to `<root>/<login>` (#567): `workspaceRoot()` then
//     returns that per-user directory, so every containment check below is per user without any route
//     changing. With no session (loopback dev, auth off) it is the base root, exactly as before;
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
import { AsyncLocalStorage } from 'node:async_hooks';
import { fileURLToPath } from 'node:url';

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

/** The Construct checkout this file lives in (ui/server/src -> three levels up). */
const CHECKOUT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Real path when it exists, else the resolved spelling. */
function realOrResolved(p) {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
}

/**
 * Resolve (and create if missing) the workspace root. Throws a plain Error on a relative or unusable value:
 * the server must refuse to start rather than run with a boundary it cannot establish.
 * With `authRequired` (a hosted, multi-user Cockpit) the root must be configured explicitly (no `$HOME/workspace`
 * default) and must not be, sit inside, or contain the Construct checkout or the process cwd, so a signed-in user
 * can never reach the server's own code, config or state.
 */
export function resolveWorkspaceRoot(env = process.env, { home = os.homedir(), authRequired = false, checkout = CHECKOUT_ROOT, cwd = process.cwd() } = {}) {
  const configured = env.CONSTRUCT_WORKSPACE_ROOT;
  const isSet = Boolean(configured && configured.trim());
  if (authRequired && !isSet) {
    throw new Error('Login is required, so CONSTRUCT_WORKSPACE_ROOT must be set: an absolute path outside the Construct checkout under which each user gets a private subdirectory. There is no default for a hosted Cockpit.');
  }
  const raw = isSet ? configured : path.join(home, 'workspace');
  if (raw.includes('\0') || !path.isAbsolute(raw)) {
    throw new Error(`CONSTRUCT_WORKSPACE_ROOT must be an absolute path (got "${raw}").`);
  }
  const resolved = path.resolve(raw);
  // Judge the hosted-mode overlap BEFORE creating anything, on the real path of the deepest existing ancestor.
  if (authRequired) {
    if (resolved === path.parse(resolved).root) throw new Error('CONSTRUCT_WORKSPACE_ROOT must not be the filesystem root.');
    const probe = realWithTailSafe(resolved);
    for (const [what, dir] of [['the Construct checkout', checkout], ['the server working directory', cwd]]) {
      const d = realOrResolved(dir);
      if (isInside(d, probe) || isInside(probe, d)) {
        throw new Error(`CONSTRUCT_WORKSPACE_ROOT (${probe}) overlaps ${what} (${d}). With login required, users must not be able to reach the server's own files: choose a directory elsewhere.`);
      }
    }
  }
  fs.mkdirSync(resolved, { recursive: true });
  const real = fs.realpathSync.native(resolved);
  if (!fs.statSync(real).isDirectory()) throw new Error(`CONSTRUCT_WORKSPACE_ROOT is not a directory: ${real}`);
  if (real === path.parse(real).root) throw new Error('CONSTRUCT_WORKSPACE_ROOT must not be the filesystem root.');
  return real;
}

/** Real path of `abs` (deepest existing ancestor realpath'd, the missing tail appended); the input on any failure. */
function realWithTailSafe(abs) {
  const tail = [];
  let probe = abs;
  for (;;) {
    try {
      return path.join(fs.realpathSync.native(probe), ...tail);
    } catch {
      const parent = path.dirname(probe);
      if (parent === probe) return abs;
      tail.unshift(path.basename(probe));
      probe = parent;
    }
  }
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

// The process-wide base root, resolved lazily so importing a module never creates a directory as a side effect.
let cachedRoot = null;

/** The base workspace root for this server process (resolved from the environment on first use). Pass
 * `{ authRequired: true }` at startup to apply the hosted-mode rules (see resolveWorkspaceRoot). */
export function baseWorkspaceRoot({ authRequired = false } = {}) {
  if (cachedRoot === null) cachedRoot = resolveWorkspaceRoot(process.env, { authRequired });
  return cachedRoot;
}

// ---- per-user scope (#567) ----------------------------------------------------------------------------------------
// A login becomes ONE directory name, so it is validated as such (GitHub logins are letters, digits and `-`; `_` is
// allowed for the e2e test login), lowercased (GitHub logins are case-insensitive, so two spellings of one person
// share a directory) and length-bounded. Anything else is refused with the same 403 as a path outside the workspace.
export const MAX_LOGIN_LENGTH = 64;
const LOGIN_PATTERN = /^[a-z0-9_-]+$/;
const refusedLogin = () => new WorkspaceError(403, 'OUTSIDE_WORKSPACE', 'That path is outside the workspace.');

/** The one place a login is validated as a single safe path segment (#567, #569): lowercased, bounded, `[a-z0-9_-]`.
 * Anything that builds a path from a login (workspace directory, per-user state file) goes through this. */
export function normalizeLogin(login) {
  if (typeof login !== 'string') throw refusedLogin();
  const name = login.toLowerCase();
  if (name.length === 0 || name.length > MAX_LOGIN_LENGTH || !LOGIN_PATTERN.test(name)) throw refusedLogin();
  return name;
}

/**
 * The private directory of `login` under the base root: created on first use with mode 0700, realpath'd and
 * confirmed strictly inside `base` (a `<base>/<login>` that is a symlink leading out is refused).
 * @param {string} base the realpath'd base root
 * @param {unknown} login a session login
 * @returns {string} the real absolute path of the user's directory
 */
export function userWorkspaceDir(base, login) {
  const name = normalizeLogin(login);
  const dir = path.join(base, name);
  try {
    fs.mkdirSync(dir, { mode: 0o700 });
  } catch (e) {
    if (e.code !== 'EEXIST') throw refusedLogin();
  }
  let real;
  try {
    real = fs.realpathSync.native(dir);
    if (!fs.statSync(real).isDirectory()) throw refusedLogin();
  } catch (e) {
    throw e instanceof WorkspaceError ? e : refusedLogin();
  }
  if (real === base || !isInside(base, real)) throw refusedLogin();
  return real;
}

const userScope = new AsyncLocalStorage();

/** Run `fn` with `workspaceRoot()` scoped to `login`'s private directory (throws a 403 WorkspaceError for an unusable login). */
export function runInUserWorkspace(login, fn) {
  const dir = userWorkspaceDir(baseWorkspaceRoot(), login);
  return userScope.run({ dir, login: normalizeLogin(login) }, fn);
}

/** Express middleware: mount ONCE, right after the session gate. With `req.session.login` the rest of the request
 * (and everything it awaits) sees `workspaceRoot()` as that user's directory; with no session (auth off) it is a no-op. */
export function userWorkspaceMiddleware(req, res, next) {
  const login = req.session?.login;
  if (login === undefined || login === null) return next();
  let dir;
  try {
    dir = userWorkspaceDir(baseWorkspaceRoot(), login);
  } catch (e) {
    if (!(e instanceof WorkspaceError)) throw e;
    return res.status(e.status).json({ ok: false, code: e.code, error: e.message });
  }
  return userScope.run({ dir, login: normalizeLogin(login) }, next);
}

/** The workspace root for the current request: the signed-in user's directory, else the base root. */
export function workspaceRoot() {
  return userScope.getStore()?.dir ?? baseWorkspaceRoot();
}

/** The signed-in login (validated, lowercased) of the current request, or '' when there is no session (auth off). */
export function currentLogin() {
  return userScope.getStore()?.login ?? '';
}

/** Test seam: forget the cached root so the next `workspaceRoot()` re-reads the environment. */
export function resetWorkspaceRootForTests() {
  cachedRoot = null;
}

/** contain() against the current workspace root. */
export function containInWorkspace(requested, opts) {
  return contain(workspaceRoot(), requested, opts);
}
