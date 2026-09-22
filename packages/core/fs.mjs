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

/**
 * List every file under a directory, recursively, skipping `node_modules`, `.next` and `.git`.
 *
 * @param {string} dir Directory to walk; a missing directory yields an empty list.
 * @returns {string[]} Absolute file paths.
 */
export function walk(dir){let out=[]; if(!fs.existsSync(dir))return out; for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name); if(e.name==='node_modules'||e.name==='.next'||e.name==='.git')continue; e.isDirectory()?out.push(...walk(p)):out.push(p)} return out}

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
