import fs from 'node:fs'; import path from 'node:path'; import {assertNotFrozen} from './frozen.mjs';
// write() is the single choke point every generator writes through, so the
// frozen-source guard (#23) lives here: a target matching the project's
// `frozen:` globs is refused before anything (even its parent dir) is created.
export function ensureDir(p){fs.mkdirSync(p,{recursive:true})} export function write(p,s){assertNotFrozen(p);ensureDir(path.dirname(p));fs.writeFileSync(p,s)} export function walk(dir){let out=[]; if(!fs.existsSync(dir))return out; for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name); if(e.name==='node_modules'||e.name==='.next'||e.name==='.git')continue; e.isDirectory()?out.push(...walk(p)):out.push(p)} return out}
export function rel(root,p){return path.relative(root,p).replaceAll(path.sep,'/')}
