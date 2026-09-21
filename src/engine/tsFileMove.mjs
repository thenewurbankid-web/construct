// #435 -- "what does moving this file change?", answered by the TypeScript language service instead of a regex.
// `planFileMove(root, oldAbs, newAbs)` is PURE: it reads the project, writes nothing, and returns every text edit the
// move needs (relative imports, tsconfig `paths` aliases such as `@/...`, dynamic `import()`, `export ... from`
// re-exports, index barrels, `import type`). The caller (src/refactor.mjs) applies the edits through its own guarded
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
import ts from 'typescript';

export const MAX_FILES = 4000;
export const MAX_CACHED = 3;
const SOURCE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs']);
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'dist', 'build', 'coverage']);
const TS_LIB_DIR = path.dirname(ts.getDefaultLibFilePath({}));

const cache = new Map(); // root -> { configMtime, service, versions:Map<file, string>, files:string[] }

/** True when `p` is `root` itself or something beneath it. */
const inside = (root, p) => p === root || p.startsWith(root + path.sep);

function sourceFiles(root) {
  const out = [];
  const visit = (dir) => {
    if (out.length > MAX_FILES) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isSymbolicLink()) continue; // never follow a link out of the project
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) visit(p); } else if (SOURCE_EXT.has(path.extname(e.name)) && !e.name.endsWith('.d.ts')) out.push(p);
    }
  };
  visit(root);
  return out;
}

/** Read the tsconfig with every read confined to `root`. -> { options } | { reason } */
function readOptions(root) {
  const configPath = path.join(root, 'tsconfig.json');
  if (!fs.existsSync(configPath)) return { reason: 'the project has no tsconfig.json at its root' };
  let escaped = null;
  const confined = (p) => {
    const abs = path.resolve(p);
    if (inside(root, abs) || inside(TS_LIB_DIR, abs)) return true;
    escaped = escaped || abs;
    return false;
  };
  const host = {
    ...ts.sys,
    useCaseSensitiveFileNames: true,
    readFile: (p) => (confined(p) ? ts.sys.readFile(p) : undefined),
    fileExists: (p) => confined(p) && ts.sys.fileExists(p),
    readDirectory: () => [], // the file list is ours (sourceFiles), not the config's include globs
  };
  const read = ts.readConfigFile(configPath, host.readFile);
  if (read.error) return { reason: `tsconfig.json cannot be read (${ts.flattenDiagnosticMessageText(read.error.messageText, ' ').slice(0, 120)})` };
  const parsed = ts.parseJsonConfigFileContent(read.config, host, root, undefined, configPath);
  if (escaped) return { reason: 'tsconfig.json (or something it extends) points outside the project, which is never read' };
  const fatal = parsed.errors.find((d) => d.code !== 18003); // 18003: "no inputs were found" is fine, the file list is ours
  if (fatal) return { reason: `tsconfig.json is not usable (${ts.flattenDiagnosticMessageText(fatal.messageText, ' ').slice(0, 120)})` };
  // a checker option set that never emits and never resolves types from outside the project's own reach
  return { options: { ...parsed.options, noEmit: true, allowJs: true, checkJs: false, skipLibCheck: true, types: [] } };
}

function mtimeOf(file) { try { return String(fs.statSync(file).mtimeMs); } catch { return '0'; } }

function serviceFor(root, files, options, configMtime) {
  let entry = cache.get(root);
  if (entry && entry.configMtime !== configMtime) { entry.service.dispose(); cache.delete(root); entry = undefined; }
  if (!entry) {
    entry = { configMtime, versions: new Map(), files: [], options, service: null };
    const host = {
      getScriptFileNames: () => entry.files,
      getScriptVersion: (f) => entry.versions.get(f) ?? (inside(TS_LIB_DIR, f) ? '1' : mtimeOf(f)),
      getScriptSnapshot: (f) => {
        const abs = path.resolve(f);
        if (!inside(root, abs) && !inside(TS_LIB_DIR, abs)) return undefined;
        try { return ts.ScriptSnapshot.fromString(fs.readFileSync(abs, 'utf8')); } catch { return undefined; }
      },
      getCurrentDirectory: () => root,
      getCompilationSettings: () => entry.options,
      getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
      fileExists: (p) => (inside(root, path.resolve(p)) || inside(TS_LIB_DIR, path.resolve(p))) && ts.sys.fileExists(p),
      readFile: (p) => (inside(root, path.resolve(p)) || inside(TS_LIB_DIR, path.resolve(p)) ? ts.sys.readFile(p) : undefined),
      directoryExists: (p) => inside(root, path.resolve(p)) && ts.sys.directoryExists(p),
      getDirectories: () => [],
      readDirectory: () => [],
      realpath: (p) => p,
      useCaseSensitiveFileNames: () => true,
    };
    entry.service = ts.createLanguageService(host, ts.createDocumentRegistry(true, root));
    cache.set(root, entry);
    while (cache.size > MAX_CACHED) { const oldest = cache.keys().next().value; cache.get(oldest).service.dispose(); cache.delete(oldest); }
  }
  entry.options = options;
  entry.files = files;
  for (const f of files) entry.versions.set(f, mtimeOf(f)); // an unchanged file keeps its version, so TS keeps its parse
  return entry;
}

/** Drop every cached service (tests, or after the project changed on disk in a way mtimes cannot show). */
export function clearMoveCache() { for (const e of cache.values()) e.service.dispose(); cache.clear(); }

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
    const cfg = readOptions(r);
    if (!cfg.options) return { ok: false, reason: cfg.reason };
    const files = sourceFiles(r);
    if (files.length > MAX_FILES) return { ok: false, reason: `the project has more than ${MAX_FILES} source files` };
    if (!files.includes(from)) files.push(from);
    const entry = serviceFor(r, files, cfg.options, mtimeOf(path.join(r, 'tsconfig.json')));
    const changes = entry.service.getEditsForFileRename(from, to, {}, { importModuleSpecifierEnding: 'minimal' });
    const edits = [];
    for (const c of changes) {
      const file = path.resolve(c.fileName);
      if (!inside(r, file)) continue; // never an edit outside the project
      for (const t of c.textChanges) edits.push({ file, start: t.span.start, end: t.span.start + t.span.length, newText: t.newText });
    }
    edits.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.start - b.start));
    return { ok: true, engine: 'typescript', tsVersion: ts.version, files: [...new Set(edits.map((e) => e.file))], edits };
  } catch (e) {
    return { ok: false, reason: `TypeScript could not analyse the project (${String(e?.message || e).slice(0, 120)})` };
  }
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
