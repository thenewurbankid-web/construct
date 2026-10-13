// #943 -- one shared, contained, cached TypeScript language-service host (extracted from tsFileMove.mjs, #435).
// Used by tsFileMove (planFileMove) and by the Line LSP (lsp/index.mjs). Read-only: nothing here ever writes.
//
// Containment: every read goes through a check (only files under the project root, TypeScript's own lib directory,
// and any `extraRoots` the caller names -- e.g. a node_modules folder for React's types -- are ever read).
// Bounds: source files are capped (MAX_FILES); one service per (root, options) is cached (at most MAX_CACHED), keyed
// by file versions (mtime + size, or a content hash after update()) so a changed file is re-read and an unchanged one
// keeps its parse; the service is dropped when the tsconfig changes.
// Overlays: `withOverlay(entry, file, text, fn)` answers a question about unsaved text without touching the disk.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ts } from '@construct/ast/lazy';

export const MAX_FILES = 4000;
export const MAX_CACHED = 3;
export const SOURCE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs']);
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'dist', 'build', 'coverage', '.out']);
let tsLibDirCache;
export const tsLibDir = () => (tsLibDirCache ??= path.dirname(ts.getDefaultLibFilePath({})));
export { ts };

const cache = new Map(); // key -> entry

/** True when `p` is `root` itself or something beneath it. */
export const inside = (root, p) => p === root || p.startsWith(root + path.sep);

/** Every source file under `root` (no symlinks followed, build/vendor folders skipped); `.d.ts` only with includeDts. */
export function sourceFiles(root, { includeDts = false } = {}) {
  const out = [];
  const visit = (dir) => {
    if (out.length > MAX_FILES) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isSymbolicLink()) continue; // never follow a link out of the project
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) visit(p); } else if (SOURCE_EXT.has(path.extname(e.name)) && (includeDts || !e.name.endsWith('.d.ts'))) out.push(p);
    }
  };
  visit(root);
  return out;
}

/** Read the tsconfig with every read confined to `root`. -> { options } | { reason } */
export function readOptions(root) {
  const configPath = path.join(root, 'tsconfig.json');
  if (!fs.existsSync(configPath)) return { reason: 'the project has no tsconfig.json at its root' };
  let escaped = null;
  const confined = (p) => {
    const abs = path.resolve(p);
    if (inside(root, abs) || inside(tsLibDir(), abs)) return true;
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

export function mtimeOf(file) { try { const s = fs.statSync(file); return `${s.mtimeMs}:${s.size}`; } catch { return '0'; } }
const hashOf = (text) => crypto.createHash('sha1').update(text).digest('hex').slice(0, 16);

function serviceFor(key, root, files, options, configMtime, extraRoots) {
  let entry = cache.get(key);
  if (entry && entry.configMtime !== configMtime) { entry.service.dispose(); cache.delete(key); entry = undefined; }
  const readable = (p) => { const a = path.resolve(p); return inside(root, a) || inside(tsLibDir(), a) || extraRoots.some((r) => inside(r, a)); };
  if (!entry) {
    entry = { key, root, configMtime, versions: new Map(), hashed: new Set(), overlays: new Map(), files: [], options, service: null, generation: 0 };
    const host = {
      getScriptFileNames: () => entry.files,
      getScriptVersion: (f) => entry.overlays.get(f)?.version ?? entry.versions.get(f) ?? (inside(tsLibDir(), f) ? '1' : mtimeOf(f)),
      getScriptSnapshot: (f) => {
        const ov = entry.overlays.get(f);
        if (ov) return ts.ScriptSnapshot.fromString(ov.text);
        if (!readable(f)) return undefined;
        try { return ts.ScriptSnapshot.fromString(fs.readFileSync(path.resolve(f), 'utf8')); } catch { return undefined; }
      },
      getCurrentDirectory: () => root,
      getCompilationSettings: () => entry.options,
      getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
      fileExists: (p) => entry.overlays.has(p) || (readable(p) && ts.sys.fileExists(p)),
      readFile: (p) => entry.overlays.get(p)?.text ?? (readable(p) ? ts.sys.readFile(p) : undefined),
      directoryExists: (p) => (inside(root, path.resolve(p)) || extraRoots.some((r) => inside(r, path.resolve(p)))) && ts.sys.directoryExists(p),
      getDirectories: (p) => (readable(p) ? ts.sys.getDirectories(p) : []),
      // contained listing (import-path completions); results outside the readable roots are dropped
      readDirectory: (p, ext, exc, inc, depth) => (readable(p) ? ts.sys.readDirectory(p, ext, exc, inc, depth).filter(readable) : []),
      realpath: (p) => p,
      useCaseSensitiveFileNames: () => true,
    };
    entry.service = ts.createLanguageService(host, ts.createDocumentRegistry(true, root));
    cache.set(key, entry);
    while (cache.size > MAX_CACHED) { const oldest = cache.keys().next().value; cache.get(oldest).service.dispose(); cache.delete(oldest); }
  }
  entry.options = options;
  entry.files = files;
  for (const f of files) if (!entry.hashed.has(f)) entry.versions.set(f, mtimeOf(f)); // an unchanged file keeps its version
  return entry;
}

/**
 * The cached language service for `root`.
 * @param {string} root Absolute project root (must hold tsconfig.json).
 * @param {{includeDts?: boolean, extraRoots?: string[], extraFiles?: string[]}} [opts]
 * @returns {{ok:true, entry:object, service:import('typescript').LanguageService, files:string[]} | {ok:false, reason:string}}
 */
export function openProject(root, { includeDts = false, extraRoots = [], extraFiles = [] } = {}) {
  const r = path.resolve(root);
  const cfg = readOptions(r);
  if (!cfg.options) return { ok: false, reason: cfg.reason };
  const files = sourceFiles(r, { includeDts });
  if (files.length > MAX_FILES) return { ok: false, reason: `the project has more than ${MAX_FILES} source files` };
  for (const f of extraFiles) if (!files.includes(f)) files.push(f);
  const roots = extraRoots.map((x) => path.resolve(x));
  const key = `${r}|${includeDts ? 1 : 0}|${roots.join(',')}`;
  const entry = serviceFor(key, r, files, cfg.options, mtimeOf(path.join(r, 'tsconfig.json')), roots);
  return { ok: true, entry, service: entry.service, files };
}

/**
 * Re-version only the files that changed (content hash), adding new ones and dropping deleted ones; the service
 * re-parses those files and nothing else. -> the files whose version actually changed.
 */
export function updateFiles(entry, changed) {
  const touched = [];
  for (const f0 of changed) {
    const f = path.resolve(f0);
    if (!inside(entry.root, f)) continue;
    let text = null;
    try { text = fs.readFileSync(f, 'utf8'); } catch { text = null; }
    if (text === null) { entry.files = entry.files.filter((x) => x !== f); entry.versions.delete(f); entry.hashed.delete(f); touched.push(f); continue; }
    const v = `h:${hashOf(text)}`;
    if (!entry.files.includes(f)) entry.files = [...entry.files, f];
    if (entry.versions.get(f) !== v) { entry.versions.set(f, v); entry.hashed.add(f); touched.push(f); }
  }
  if (touched.length) entry.generation++;
  return touched;
}

/** Run `fn()` while `file` reads as `text` (an unsaved buffer); the overlay is always removed afterwards. */
export function withOverlay(entry, file, text, fn) {
  if (text == null) return fn();
  const f = path.resolve(file);
  const added = !entry.files.includes(f);
  if (added) entry.files = [...entry.files, f];
  entry.overlays.set(f, { text, version: `o:${hashOf(text)}` });
  try { return fn(); } finally { entry.overlays.delete(f); if (added) entry.files = entry.files.filter((x) => x !== f); }
}

/** Drop every cached service (tests, or after the project changed on disk in a way versions cannot show). */
export function clearHostCache() { for (const e of cache.values()) e.service.dispose(); cache.clear(); }
