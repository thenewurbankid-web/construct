// Shared source-parsing engine (Epic 3.1; AST-based since Epic/#76 #88).
//
// Export/import/JSDoc extraction is real AST parsing via
// `@typescript-eslint/typescript-estree` (the npm package that provides
// `typescript-estree`), not regex/text-pattern matching. This fixed the
// documented decorator-before-JSDoc bug (#19): a decorator sitting between a
// JSDoc block and the declaration it annotates no longer breaks association,
// because `extractJsdoc` walks past leading decorators to find the true
// start of the exported declaration, the same way a human reading the code
// would. `complexityEstimate` remains a token-count heuristic, not real
// cyclomatic complexity — that was never in scope for the AST migration.
import fs from 'node:fs';
import path from 'node:path';
import { walk, rel } from './fs.mjs';
import { loadConfig, DEFAULT_LAYERS } from './config.mjs';
import { loadLayerGraph, classifyFile, classifyProjectFile } from './architecture-graph.mjs';
import { readFrozenGlobs } from './frozen.mjs';
import { parseToAst, extractImports, extractExports, extractJsdoc, lineOf } from '../packages/ast/index.mjs';

// Parsing/extraction now live in the shared AST package (packages/ast). Re-exported here so existing
// `import ... from './parser.mjs'` call sites keep working unchanged.
export { parseToAst, extractImports, extractExports, extractJsdoc, lineOf };

export const EXT = new Set(['.ts', '.tsx', '.js', '.jsx']);

/** Compatibility shim (#174): classify a root-relative path against the DEFAULT (Next.js) layer
 * graph. The one real classifier is `classifyFile` / `classifyProjectFile` in
 * architecture-graph.mjs, which honors a project's configured layer patterns and `frozen:`
 * regions; prefer those. */
export function classifyLayer(relPath, graph = DEFAULT_LAYERS) {
  return classifyFile(relPath, graph);
}

/** Rough cyclomatic-complexity-flavored heuristic: count of if/for/while/switch/catch/&&/||
 * tokens plus bare `?` ternaries (optional chaining `?.` and nullish `??` are excluded so
 * modern TS doesn't get wildly over-counted), plus 1. Not a real complexity calculation. */
export function estimateComplexity(source) {
  const controlAndLogical = source.match(/\b(if|for|while|switch|catch)\b|&&|\|\|/g) || [];
  // Strip '?.' and '??' first so a bare '?' immediately after one of them (e.g. the second
  // '?' in '??') is never miscounted as a ternary by a simple per-character lookahead.
  const withoutOptionalAndNullish = source.replace(/\?\.|\?\?/g, '');
  const ternaries = withoutOptionalAndNullish.match(/\?/g) || [];
  return controlAndLogical.length + ternaries.length + 1;
}

/** @typedef {{path:string, layer:string|null, exports:string[], imports:string[], jsdoc:string|null, loc:number, complexityEstimate:number}} Summary */

/** Load the project's layer graph + frozen globs once, to pass as `parseFile`'s `context` when parsing many files. */
export function layerContextFor(root) {
  return { graph: loadLayerGraph(root), frozenGlobs: readFrozenGlobs(root) };
}

/** Parse a single file into a structured Summary. `filePath` may be absolute or root-relative.
 * The layer comes from the project's layer graph (configured patterns, frozen files unclassified);
 * pass `context` (see layerContextFor) to avoid reloading it per file. */
export function parseFile(root, filePath, context) {
  const abs = path.isAbsolute(filePath) ? filePath : path.join(root, filePath);
  const relPath = rel(root, abs);
  const source = fs.readFileSync(abs, 'utf8');
  const layer = classifyProjectFile(root, abs, context);
  const importsList = extractImports(source);
  const exportEntries = extractExports(source);
  const seen = new Set();
  const exportsList = exportEntries.filter((e) => (seen.has(e.name) ? false : (seen.add(e.name), true))).map((e) => e.name);
  const jsdoc = exportEntries.length ? extractJsdoc(source, exportEntries[0].index) : null;
  const loc = source.split('\n').length;
  const complexityEstimate = estimateComplexity(source);
  return { path: relPath, layer, exports: exportsList, imports: importsList, jsdoc, loc, complexityEstimate };
}

/** Aggregate parseFile over every file in `<featureRoot>/<featureName>/`.
 * publicApi is derived from index.ts's exports (empty array if there is no index.ts). */
export function summarizeFeature(root, featureName) {
  const { features } = loadConfig(root);
  const dir = path.join(root, features.root, featureName);
  const files = walk(dir).filter((p) => EXT.has(path.extname(p)));
  const context = layerContextFor(root);
  const summaries = files.map((f) => parseFile(root, f, context));
  const layers = {};
  for (const s of summaries) {
    const key = s.layer || 'unclassified';
    (layers[key] ||= []).push(s);
  }
  const indexRel = `${features.root}/${featureName}/index.ts`;
  const indexSummary = summaries.find((s) => s.path === indexRel);
  const publicApi = indexSummary ? indexSummary.exports : [];
  const loc = summaries.reduce((sum, s) => sum + s.loc, 0);
  return { feature: featureName, publicApi, layers, loc };
}

/** In-memory Map-backed cache keyed on (absolute path, mtimeMs); no external cache library. */
export function createSummaryCache() {
  const cache = new Map(); // absPath -> {mtimeMs, summary}
  return {
    get(root, filePath) {
      const abs = path.isAbsolute(filePath) ? filePath : path.join(root, filePath);
      const stat = fs.statSync(abs);
      const cached = cache.get(abs);
      if (cached && cached.mtimeMs === stat.mtimeMs) return cached.summary;
      const summary = parseFile(root, filePath);
      cache.set(abs, { mtimeMs: stat.mtimeMs, summary });
      return summary;
    },
  };
}
