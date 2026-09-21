// Allowlisted, directories-only filesystem browser (#223 project-gate picker).
//
// SECURITY is the whole point of this module: it is the only thing a UI
// server should call to let a human pick a project folder. Guarantees:
//   - every path is realpath()'d and must sit inside one of the allowlisted
//     roots (also realpath()'d) — `..` traversal and symlink escapes are
//     refused (403), never followed;
//   - only directory names are returned (plus boolean marker flags) — never
//     file names, never file contents (package.json is only inspected to
//     derive a "react" boolean, and only if it is a small regular file);
//   - hidden (dot) directories are excluded unless explicitly asked for;
//   - results are sorted, capped and paginated.
// Pure Node, no LLM, no HTTP — callers map DirBrowseError.status to a response.
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_LIMIT = 200;
export const MAX_LIMIT = 500;
const MAX_PACKAGE_JSON_BYTES = 1024 * 1024;

/**
 * A directory-browse failure that carries the HTTP status the Cockpit server should answer with (403 for outside the allowed roots or unreadable, 404 for missing).
 */
export class DirBrowseError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'DirBrowseError';
    this.status = status;
  }
}

function realpathOrNull(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** True if `target` equals `root` or is nested under it (both must already be real paths). */
export function isInside(root, target) {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Realpath + dedupe the configured roots; roots that do not exist / are not directories are dropped. */
export function normalizeRoots(roots) {
  const out = [];
  for (const r of Array.isArray(roots) ? roots : []) {
    if (typeof r !== 'string' || !r || r.includes('\0')) continue;
    const real = realpathOrNull(path.resolve(r));
    if (real && isDir(real) && !out.includes(real)) out.push(real);
  }
  return out;
}

function isRegularFile(p) {
  try {
    const st = fs.lstatSync(p);
    return st.isFile();
  } catch {
    return false;
  }
}

function packageJsonMentionsReact(file) {
  try {
    const st = fs.lstatSync(file);
    if (!st.isFile() || st.size > MAX_PACKAGE_JSON_BYTES) return false;
    const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Boolean({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies }.react);
  } catch {
    return false;
  }
}

/** Marker flags for one directory: which well-known project files it holds. Booleans only. */
export function detectProject(dir) {
  const hasArchitectureYml = isRegularFile(path.join(dir, 'architecture.yml'));
  const pkgPath = path.join(dir, 'package.json');
  const hasPackageJson = isRegularFile(pkgPath);
  const isReact = hasPackageJson && packageJsonMentionsReact(pkgPath);
  return {
    hasArchitectureYml,
    hasPackageJson,
    isReact,
    isConstructProject: hasArchitectureYml,
  };
}

/** Resolve a requested path to a real path inside the allowlist, or throw 400/403/404. */
export function resolveAllowedPath(requested, roots) {
  if (roots.length === 0) throw new DirBrowseError(403, 'No browsable roots are configured.');
  if (typeof requested !== 'string' || requested.includes('\0')) {
    throw new DirBrowseError(400, 'path must be a string without NUL bytes.');
  }
  const resolved = path.resolve(requested);
  const real = realpathOrNull(resolved);
  if (real === null) {
    // Does not exist (or unreadable). Do not reveal existence outside the allowlist.
    if (!roots.some((r) => isInside(r, resolved))) throw new DirBrowseError(403, 'Path is outside the allowed roots.');
    throw new DirBrowseError(404, 'No such directory.');
  }
  if (!roots.some((r) => isInside(r, real))) throw new DirBrowseError(403, 'Path is outside the allowed roots.');
  if (!isDir(real)) throw new DirBrowseError(400, 'Not a directory.');
  return real;
}

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * List the sub-directories of `requested` (default: first root).
 *
 * @param {object} [options]
 * @param {string} [options.path] Directory to list; defaults to the first allowed root.
 * @param {string[]} [options.roots] Allowed roots; nothing outside them can be listed.
 * @param {boolean} [options.showHidden=false] Include dot-directories.
 * @param {number} [options.limit] Page size (clamped to the module maximum).
 * @param {number} [options.offset=0] Entries to skip.
 * @throws {DirBrowseError} When the path is outside the roots or not readable.
 * @returns {{path, parent, roots, entries, total, offset, limit, truncated}}
 *   `parent` is null when `path` is itself a root (cannot navigate above the allowlist).
 */
export function listDirectories({ path: requested, roots: rawRoots, showHidden = false, limit, offset } = {}) {
  const roots = normalizeRoots(rawRoots);
  const target = resolveAllowedPath(requested === undefined || requested === '' ? roots[0] : requested, roots);
  const lim = clampInt(limit, 1, MAX_LIMIT, DEFAULT_LIMIT);
  const off = clampInt(offset, 0, Number.MAX_SAFE_INTEGER, 0);

  let dirents;
  try {
    dirents = fs.readdirSync(target, { withFileTypes: true });
  } catch {
    throw new DirBrowseError(403, 'Directory is not readable.');
  }

  const names = [];
  for (const d of dirents) {
    if (!showHidden && d.name.startsWith('.')) continue;
    const full = path.join(target, d.name);
    if (d.isDirectory()) {
      names.push({ name: d.name, full });
    } else if (d.isSymbolicLink()) {
      // Follow a symlink only if it lands on a directory still inside the allowlist.
      const real = realpathOrNull(full);
      if (real && isDir(real) && roots.some((r) => isInside(r, real))) names.push({ name: d.name, full: real });
    }
  }
  names.sort((a, b) => a.name.localeCompare(b.name));

  const page = names.slice(off, off + lim);
  const entries = page.map(({ name, full }) => ({ name, path: full, ...detectProject(full) }));
  const isRoot = roots.includes(target);
  return {
    path: target,
    parent: isRoot ? null : path.dirname(target),
    roots,
    entries,
    total: names.length,
    offset: off,
    limit: lim,
    truncated: off + page.length < names.length,
    current: detectProject(target),
  };
}
