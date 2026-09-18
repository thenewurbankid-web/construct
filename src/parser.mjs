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
import yaml from 'js-yaml';
import { parse } from '@typescript-eslint/typescript-estree';
import { walk, rel } from './fs.mjs';

// Single-slot memoized parse: parseFile and the readability enforcer's
// checkFeatureJsdoc both call extractImports/extractExports/extractJsdoc
// back-to-back on the *same* source string, so caching the most recent
// (source -> ast) pair avoids re-parsing the same file 2-3x per call site
// without the complexity of a real LRU. Not safe to rely on across
// different source strings interleaved by async code, but every call site
// in this codebase is synchronous.
let cachedSource;
let cachedAst;

const PARSE_OPTIONS = { comment: true, loc: true, range: true, errorOnUnknownASTType: false };

/** Parse `source` into a typescript-estree AST (with `comments`), trying JSX
 * mode first (works for both .tsx and plain .ts/.js in the overwhelming
 * common case) and falling back to non-JSX mode only if JSX parsing fails —
 * these functions take `source` alone (no file path), so the extension
 * isn't available to decide up front. Exported for reuse by other modules
 * migrating off regex/text-pattern parsing (e.g. architecture-enforcer.mjs). */
export function parseToAst(source) {
  if (source === cachedSource) return cachedAst;
  let ast;
  try {
    ast = parse(source, { ...PARSE_OPTIONS, jsx: true });
  } catch (err) {
    try {
      ast = parse(source, { ...PARSE_OPTIONS, jsx: false });
    } catch {
      throw err; // surface the original (jsx-mode) error — usually the more informative one
    }
  }
  cachedSource = source;
  cachedAst = ast;
  return ast;
}

/** Recursively collect every bound identifier name out of a destructuring
 * pattern (Identifier, ObjectPattern, ArrayPattern, AssignmentPattern,
 * RestElement), e.g. `const { a, b: renamed, ...rest } = x` -> ['a',
 * 'renamed', 'rest']. Used by extractExports for `export const`/`let`/`var`
 * so every declared binding is reported, not just the first identifier
 * after the keyword (a real gap in the old regex-based version). */
function collectPatternNames(node, out) {
  if (!node) return;
  switch (node.type) {
    case 'Identifier':
      out.push(node.name);
      break;
    case 'ObjectPattern':
      for (const prop of node.properties) {
        collectPatternNames(prop.type === 'RestElement' ? prop.argument : prop.value, out);
      }
      break;
    case 'ArrayPattern':
      for (const el of node.elements) collectPatternNames(el, out);
      break;
    case 'AssignmentPattern':
      collectPatternNames(node.left, out);
      break;
    case 'RestElement':
      collectPatternNames(node.argument, out);
      break;
    default:
      break;
  }
}

/** Depth-first walk collecting every `import('...')` dynamic-import
 * expression (ImportExpression nodes) reachable anywhere in the tree —
 * unlike static ImportDeclarations, these aren't confined to the top level
 * of Program.body. Only literal string sources are collected (an
 * expression source, e.g. `import(path)`, isn't a specifier and was never
 * matched by the old regex either). */
function collectDynamicImports(node, out) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const n of node) collectDynamicImports(n, out);
    return;
  }
  if (typeof node.type !== 'string') return;
  if (node.type === 'ImportExpression' && node.source?.type === 'Literal' && typeof node.source.value === 'string') {
    out.push({ index: node.range[0], value: node.source.value });
  }
  for (const key of Object.keys(node)) {
    if (key === 'parent' || key === 'range' || key === 'loc') continue;
    const value = node[key];
    if (value && typeof value === 'object') collectDynamicImports(value, out);
  }
}

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

/** Classify a root-relative path into an architecture layer, or null if unclassified.
 * Mirrors the path-pattern approach in src/validator.mjs's layerOf() (reimplemented
 * locally, not imported, per module ownership boundaries). */
export function classifyLayer(relPath) {
  if (/^app\/.*page\.(tsx|ts|jsx|js)$/.test(relPath)) return 'route';
  const m = relPath.match(/^features\/[^/]+\/(controllers|workflows|hooks|domain|services|pages|components)\//);
  if (!m) return null;
  return { controllers: 'controller', workflows: 'workflow', hooks: 'hook', domain: 'domain', services: 'service', pages: 'page', components: 'component' }[m[1]];
}

/** Module specifiers referenced by static or dynamic import, e.g. `import x from 'y'` or `import('y')`,
 * in source-position order. AST-based: walks real ImportDeclaration nodes plus ImportExpression
 * (dynamic `import(...)`) nodes anywhere in the tree, so a specifier-shaped string sitting inside a
 * comment or a string literal is never mistaken for a real import (the #74 false-positive class). */
export function extractImports(source) {
  const ast = parseToAst(source);
  const entries = [];
  for (const node of ast.body) {
    if (node.type === 'ImportDeclaration') entries.push({ index: node.range[0], value: node.source.value });
  }
  collectDynamicImports(ast, entries);
  return entries.sort((a, b) => a.index - b.index).map((e) => e.value);
}

/** Exported identifiers with their source index, sorted by position. Handles named
 * function/class/const/let/var exports (including destructured/multi-declarator
 * `export const a = 1, { b, c: renamed } = obj`), `export default function|class <Name>`,
 * `export default <identifier>;`, `export { a, b as c }` lists (alias wins), and
 * wildcard re-exports (`export * from '...'`, `export type * from '...'` — named
 * after their module specifier, since there's no local identifier to report).
 * AST-based: reads real ExportNamedDeclaration/ExportDefaultDeclaration/
 * ExportAllDeclaration nodes instead of scanning raw text, so `index` always points at
 * the true start of the export statement (the `export` keyword — decorators, if any,
 * sit *before* it in source and are handled separately by extractJsdoc, not here). */
export function extractExports(source) {
  const ast = parseToAst(source);
  const results = [];
  const push = (name, index) => { if (name) results.push({ name, index }); };

  for (const node of ast.body) {
    if (node.type === 'ExportNamedDeclaration') {
      const decl = node.declaration;
      if (decl) {
        if (decl.type === 'VariableDeclaration') {
          for (const declarator of decl.declarations) {
            const names = [];
            collectPatternNames(declarator.id, names);
            for (const name of names) push(name, node.range[0]);
          }
        } else {
          // FunctionDeclaration / ClassDeclaration / TSDeclareFunction, etc. — anything with an `id`.
          push(decl.id?.name, node.range[0]);
        }
      } else if (node.specifiers?.length) {
        for (const spec of node.specifiers) {
          push(spec.exported?.name ?? spec.exported?.value, node.range[0]);
        }
      }
    } else if (node.type === 'ExportDefaultDeclaration') {
      const decl = node.declaration;
      const name = decl.type === 'Identifier' ? decl.name : (decl.id?.name || 'default');
      push(name, node.range[0]);
    } else if (node.type === 'ExportAllDeclaration') {
      push(node.exported?.name || node.source?.value, node.range[0]);
    }
  }
  return results.sort((a, b) => a.index - b.index);
}

/** The `/** ... *\/` JSDoc block belonging to the export statement starting at `index`
 * (as returned by extractExports), or null. AST-based: finds the block comment
 * immediately preceding the declaration, walking back past any leading decorators
 * (`@Component(...)`) sitting between the comment and the declaration they annotate —
 * this is the fix for #19, where regex-based "immediately preceding" association broke
 * on a decorator in between. Falls back to treating `index` itself as the boundary
 * when it doesn't match a parsed top-level export node (defensive; every real call site
 * passes an index from extractExports). */
export function extractJsdoc(source, index) {
  const ast = parseToAst(source);
  const node = ast.body.find((n) => n.range && n.range[0] === index);
  const decorators = node?.declaration?.decorators || node?.decorators || [];
  const boundary = decorators.length ? Math.min(...decorators.map((d) => d.range[0])) : index;

  let best = null;
  for (const comment of ast.comments || []) {
    if (comment.type !== 'Block' || !comment.value.startsWith('*')) continue;
    if (comment.range[1] > boundary) continue;
    if (!best || comment.range[1] > best.range[1]) best = comment;
  }
  if (!best) return null;
  if (/\S/.test(source.slice(best.range[1], boundary))) return null;
  return source.slice(best.range[0], best.range[1]);
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
