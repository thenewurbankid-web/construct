// #435 -- "what does moving this file change?", answered by the TypeScript language service instead of a regex.
// `planFileMove(root, oldAbs, newAbs)` is PURE: it reads the project, writes nothing, and returns every text edit the
// move needs (relative imports, tsconfig `paths` aliases such as `@/...`, dynamic `import()`, `export ... from`
// re-exports, index barrels, `import type`). The caller (packages/core/refactor.mjs) applies the edits through its own guarded
// writer; nothing here decides what is written.
//
// Deterministic, no LLM, no `ui/` imports, `typescript` only (already a dependency, Apache-2.0).
//
// Refusals are not errors: when TypeScript cannot resolve the project the result is `{ ok:false, reason }` and the
// caller falls back to the older regex engine with that reason as a visible note. A project is refused when there is no
// tsconfig.json at its root, the config (or an `extends` target) is unreadable or reaches OUTSIDE the project, it has
// more than MAX_FILES source files, or the service throws.
//
// Bounds: source files are capped (MAX_FILES); every read goes through a containment check (only files under the
// project root, plus TypeScript's own lib directory, are ever read; nothing is ever written here); one language service is
// cached per project root (at most MAX_CACHED, each keyed by file mtimes so a changed file is re-read, an unchanged
// project is answered from memory) and dropped when the tsconfig changes.
import fs from 'node:fs';
import path from 'node:path';
import { ts, MAX_FILES, MAX_CACHED, SOURCE_EXT, inside, openProject, clearHostCache } from './lsp/host.mjs';

// The contained, cached language-service host lives in lsp/host.mjs (#943), shared with the Line LSP.
export { MAX_FILES, MAX_CACHED };

/**
 * The same contained, cached language service planFileMove uses, for other read-only analyses (#941: the isolation
 * harness's importFixer asks it for code fixes). `readRoots` are extra folders the host may read, e.g. a node_modules
 * above the project so `react` resolves; nothing is ever written. Callers apply any edits themselves.
 * @returns {{ok:true, service:import('typescript').LanguageService, files:string[], options:object} | {ok:false, reason:string}}
 */
export function projectLanguageService(root, { readRoots = [] } = {}) {
  try {
    // #943: the shared host (lsp/host.mjs), readRoots as its read-only extraRoots
    const proj = openProject(path.resolve(root), { extraRoots: readRoots.map((x) => path.resolve(x)) });
    if (!proj.ok) return { ok: false, reason: proj.reason };
    return { ok: true, service: proj.service, files: proj.entry.files, options: proj.entry.options };
  } catch (e) {
    return { ok: false, reason: `TypeScript could not analyse the project (${String(e?.message || e).slice(0, 120)})` };
  }
}

/** Drop every cached service (tests, or after the project changed on disk in a way mtimes cannot show). */
export function clearMoveCache() { clearHostCache(); }

/**
 * Every edit needed to move `oldAbs` to `newAbs` (both absolute, inside `root`; `oldAbs` must exist, `newAbs` need not).
 * @returns {{ok:true, engine:'typescript', tsVersion:string, files:string[], edits:{file:string,start:number,end:number,newText:string}[]}
 *   | {ok:false, reason:string}} `files` are absolute and sorted; `edits` are sorted by file then start; an edit whose `file`
 *   is `oldAbs` belongs to the moved file itself (its own imports, re-pointed from its new home).
 */
export function planFileMove(root, oldAbs, newAbs) {
  try {
    const r = path.resolve(root);
    const from = path.resolve(oldAbs);
    const to = path.resolve(newAbs);
    if (!inside(r, from) || !inside(r, to)) return { ok: false, reason: 'the file is outside the project' };
    if (!SOURCE_EXT.has(path.extname(from))) return { ok: false, reason: 'not a TypeScript/JavaScript source file' };
    const proj = openProject(r, { extraFiles: [from] });
    if (!proj.ok) return { ok: false, reason: proj.reason };
    const { files } = proj;
    const changes = proj.service.getEditsForFileRename(from, to, {}, { importModuleSpecifierEnding: 'minimal' });
    const edits = [];
    for (const c of changes) {
      const file = path.resolve(c.fileName);
      if (!inside(r, file)) continue; // never an edit outside the project
      for (const t of c.textChanges) edits.push({ file, start: t.span.start, end: t.span.start + t.span.length, newText: t.newText });
    }
    // what the rename does not see: jest's module calls and require() in TypeScript files (see CALL_SPECIFIER)
    const aliases = readPathAliases(r);
    const overlaps = (e) => edits.some((x) => x.file === e.file && x.start < e.end && e.start < x.end);
    for (const file of files) {
      let text;
      try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
      if (!/\b(?:jest\.|require\s*\()/.test(text)) continue;
      const extra = file === from ? ownCallEdits(text, from, to) : callSpecifierEdits(r, aliases, file, text, from, to);
      for (const e of extra) if (!overlaps(e)) edits.push(e);
    }
    edits.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.start - b.start));
    return { ok: true, engine: 'typescript', tsVersion: ts.version, files: [...new Set(edits.map((e) => e.file))], edits };
  } catch (e) {
    return { ok: false, reason: `TypeScript could not analyse the project (${String(e?.message || e).slice(0, 120)})` };
  }
}

// ---------------------------------------------------------------------------------------------
// Specifiers TypeScript's rename does not see: `jest.mock('…')` and friends (a test's module mocks), and `require('…')`
// in a .ts/.tsx file (TypeScript tracks require only in JavaScript files). A move that leaves them behind leaves a mock
// that no longer applies (or names a file that is gone), so the tests that pinned the old behaviour fail after a move
// that changed nothing. Both move engines (planFileMove here, ops.mjs's regex engine) re-point them.

/** The call heads whose first argument is a module specifier TypeScript's rename leaves alone. */
export const CALL_SPECIFIER = /(?<![\w$.])((?:jest\.(?:mock|doMock|unmock|dontMock|setMock|requireActual|requireMock|createMockFromModule)|require)\s*\(\s*)(['"])([^'"\n]+)\2/g;

const posixRel = (from, to) => path.relative(from, to).split(path.sep).join('/');

/**
 * The tsconfig `paths` aliases of the project `root` sits in, as folders relative to `root`: the nearest tsconfig.json
 * at `root` or above it (the search stops at the folder that holds `.git`), wildcard patterns only (`@/*`), longest
 * prefix first; an alias whose target is outside `root` is left out. `[]` without a tsconfig or with no paths.
 * @param {string} root Absolute folder.
 * @returns {{prefix: string, dir: string}[]} `dir` is root-relative and posix ('' is `root` itself).
 */
export function readPathAliases(root) {
  let dir = path.resolve(root);
  for (;;) {
    const cfg = path.join(dir, 'tsconfig.json');
    if (fs.existsSync(cfg)) {
      let json = null;
      try { json = ts.parseConfigFileTextToJson(cfg, fs.readFileSync(cfg, 'utf8')).config; } catch { json = null; }
      const opts = json?.compilerOptions ?? {};
      const base = path.resolve(dir, typeof opts.baseUrl === 'string' ? opts.baseUrl : '.');
      const out = [];
      for (const [key, targets] of Object.entries(opts.paths ?? {})) {
        const target = Array.isArray(targets) ? targets[0] : null;
        if (!key.endsWith('*') || typeof target !== 'string' || !target.endsWith('*')) continue;
        const rel = posixRel(path.resolve(root), path.resolve(base, target.slice(0, -1)));
        if (rel === '..' || rel.startsWith('../') || path.isAbsolute(rel)) continue;
        out.push({ prefix: key.slice(0, -1), dir: rel.replace(/\/$/, '') });
      }
      return out.sort((a, b) => b.prefix.length - a.prefix.length);
    }
    if (fs.existsSync(path.join(dir, '.git'))) return [];
    const up = path.dirname(dir);
    if (up === dir) return [];
    dir = up;
  }
}

/**
 * Where a specifier in `fileAbs` points (absolute, as written: maybe without its extension), or null for a package.
 * @param {string} root Absolute project root.
 * @param {{prefix: string, dir: string}[]} aliases From readPathAliases(root).
 * @param {string} fileAbs The importing file.
 * @param {string} spec The specifier.
 * @returns {{abs: string, alias: {prefix: string, dir: string}|null}|null}
 */
export function specifierTarget(root, aliases, fileAbs, spec) {
  if (spec.startsWith('.')) return { abs: path.resolve(path.dirname(fileAbs), spec), alias: null };
  const alias = aliases.find((a) => spec.startsWith(a.prefix));
  return alias ? { abs: path.resolve(root, alias.dir, spec.slice(alias.prefix.length)), alias } : null;
}

/**
 * The specifier `spec` (in `fileAbs`) should become when `oldAbs` moves to `newAbs`, or null when it names another module.
 * It keeps its form: relative stays relative, an alias stays that alias (relative when the new place is outside it), an
 * extension stays written or left out, a folder import of an index file stays a folder import.
 * @param {string} root Absolute project root.
 * @param {{prefix: string, dir: string}[]} aliases From readPathAliases(root).
 * @param {string} fileAbs The importing file.
 * @param {string} spec The specifier as written.
 * @param {string} oldAbs The moved file's place before the move.
 * @param {string} newAbs Its place after.
 * @returns {string|null}
 */
export function movedSpecifier(root, aliases, fileAbs, spec, oldAbs, newAbs) {
  const t = specifierTarget(root, aliases, fileAbs, spec);
  if (!t) return null;
  const strip = (p) => p.slice(0, p.length - path.extname(p).length);
  const isIndex = /^index$/.test(path.basename(strip(oldAbs)));
  let dest;
  if (t.abs === oldAbs) dest = newAbs;
  else if (t.abs === strip(oldAbs)) dest = strip(newAbs);
  else if (isIndex && t.abs === path.dirname(oldAbs)) dest = /^index$/.test(path.basename(strip(newAbs))) ? path.dirname(newAbs) : strip(newAbs);
  else return null;
  if (t.alias) {
    const inAlias = posixRel(path.resolve(root, t.alias.dir), dest);
    if (inAlias && inAlias !== '..' && !inAlias.startsWith('../') && !path.isAbsolute(inAlias)) return `${t.alias.prefix}${inAlias}`;
  }
  const r = posixRel(path.dirname(fileAbs), dest);
  return r.startsWith('.') ? r : `./${r}`;
}

/**
 * Edits for the specifiers of `jest.mock(...)` (and the other jest module calls) and `require(...)` in `source` that
 * name the moved file, in planFileMove's edit shape.
 * @param {string} root Absolute project root.
 * @param {{prefix: string, dir: string}[]} aliases
 * @param {string} fileAbs The file `source` is (its place BEFORE the move; for the moved file itself pass its new place).
 * @param {string} source
 * @param {string} oldAbs
 * @param {string} newAbs
 * @returns {{file: string, start: number, end: number, newText: string}[]}
 */
export function callSpecifierEdits(root, aliases, fileAbs, source, oldAbs, newAbs) {
  const edits = [];
  for (const m of source.matchAll(CALL_SPECIFIER)) {
    const next = movedSpecifier(root, aliases, fileAbs, m[3], oldAbs, newAbs);
    if (next === null || next === m[3]) continue;
    const start = /** @type {number} */ (m.index) + m[1].length + 1;
    edits.push({ file: fileAbs, start, end: start + m[3].length, newText: next });
  }
  return edits;
}

/** The moved file's own relative call specifiers, re-pointed from its new folder (edits carry its OLD path, like TypeScript's). */
function ownCallEdits(source, oldAbs, newAbs) {
  const edits = [];
  for (const m of source.matchAll(CALL_SPECIFIER)) {
    if (!m[3].startsWith('.')) continue;
    const r = posixRel(path.dirname(newAbs), path.resolve(path.dirname(oldAbs), m[3]));
    const next = r.startsWith('.') ? r : `./${r}`;
    if (next === m[3]) continue;
    const start = /** @type {number} */ (m.index) + m[1].length + 1;
    edits.push({ file: oldAbs, start, end: start + m[3].length, newText: next });
  }
  return edits;
}

/** Apply `edits` (all for one file) to `source`; ranges are the ORIGINAL offsets, applied from the end so they stay valid. */
export function applyEdits(source, edits) {
  let out = source;
  for (const e of [...edits].sort((a, b) => b.start - a.start)) {
    if (e.start < 0 || e.end > source.length || e.start > e.end) throw new Error('an edit is outside the file it names');
    out = out.slice(0, e.start) + e.newText + out.slice(e.end);
  }
  return out;
}
