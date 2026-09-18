// Shared source-parsing engine (Epic 3.1).
//
// Deliberate simplification: this is regex/heuristic extraction, not a real
// AST parser (no typescript-estree/acorn dependency was added — package.json
// is owned by another workstream while this module was built). Known rough
// edges: decorators sitting between a JSDoc block and the declaration they
// annotate break "immediately preceding" JSDoc association (a real AST
// would attach the comment to the decorated node); `complexityEstimate` is a
// token-count heuristic, not real cyclomatic complexity. See parser.test.mjs
// for documented cases.
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { walk, rel } from './fs.mjs';

export const EXT = new Set(['.ts', '.tsx', '.js', '.jsx']);

function readArchitectureYaml(root) {
  const file = path.join(root, 'architecture.yml');
  if (!fs.existsSync(file)) return {};
  try {
    const parsed = yaml.load(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** Minimal, permissive read of the parts of architecture.yml this module needs (feature
 * root, exceptions, raw rule overrides/thresholds). Deliberately does NOT use src/config.mjs's
 * loadConfig(): that loader validates `rules` against its own DEFAULT_RULES table and throws
 * on unknown ids — which would reject READ-* keys until another module merges
 * READABILITY_RULES (see src/readability-enforcer.mjs) into config.mjs's table. This reader
 * is intentionally permissive (best-effort, never throws) and only used for the few fields
 * this module and the readability enforcer need. */
export function projectSettings(root) {
  const raw = readArchitectureYaml(root);
  return {
    featureRoot: raw.features?.root || 'features',
    exceptions: raw.exceptions || [],
    rules: raw.rules || {},
  };
}

/** Classify a root-relative path into an architecture layer, or null if
 * unclassified. Implemented locally (not imported) per module ownership
 * boundaries. */
export function classifyLayer(relPath) {
  if (/^app\/.*page\.(tsx|ts|jsx|js)$/.test(relPath)) return 'route';
  const m = relPath.match(/^features\/[^/]+\/(controllers|workflows|hooks|domain|services|pages|components)\//);
  if (!m) return null;
  return { controllers: 'controller', workflows: 'workflow', hooks: 'hook', domain: 'domain', services: 'service', pages: 'page', components: 'component' }[m[1]];
}

/** Module specifiers referenced by static or dynamic import, e.g. `import x from 'y'` or `import('y')`. */
export function extractImports(source) {
  return [...source.matchAll(/(?:import\s+(?:type\s+)?[\s\S]*?from\s*|import\s*\()(['"])(.*?)\1/g)].map((m) => m[2]);
}

/** Exported identifiers with their source index, sorted by position. Handles named
 * function/class/const/let/var exports, `export default function|class <Name>`,
 * `export default <identifier>;`, `export { a, b as c }` lists (alias wins), and
 * wildcard re-exports (`export * from '...'`, `export type * from '...'` — named
 * after their module specifier, since there's no local identifier to report). */
export function extractExports(source) {
  const results = [];
  const push = (name, index) => { if (name) results.push({ name, index }); };

  for (const m of source.matchAll(/\bexport\s+default\s+(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)?/g)) push(m[1] || 'default', m.index);
  for (const m of source.matchAll(/\bexport\s+default\s+class\s+([A-Za-z_$][\w$]*)?/g)) push(m[1] || 'default', m.index);
  for (const m of source.matchAll(/\bexport\s+(?:async\s+)?function\s*\*?\s+([A-Za-z_$][\w$]*)/g)) push(m[1], m.index);
  for (const m of source.matchAll(/\bexport\s+class\s+([A-Za-z_$][\w$]*)/g)) push(m[1], m.index);
  for (const m of source.matchAll(/\bexport\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) push(m[1], m.index);
  for (const m of source.matchAll(/\bexport\s+default\s+([A-Za-z_$][\w$]*)\s*;/g)) push(m[1], m.index);
  for (const m of source.matchAll(/\bexport\s*\{([^}]*)\}/g)) {
    for (const entry of m[1].split(',')) {
      const parts = entry.trim().split(/\s+as\s+/);
      const name = (parts[1] || parts[0] || '').trim();
      if (name) push(name, m.index);
    }
  }
  for (const m of source.matchAll(/\bexport\s+(?:type\s+)?\*\s*(?:as\s+([A-Za-z_$][\w$]*)\s*)?from\s*(['"])(.*?)\2/g)) {
    push(m[1] || m[3], m.index);
  }
  return results.sort((a, b) => a.index - b.index);
}

/** The `/** ... *\/` block immediately preceding `index` (only whitespace between), or null. */
export function extractJsdoc(source, index) {
  const before = source.slice(0, index);
  const m = before.match(/\/\*\*[\s\S]*?\*\/\s*$/);
  return m ? m[0].replace(/\s+$/, '') : null;
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

export function lineOf(source, index) {
  return source.slice(0, index).split('\n').length;
}

/** @typedef {{path:string, layer:string|null, exports:string[], imports:string[], jsdoc:string|null, loc:number, complexityEstimate:number}} Summary */

/** Parse a single file into a structured Summary. `filePath` may be absolute or root-relative. */
export function parseFile(root, filePath) {
  const abs = path.isAbsolute(filePath) ? filePath : path.join(root, filePath);
  const relPath = rel(root, abs);
  const source = fs.readFileSync(abs, 'utf8');
  const layer = classifyLayer(relPath);
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
  const { featureRoot } = projectSettings(root);
  const dir = path.join(root, featureRoot, featureName);
  const files = walk(dir).filter((p) => EXT.has(path.extname(p)));
  const summaries = files.map((f) => parseFile(root, f));
  const layers = {};
  for (const s of summaries) {
    const key = s.layer || 'unclassified';
    (layers[key] ||= []).push(s);
  }
  const indexRel = `${featureRoot}/${featureName}/index.ts`;
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
