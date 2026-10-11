import fs from 'node:fs'; import path from 'node:path'; import {assertNotFrozen} from './frozen.mjs';
// write() is the single choke point every generator writes through, so the
// frozen-source guard (#23) lives here: a target matching the project's
// `frozen:` globs is refused before anything (even its parent dir) is created.

/**
 * Create a directory and any missing parents (a no-op when it exists).
 *
 * @param {string} p Directory path.
 */
export function ensureDir(p){fs.mkdirSync(p,{recursive:true})}

/**
 * Write a file, creating its directory first. Refuses a target inside a `frozen:` region
 * before anything is created.
 *
 * @param {string} p Absolute file path.
 * @param {string} s File contents.
 * @throws {Error} When `p` matches a frozen glob.
 */
export function write(p,s){assertNotFrozen(p);ensureDir(path.dirname(p));fs.writeFileSync(p,s)}

/** Directory names `walk` never descends into, at any depth. */
export const WALK_SKIP_DIRS = new Set(['node_modules', '.next', '.git']);

/**
 * True when `dir` is the top of a git checkout: it holds a `.git` entry (a folder for a clone, a
 * file for a worktree or submodule). Below its own root, `walk` treats such a folder as another
 * project and skips it.
 *
 * @param {string} dir Directory path.
 * @returns {boolean}
 */
export function isGitCheckout(dir){return fs.existsSync(path.join(dir,'.git'))}

/**
 * List every file under a directory, recursively, skipping `node_modules`, `.next` and `.git`,
 * and any directory below `dir` that is another git checkout (a nested clone, worktree or
 * submodule is a different project). Files keep depth-first, directory-entry order. Results are
 * pushed one at a time, never spread, so a very large tree cannot overflow the call stack.
 *
 * @param {string} dir Directory to walk; a missing directory yields an empty list.
 * @returns {string[]} Absolute file paths.
 */
export function walk(dir){
  const out=[]; if(!fs.existsSync(dir))return out;
  const visit=(d)=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){if(WALK_SKIP_DIRS.has(e.name))continue; const p=path.join(d,e.name); if(!e.isDirectory()){out.push(p);continue} if(!isGitCheckout(p))visit(p)}};
  visit(dir); return out;
}

/**
 * A project-relative path with `/` separators.
 *
 * @param {string} root Project root.
 * @param {string} p Absolute path inside it.
 * @returns {string} `p` relative to `root`.
 *
 * @example
 * rel('/work/app', '/work/app/features/plan/index.ts'); // => 'features/plan/index.ts'
 */
export function rel(root,p){return path.relative(root,p).replaceAll(path.sep,'/')}

/**
 * True when `target` is `root` or nested under it. Both must already be real, absolute paths
 * (callers resolve symlinks first when the containment check is security-sensitive).
 *
 * @param {string} root
 * @param {string} target
 * @returns {boolean}
 */
export function isInside(root,target){if(target===root)return true; const r=path.relative(root,target); return r!==''&&r!=='..'&&!r.startsWith(`..${path.sep}`)&&!path.isAbsolute(r)}
