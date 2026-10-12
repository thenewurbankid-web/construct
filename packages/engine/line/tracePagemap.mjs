// cu5 -- Trace's page map, reused by its package entry: `line-matcher/pagemap` (trace/package.json "exports"). Nothing
// of Trace is copied here. Trace is not an npm workspace of this repo (it keeps its own lockfile and node_modules), so
// when the package name does not resolve (no node_modules/line-matcher link), the same "./pagemap" entry is read from
// the package.json of the in-repo trace/ folder: the entry the package lists stays the only way in, never a deep path.
//
// No single point of failure: loadTracePagemap never throws. When Trace cannot be loaded it answers {ok: false,
// sentence} and the Pages screen keeps Morpheus's side (parts and library bases) with that one sentence.
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

/** The package and the entry Construct uses. */
export const TRACE_PACKAGE = 'line-matcher';
export const TRACE_ENTRY = './pagemap';

/** Where Trace lives in this repo (the fallback when its package name does not resolve). */
export const TRACE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../trace');

/**
 * The file a package's "exports" lists for one entry, or null.
 * @param {string} dir The package folder.
 * @param {string} entry e.g. "./pagemap".
 * @returns {string|null} Absolute path.
 */
export function exportedFile(dir, entry) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    if (pkg.name !== TRACE_PACKAGE) return null;
    const target = pkg.exports?.[entry];
    const rel = typeof target === 'string' ? target : target?.import ?? target?.default ?? null;
    return typeof rel === 'string' && rel.startsWith('./') ? path.join(dir, rel) : null;
  } catch {
    return null;
  }
}

/** @typedef {{ok: true, via: 'package'|'repo', pagemap: any} | {ok: false, sentence: string}} TraceLoad */

/** @type {Promise<TraceLoad>|null} */
let cached = null;

/**
 * Load Trace's page map once: by the package name, else by the in-repo package's exports entry.
 * @param {{importer?: (specifier: string) => Promise<any>, dir?: string}} [o] `importer` and `dir` are for tests.
 * @returns {Promise<TraceLoad>}
 */
export function loadTracePagemap(o = {}) {
  if (!o.importer && !o.dir && cached) return cached;
  const importer = o.importer ?? ((s) => import(s));
  const run = (async () => {
    try {
      return { ok: /** @type {const} */ (true), via: /** @type {const} */ ('package'), pagemap: await importer(`${TRACE_PACKAGE}/pagemap`) };
    } catch { /* not linked as a package here: use the in-repo package's own entry */ }
    const file = exportedFile(o.dir ?? TRACE_DIR, TRACE_ENTRY);
    if (!file) return { ok: /** @type {const} */ (false), sentence: 'Trace\'s page map is not installed here, so only the library side of this page is shown.' };
    try {
      return { ok: /** @type {const} */ (true), via: /** @type {const} */ ('repo'), pagemap: await importer(pathToFileURL(file).href) };
    } catch {
      return { ok: /** @type {const} */ (false), sentence: 'Trace\'s page map could not be loaded, so only the library side of this page is shown.' };
    }
  })();
  if (!o.importer && !o.dir) cached = run;
  return run;
}
