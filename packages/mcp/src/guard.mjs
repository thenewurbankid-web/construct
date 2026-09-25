// Containment and hygiene of the MCP server (#649): the project root is fixed at startup, a request that would leave it is
// refused, and nothing that leaves the server holds an absolute path, the home directory or a secret. Read-only: this file
// lstat()s, readdir()s and realpath()s, and never writes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { looksLikeSecret } from '@line/construct-core/redaction';
import { ToolError, LIMITS } from './limits.mjs';

const isInside = (root, target) => {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

/**
 * The project root the server was started with, as a real path. Refused: a path that is not a directory, the file system root
 * and the home directory itself (far too wide to be "a project").
 *
 * @param {string} dir The `--root` value (or the working directory).
 * @returns {string} The real (symlink-free) absolute path.
 * @throws {Error} When the directory does not exist, is not a directory, or is too wide to be a project.
 *
 * @example
 * openRoot('.'); // => '/work/web'
 */
export function openRoot(dir) {
  let real;
  try {
    real = fs.realpathSync(path.resolve(dir));
  } catch {
    throw new Error('The project root does not exist.');
  }
  if (!fs.statSync(real).isDirectory()) throw new Error('The project root is not a directory.');
  if (real === path.parse(real).root || real === fs.realpathSync(os.homedir())) throw new Error('The project root is too wide: name the project directory, not the file system root or the home directory.');
  return real;
}

/**
 * The first link inside the project whose target is outside it, or `null`. A whole-tree walk that skips what the engine skips
 * (`node_modules`, `.next`, `.git`), so every file a block could read has been looked at. A link is judged by its real path;
 * a link that points nowhere is harmless (nothing can be read through it).
 *
 * @param {string} root The real project root from `openRoot`.
 * @returns {{ link: string } | { tooLarge: true } | null} The project-relative path of the first escaping link, `{ tooLarge }` when the tree has more than `LIMITS.scanEntries` entries, else `null`.
 *
 * @example
 * findEscapingLink(root); // => { link: 'features/leak' }
 */
export function findEscapingLink(root) {
  const stack = [root];
  let seen = 0;
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (++seen > LIMITS.scanEntries) return { tooLarge: true };
      const full = path.join(dir, e.name);
      if (e.isSymbolicLink()) {
        let real;
        try {
          real = fs.realpathSync(full);
        } catch {
          continue;
        }
        if (!isInside(root, real)) return { link: path.relative(root, full).split(path.sep).join('/') };
      } else if (e.isDirectory() && !['node_modules', '.next', '.git'].includes(e.name)) {
        stack.push(full);
      }
    }
  }
  return null;
}

/**
 * Refuse the call when a link inside the project leaves it, or when the project is too big to be looked at whole. Called by every
 * tool that reads the project, before it reads anything.
 *
 * @param {string} root The real project root.
 * @returns {void}
 * @throws {ToolError} `PATH_OUTSIDE_ROOT` (with the project-relative path of the link) or `PROJECT_TOO_LARGE`.
 *
 * @example
 * assertContained(root); // throws ToolError('PATH_OUTSIDE_ROOT', 'features/leak is a link that leaves the project ...')
 */
export function assertContained(root) {
  const found = findEscapingLink(root);
  if (!found) return;
  if (found.tooLarge) throw new ToolError('PROJECT_TOO_LARGE', `The project has more than ${LIMITS.scanEntries} entries outside node_modules, so it cannot be checked for links that leave it. Start the server on a smaller project directory.`);
  throw new ToolError('PATH_OUTSIDE_ROOT', `"${found.link}" is a link that leaves the project root, so nothing was read. Remove the link or start the server on another root.`);
}

const FEATURE_NAME = /^[A-Za-z][A-Za-z0-9_-]*$/;

/**
 * Check a feature name a client sent: a plain name, never a path. `../x`, `/etc`, `a/b` and `a\b` are refused as leaving the
 * project; anything else that is not a name is invalid input.
 *
 * @param {string} name What the client sent.
 * @returns {string} The same name, when it is a feature name.
 * @throws {ToolError} `PATH_OUTSIDE_ROOT` for a path, `INVALID_INPUT` for any other malformed name.
 *
 * @example
 * assertFeatureName('billing'); // => 'billing'
 */
export function assertFeatureName(name) {
  if (/[\\/]|^\.\.?$|^~/.test(name) || path.isAbsolute(name) || /^[A-Za-z]:/.test(name)) throw new ToolError('PATH_OUTSIDE_ROOT', 'A feature is named, not addressed by path: nothing outside the project root is read.');
  if (!FEATURE_NAME.test(name)) throw new ToolError('INVALID_INPUT', 'A feature name starts with a letter and holds letters, digits, "-" and "_".');
  return name;
}

const PATH_KEYS = new Set(['path', 'file', 'dir', 'directory', 'root', 'out', 'target', 'cwd', 'from', 'to']);

const leaves = (value, key, out, depth = 0) => {
  if (depth > 12) return;
  if (typeof value === 'string') out.push({ key, value });
  else if (Array.isArray(value)) for (const v of value) leaves(v, key, out, depth + 1);
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) leaves(v, k, out, depth + 1);
};

/**
 * The first path a plan names that would leave the project: a `touches.files[].path`, or an argument named `path`, `file`, `dir`,
 * `directory`, `root`, `out`, `target`, `cwd`, `from` or `to`, that is absolute, starts with `~`, or has a `..` segment. Route
 * arguments (`/products`) and prose are not paths and are not looked at.
 *
 * @param {any} plan A plan object.
 * @returns {string | null} The offending value, or `null`.
 *
 * @example
 * planEscapes({ steps: [{ touches: { files: [{ path: '../x' }] } }] }); // => '../x'
 */
export function planEscapes(plan) {
  const found = [];
  for (const step of Array.isArray(plan?.steps) ? plan.steps : []) {
    for (const f of Array.isArray(step?.touches?.files) ? step.touches.files : []) if (typeof f?.path === 'string') found.push({ key: 'path', value: f.path });
    leaves(step?.args, 'args', found);
  }
  for (const { key, value } of found) {
    if (!PATH_KEYS.has(key)) continue;
    if (path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('~') || value.split(/[\\/]/).includes('..')) return value;
  }
  return null;
}

const OS_PATH = /(?<![\w.:/-])(?:\/(?:home|Users|root|tmp|var|etc|usr|opt|mnt|private|proc|srv|run)(?:\/[^\s'"`),;]*)?|[A-Za-z]:\\[^\s'"`),;]+)/g;

/**
 * Make what leaves the server safe: the project root becomes "." (or nothing before a relative path), the home directory "~", any
 * other absolute system path "[path]", and a string shaped like a secret "[redacted]". Applied to every string of every result.
 *
 * @param {string} root The real project root.
 * @returns {(value: any) => any} A function that returns a deep copy of a JSON-like value with every string cleaned.
 *
 * @example
 * createScrubber('/work/web')('see /work/web/features/a.ts'); // => 'see features/a.ts'
 */
export function createScrubber(root) {
  let home = os.homedir();
  try {
    home = fs.realpathSync(home);
  } catch {
    // an unreadable home directory is simply not replaced
  }
  const text = (raw) => {
    let s = String(raw);
    s = s.split(`${root}/`).join('').split(root).join('.');
    if (home && home.length > 1) s = s.split(`${home}/`).join('~/').split(home).join('~');
    s = s.replace(OS_PATH, '[path]');
    return looksLikeSecret(s) ? '[redacted]' : s;
  };
  const deep = (value, depth = 0) => {
    if (typeof value === 'string') return text(value);
    if (depth > 12) return null;
    if (Array.isArray(value)) return value.map((v) => deep(v, depth + 1));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, deep(v, depth + 1)]));
    return value;
  };
  return deep;
}
