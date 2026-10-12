// Line Import v2 -- the content-hash cache of the import's slow stages (Fix 3, speed). A second `start` on files that did
// not change reuses what the first one found; a changed file invalidates only its own entries and those of the files
// that import it (directly or through other files).
//
//   createLineCache(folderRoot)   get/put JSON entries under <folder>/line/cache/<kind>/<key>.json, written through
//                                 Construct's writer (writeLineState); hits and misses are counted per kind
//   createDepHasher(appRoot)      fileHash(rel): the file's content; depsHash(rel): the file and every in-app file it
//                                 imports, transitively (route-resolver's alias and specifier resolution)
//   charSalt(appRoot)             what every characterize entry also depends on: the characterizer's own code and the
//                                 app's test setup (package.json, lockfile, jest config), so a change there starts over
//
// The cached kinds (each keyed by content, never by time):
//   logic-units  logicMap.mjs fileUnits of one file             key: the file's path and content
//   analysis     characterize/analyze.mjs analyzeClosure        key: every closure file's depsHash, the routes
//   subject      a subject's kept cases (search + record + lock) key: the subject, its file's depsHash, the options
//   jest-cov     one locked test file's coverage (all passed)   key: the test file's text, its subject file's depsHash
//   jest-pass    one test file passed in the app's runner        key: the test file's text, the depsHash of what it imports
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readPathAliases, resolveImportSpecifier } from '@line/construct-core/route-resolver';
import { writeLineState } from '../../transactionalWriter.mjs';

/** Bump when an entry's shape changes: every older entry is then a miss. */
export const CACHE_VERSION = 1;
export const CACHE_DIR = 'line/cache';

const posix = (p) => String(p).split(path.sep).join('/');

/**
 * A stable hash of any JSON value (sha256, 32 hex characters).
 * @param {...any} parts
 * @returns {string}
 */
export function hashOf(...parts) {
  const h = crypto.createHash('sha256');
  for (const p of parts) h.update(typeof p === 'string' ? p : JSON.stringify(p) ?? 'undefined').update('\u0000');
  return h.digest('hex').slice(0, 32);
}

/**
 * The cache inside a Line folder.
 * @param {string} folderRoot The Line folder (the root writeLineState writes under).
 * @param {{stateDir?: string}} [o]
 * @returns {{get: (kind: string, key: string) => any, put: (kind: string, key: string, value: any) => void, stats: Record<string, {hits: number, misses: number}>, dir: string}}
 */
export function createLineCache(folderRoot, o = {}) {
  const stateDir = o.stateDir ?? 'line';
  const rel = (kind, key) => `${stateDir}/cache/${kind}/${key}.json`;
  /** @type {Record<string, {hits: number, misses: number}>} */
  const stats = {};
  const count = (kind, hit) => { stats[kind] ??= { hits: 0, misses: 0 }; stats[kind][hit ? 'hits' : 'misses']++; };
  return {
    dir: path.join(folderRoot, stateDir, 'cache'),
    stats,
    get(kind, key) {
      let v = null;
      try { v = JSON.parse(fs.readFileSync(path.join(folderRoot, rel(kind, key)), 'utf8')); } catch { v = null; }
      const ok = v && v.v === CACHE_VERSION;
      count(kind, ok);
      return ok ? v.value : null;
    },
    put(kind, key, value) {
      writeLineState(folderRoot, rel(kind, key), `${JSON.stringify({ v: CACHE_VERSION, value })}\n`, { stateDir });
    },
  };
}

const IMPORT_RE = /(?:import\s+(?:type\s+)?[\s\S]*?from\s*|import\s*\(|export\s+(?:type\s+)?(?:\*|\{[^}]*\})\s*from\s*|jest\.mock\(\s*|require\(\s*)(['"])(.*?)\1/g;

/**
 * Content hashes of an app's files, and of each file together with every in-app file it imports (transitively).
 * Resolution is route-resolver's (relative specifiers and tsconfig path aliases); packages are not followed.
 * @param {string} appRoot
 * @returns {{fileHash: (rel: string) => string, depsOf: (rel: string) => string[], depsHash: (rel: string) => string}}
 */
export function createDepHasher(appRoot) {
  const { aliases } = readPathAliases(appRoot);
  /** @type {Map<string, string>} */
  const contents = new Map();
  /** @type {Map<string, string[]>} */
  const direct = new Map();
  /** @type {Map<string, string>} */
  const deep = new Map();
  const abs = (rel) => path.resolve(appRoot, rel);
  const relOf = (a) => posix(path.relative(appRoot, a));
  const fileHash = (rel) => {
    const r = posix(rel);
    if (!contents.has(r)) {
      let text = null;
      try { text = fs.readFileSync(abs(r)); } catch { text = null; }
      contents.set(r, text === null ? 'missing' : crypto.createHash('sha256').update(text).digest('hex').slice(0, 32));
    }
    return /** @type {string} */ (contents.get(r));
  };
  const directOf = (rel) => {
    const r = posix(rel);
    if (!direct.has(r)) {
      const out = new Set();
      let source = '';
      try { source = /\.(?:[cm]?[jt]sx?)$/.test(r) ? fs.readFileSync(abs(r), 'utf8') : ''; } catch { source = ''; }
      for (const m of source.matchAll(IMPORT_RE)) {
        const to = resolveImportSpecifier(abs(r), m[2], aliases);
        if (to && !posix(to).includes('/node_modules/')) out.add(relOf(to));
      }
      direct.set(r, [...out].sort());
    }
    return /** @type {string[]} */ (direct.get(r));
  };
  const depsOf = (rel) => {
    const seen = new Set([posix(rel)]);
    const queue = [posix(rel)];
    while (queue.length) for (const d of directOf(/** @type {string} */ (queue.shift()))) if (!seen.has(d)) { seen.add(d); queue.push(d); }
    return [...seen].sort();
  };
  const depsHash = (rel) => {
    const r = posix(rel);
    if (!deep.has(r)) deep.set(r, hashOf(depsOf(r).map((d) => [d, fileHash(d)])));
    return /** @type {string} */ (deep.get(r));
  };
  return { fileHash, depsOf, depsHash };
}

const here = path.dirname(fileURLToPath(import.meta.url));
const CHARACTERIZER = ['../characterize.mjs', '../characterize/analyze.mjs', '../characterize/emit.mjs', '../characterize/runtime.cjs', '../characterize/unitCoverage.mjs', '../characterize/fileCoverageReporter.cjs'];
const APP_SETUP = ['package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'tsconfig.json', 'jest.config.js', 'jest.config.cjs', 'jest.config.mjs', 'jest.config.ts', 'jest.setup.js', 'jest.setup.ts', 'babel.config.js', '.babelrc'];

/**
 * What every characterize entry also depends on: the characterizer's own code and the app's test setup.
 * @param {string} appRoot
 * @returns {string}
 */
export function charSalt(appRoot) {
  const read = (p) => { try { return fs.readFileSync(p); } catch { return ''; } };
  return hashOf(CACHE_VERSION, ...CHARACTERIZER.map((f) => hashOf(read(path.join(here, f)).toString())), ...APP_SETUP.map((f) => hashOf(read(path.join(appRoot, f)).toString())));
}
