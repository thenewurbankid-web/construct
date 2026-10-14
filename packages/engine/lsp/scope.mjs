// #950 -- the scoped Line LSP's scope: which files are TypeScript's root files and which ones Smith and the rules index
// up front. Everything else is reached lazily (widening) or by the background indexer, outward from the scope.
//
//   scopeMode(root, o.scope, env)          -> 'scoped' | 'full'     the lsp.scope flag (option, LINE_LSP_SCOPE, profile)
//   resolveScope(root, spec, o)            -> Scope                 { mode, how, focus, files: Set<rel>, contains(rel), add(rels) }
//   outwardOrder(root, scope, all, refs)   -> rel[]                 breadth-first over imports from the scope, then the rest
//
// Line project (features/ at the root): the focus feature's files (features/<f>/**), every other feature's public index
// (moduleScope), and library/**. Other projects: one folder plus the project files it imports directly.
// The focus is `spec.feature` / `spec.folder` when given, else what was edited last: the feature (Line) or the folder
// (others) holding the most recently modified code file.
import fs from 'node:fs';
import path from 'node:path';
import { sourceFiles, readOptions } from './host.mjs';
import { refsOf, directImportsOf } from './outline.mjs';
import { LSP_PROFILE_FILE } from '../line/lsp/profile.mjs';

export const SCOPE_MODES = Object.freeze(['scoped', 'full']);
export const SCOPE_FLAG = 'lsp.scope';
const posix = (p) => p.split(path.sep).join('/');
const isCode = (f) => /\.(ts|tsx|js|jsx|mjs)$/.test(f) && !/\.d\.ts$/.test(f);

/**
 * The lsp.scope flag for a project: the caller's option ('scoped' | 'full', or a scope object: scoped), then
 * LINE_LSP_SCOPE, then line/lsp-profile.json's "lsp.scope", then 'scoped'.
 * @param {string} root
 * @param {any} [opt] createLineLsp's `scope` option.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {'scoped'|'full'}
 */
export function scopeMode(root, opt, env = process.env) {
  if (opt === 'full' || opt === 'scoped') return opt;
  if (opt && typeof opt === 'object') return 'scoped';
  const e = String(env.LINE_LSP_SCOPE ?? '').trim();
  if (SCOPE_MODES.includes(e)) return /** @type {any} */ (e);
  try {
    const p = JSON.parse(fs.readFileSync(path.join(root, LSP_PROFILE_FILE), 'utf8'));
    const v = p?.[SCOPE_FLAG] ?? p?.settings?.[SCOPE_FLAG];
    if (SCOPE_MODES.includes(v)) return v;
  } catch { /* no profile */ }
  return 'scoped';
}

/**
 * Whether a root is a Line project (a features/ folder).
 * @param {string} root
 * @returns {boolean}
 */
export const isLineProject = (root) => { try { return fs.statSync(path.join(root, 'features')).isDirectory(); } catch { return false; } };
const featuresOf = (root) => { try { return fs.readdirSync(path.join(root, 'features'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort(); } catch { return []; } };
const mtime = (abs) => { try { return fs.statSync(abs).mtimeMs; } catch { return 0; } };

/** The most recently modified code file's rel among `rels` (ties: the first alphabetically), or null. */
function newest(root, rels) {
  let best = null; let bt = -1;
  for (const r of [...rels].sort()) { const t = mtime(path.join(root, r)); if (t > bt) { bt = t; best = r; } }
  return best;
}

/**
 * The scope of a project.
 * @param {string} root Project root.
 * @param {'full'|'scoped'|{feature?: string, folder?: string, files?: string[]}|undefined} spec
 * @param {{all?: string[], env?: NodeJS.ProcessEnv}} [o] `all`: every root-relative source file (sourceFiles), when known.
 * @returns {Promise<any>} { mode, how, focus, files: Set<string>, prefixes: string[], contains(rel), add(rels) -> added }
 */
export async function resolveScope(root, spec, { all = null, env = process.env } = {}) {
  const r = path.resolve(root);
  const files = all ?? sourceFiles(r, { includeDts: false }).map((a) => posix(path.relative(r, a)));
  const mode = scopeMode(r, spec, env);
  const set = new Set();
  const prefixes = [];
  let how = '';
  let focus = null;
  const s = spec && typeof spec === 'object' ? spec : {};
  if (mode === 'full') {
    for (const f of files) set.add(f);
    prefixes.push('');
    how = 'full: every source file';
  } else if (Array.isArray(s.files)) {
    for (const f of s.files) set.add(posix(f));
    how = `${set.size} named file(s)`;
  } else if (isLineProject(r) && !s.folder) {
    const feats = featuresOf(r);
    focus = s.feature ?? (() => { const n = newest(r, files.filter((f) => f.startsWith('features/') && isCode(f))); return n ? n.split('/')[1] : feats[0] ?? null; })();
    const { moduleScope } = await import('../line/scope/moduleScope.mjs');
    const indexes = [];
    for (const f of feats) { if (f === focus) continue; try { const ix = moduleScope(r, f).index; if (ix) indexes.push(ix); } catch { /* not a module yet */ } }
    if (focus) prefixes.push(`features/${focus}/`);
    prefixes.push('library/');
    for (const f of files) if (prefixes.some((p) => f.startsWith(p)) || indexes.includes(f)) set.add(f);
    how = `features/${focus ?? '(none)'}/** + ${indexes.length} other feature index file(s) + library/**`;
  } else {
    focus = s.folder ?? (() => { const n = newest(r, files.filter(isCode)); return n ? path.posix.dirname(n) : '.'; })();
    const pre = focus === '.' || focus === '' ? '' : `${focus.replace(/\/$/, '')}/`;
    const own = files.filter((f) => (pre ? f.startsWith(pre) : !f.includes('/')));
    if (pre) prefixes.push(pre);
    const options = readOptions(r).options ?? null;
    for (const f of own) set.add(f);
    let direct = 0;
    for (const f of own) {
      let text = '';
      try { text = fs.readFileSync(path.join(r, f), 'utf8'); } catch { continue; }
      for (const d of directImportsOf(refsOf(r, f, text, options))) if (!set.has(d)) { set.add(d); direct++; }
    }
    how = `${pre || './'}** (${own.length} files) + their direct imports inside the project (${direct})`;
  }
  return {
    mode, how, focus, files: set, prefixes,
    /** In scope: a scope file, or (for a new file) under the focus folder. */
    contains: (rel) => set.has(rel) || prefixes.some((p) => (p ? rel.startsWith(p) : true)),
    /** Widen: add files to the scope. -> the ones that were not in it. */
    add(rels) { const added = []; for (const f of rels) { const p = posix(f); if (!set.has(p)) { set.add(p); added.push(p); } } return added; },
    /** Widen to a whole folder (create_module): its files now, and any new file there later. */
    addPrefix(pre, rels = []) { const p = pre.endsWith('/') ? pre : `${pre}/`; if (!prefixes.includes(p)) prefixes.push(p); return this.add(rels.filter((f) => f.startsWith(p))); },
  };
}

/**
 * The files outside the scope in the order a background indexer should take them: breadth-first over imports from the
 * scope (what the scope reaches first), then everything else alphabetically.
 * @param {any} scope resolveScope().
 * @param {string[]} all Every root-relative source file.
 * @param {(rel: string) => string[]} importsOf A file's direct project imports.
 * @returns {string[]}
 */
export function outwardOrder(scope, all, importsOf) {
  const seen = new Set(scope.files);
  const order = [];
  let frontier = [...scope.files].sort();
  while (frontier.length) {
    const next = [];
    for (const f of frontier) for (const d of importsOf(f)) if (!seen.has(d)) { seen.add(d); next.push(d); order.push(d); }
    frontier = next;
  }
  for (const f of [...all].sort()) if (!seen.has(f)) { seen.add(f); order.push(f); }
  return order;
}
