// Line logic verification, step 7 (spec G, speed): analyzeClosure cached in memory by content. The characterizer's
// static read (characterize/analyze.mjs analyzeClosure: one TypeScript program per call, about 80 to 110 ms per root)
// is what the logic-verify layers spend most of their time in (fastCheckLayer minedSeeds, layoutRun verifyLayoutPair),
// once per side per unit; a repeated import of unchanged files now skips it.
//
//   createAnalysisCache({max})   a bounded (LRU) cache: analyze(appRoot, closure) -> ClosureAnalysis, stats, clear()
//   analyzeClosureCached         the process-wide instance's analyze (what logicVerify calls)
//
// The key is everything the result depends on, by content, never by time:
//   - the app root (results carry app-relative paths and read app-wide files);
//   - every closure file's depsHash (importV2/cache.mjs createDepHasher: the file and every in-app file it imports,
//     transitively, so a changed imported type or JSON fixture invalidates it);
//   - the routes;
//   - charSalt (the characterizer's own code, the app's package.json, lockfile, tsconfig and test setup);
//   - the files `env` reads outside the closure (findHosts' layout/_app candidates, findRenderHelper's test-utils).
// The disk cache of the characterize stage (characterize.mjs, kind `analysis`) is separate and unchanged.
// A hit returns a structured clone, so a caller that edits its result cannot change the next caller's.
import fs from 'node:fs';
import path from 'node:path';
import { analyzeClosure } from './analyze.mjs';
import { createDepHasher, charSalt, hashOf } from '../importV2/cache.mjs';

/** @typedef {ReturnType<typeof analyzeClosure>} ClosureAnalysis */

export const ANALYSIS_CACHE_MAX = 64;

const posix = (p) => String(p).split(path.sep).join('/');
const ENV_DIRS = ['src/libs', 'src/lib', 'src/test', 'src/tests', 'src/utils', 'test', 'tests', 'src'];
const ENV_FILES = ['src/app/layout.tsx', 'app/layout.tsx', 'src/pages/_app.tsx', 'src/App.tsx', 'src/main.tsx'];

/** The files analyzeClosure's `env` reads outside the closure, as [rel, contentHash] (findHosts, findRenderHelper). */
function envFiles(appRoot, deps) {
  const rels = [...ENV_FILES];
  for (const d of ['src/app', 'app']) {
    let names = [];
    try { names = fs.readdirSync(path.join(appRoot, d)); } catch { names = []; }
    for (const n of names) if (fs.existsSync(path.join(appRoot, d, n, 'layout.tsx'))) rels.push(`${d}/${n}/layout.tsx`);
  }
  for (const d of ENV_DIRS) {
    let names = [];
    try { names = fs.readdirSync(path.join(appRoot, d)); } catch { names = []; }
    for (const n of names) if (/^(test-utils|testUtils|render)\.(t|j)sx?$/.test(n)) rels.push(`${d}/${n}`);
  }
  return rels.sort().map((r) => [r, deps.fileHash(r)]);
}

/**
 * The cache key of one analyzeClosure call (exported for tests).
 * @param {string} appRoot
 * @param {{files: string[], routes?: {route?: string, entry: string}[]}} closure
 * @returns {string}
 */
export function analysisKey(appRoot, closure) {
  const root = path.resolve(appRoot);
  // a fresh hasher per call: its memo would otherwise keep an edited file's old hash
  const deps = createDepHasher(root);
  const rel = (f) => posix(path.isAbsolute(f) ? path.relative(root, f) : f);
  const files = [...new Set(closure.files.map(rel))].sort();
  return hashOf('analysis-mem', root, charSalt(root), closure.routes ?? [], files.map((f) => [f, deps.depsHash(f)]), envFiles(root, deps));
}

/**
 * A bounded, least-recently-used cache of analyzeClosure results.
 * @param {{max?: number, analyze?: typeof analyzeClosure}} [o] `analyze`: the function cached (tests count its calls).
 * @returns {{analyze: (appRoot: string, closure: {files: string[], routes?: any[]}) => ClosureAnalysis, stats: {hits: number, misses: number, size: number}, clear: () => void}}
 */
export function createAnalysisCache(o = {}) {
  const max = Math.max(1, o.max ?? ANALYSIS_CACHE_MAX);
  const run = o.analyze ?? analyzeClosure;
  /** @type {Map<string, ClosureAnalysis>} */
  const entries = new Map();
  const stats = { hits: 0, misses: 0, size: 0 };
  return {
    stats,
    analyze(appRoot, closure) {
      const key = analysisKey(appRoot, closure);
      const hit = entries.get(key);
      if (hit) {
        entries.delete(key);
        entries.set(key, hit); // most recently used last
        stats.hits++;
        return structuredClone(hit);
      }
      stats.misses++;
      const value = run(appRoot, closure);
      entries.set(key, structuredClone(value));
      while (entries.size > max) entries.delete(/** @type {string} */ (entries.keys().next().value));
      stats.size = entries.size;
      return value;
    },
    clear() { entries.clear(); stats.size = 0; },
  };
}

const shared = createAnalysisCache();

/** The process-wide cache's stats (hits, misses, size). */
export const analysisCacheStats = shared.stats;

/**
 * analyzeClosure through the process-wide bounded cache.
 * @param {string} appRoot
 * @param {{files: string[], routes?: {route?: string, entry: string}[]}} closure
 * @returns {ClosureAnalysis}
 */
export function analyzeClosureCached(appRoot, closure) {
  return shared.analyze(appRoot, closure);
}
