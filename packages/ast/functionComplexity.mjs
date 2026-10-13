// AST package: per-function complexity (#923), from open-source counters rather than a hand-written one.
//
// CYCLOMATIC comes from ESLint's core `complexity` rule (MIT; ESLint's "classic" variant), run in-process through
// ESLint's Linter with @typescript-eslint/parser at max 0, so every function reports its number; each report is mapped
// back to the function node it names by position. ESLint's decision set (ESLint 10): 1 + if, `?:`, `&&`, `||`, `??`,
// `&&=`, `||=`, `??=`, each optional-chaining `?.`, each default parameter value, `case` with a test (not `default`),
// for / for-in / for-of / while / do-while, catch. Every function is measured on its own body (a nested callback is its
// own entry), as ESLint does.
//
// COGNITIVE comes from fallow (`fallow health --format json`, run by the fallow runner block, not by this module): pass
// its per-function results (fallowFunctions) and each function picks its own up by file + start line; without them
// `cognitive` is null. MAX NESTING, RETURNS and PARAMS are read from the same typescript-estree parse the rest of this
// package uses (no count of decisions): max nesting is the deepest stack of if / loop / switch / catch / `?:` bodies,
// returns are explicit `return`s (a concise arrow body counts as 1), params exclude a TypeScript `this` parameter.
import { createRequire } from 'node:module';
import { parseToAst } from './parse.mjs';

const require = createRequire(import.meta.url);
const FN_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
const NESTING_TYPES = new Set(['IfStatement', 'SwitchStatement', 'CatchClause', 'ConditionalExpression', 'ForStatement', 'ForInStatement', 'ForOfStatement', 'WhileStatement', 'DoWhileStatement']);
const SKIP_KEYS = new Set(['parent', 'loc', 'range', 'typeAnnotation', 'returnType', 'typeParameters', 'typeArguments', 'decorators']);
const REPORT = /has a complexity of (\d+)\./;

/** Child nodes of `node` (every object with a `type` under a non-positional key), in source order. */
function children(node) {
  const out = [];
  for (const key of Object.keys(node)) {
    if (SKIP_KEYS.has(key)) continue;
    const v = node[key];
    if (Array.isArray(v)) { for (const x of v) if (x && typeof x.type === 'string') out.push(x); }
    else if (v && typeof v.type === 'string') out.push(v);
  }
  return out;
}

let linter;
/** ESLint's Linter and its flat config (the `complexity` rule at max 0), loaded on first use. */
function eslint() {
  if (!linter) {
    const { Linter } = require('eslint');
    const parser = require('@typescript-eslint/parser');
    const rules = { complexity: ['warn', { max: 0 }] };
    linter = {
      instance: new Linter({ configType: 'flat' }),
      tsx: [{ files: ['**/*.tsx'], languageOptions: { parser, parserOptions: { ecmaFeatures: { jsx: true } } }, rules }],
      ts: [{ files: ['**/*.ts'], languageOptions: { parser }, rules }],
    };
  }
  return linter;
}

/**
 * ESLint `complexity` reports for `source`: one {line, column, cyclomatic} per function (1-based line and column, at
 * the function's head). JSX mode first, plain TypeScript when that does not parse (an angle-bracket cast).
 * @param {string} source
 * @returns {{line: number, column: number, cyclomatic: number, message: string}[]}
 * @throws {Error} When the source parses in neither mode.
 */
export function eslintCyclomatic(source) {
  const { instance, tsx, ts } = eslint();
  let messages = instance.verify(source, tsx, 'unit.tsx');
  if (messages.some((m) => m.fatal)) messages = instance.verify(source, ts, 'unit.ts');
  const fatal = messages.find((m) => m.fatal);
  if (fatal) throw new Error(fatal.message);
  return messages.filter((m) => m.ruleId === 'complexity').map((m) => ({ line: m.line, column: m.column, cyclomatic: Number(REPORT.exec(m.message)?.[1] ?? 1), message: m.message }));
}

/**
 * Name a function node the way a person would (mirrors packages/engine/line/logicMap.mjs's functionName, so the two
 * agree): its own id, its variable, its property/method key, `on:<attr>` for an inline JSX handler, the const a
 * useCallback/useMemo or a typed-contract factory (`const reduce = defineDomain('reduce', (...) => ...)`, any
 * `define<Name>(...)`) is assigned to, `default` for an anonymous default export; otherwise null.
 * @param {any} node The function node.
 * @param {any} [parent] Its parent.
 * @param {any} [grand] Its grandparent.
 * @returns {string|null} The name, or null.
 */
export function complexityFunctionName(node, parent, grand) {
  if (node.id?.name) return node.id.name;
  if (parent?.type === 'VariableDeclarator' && parent.id.type === 'Identifier') return parent.id.name;
  if ((parent?.type === 'Property' || parent?.type === 'MethodDefinition' || parent?.type === 'PropertyDefinition') && parent.key?.type === 'Identifier') return parent.key.name;
  if (parent?.type === 'JSXExpressionContainer' && grand?.type === 'JSXAttribute') return `on:${grand.name.name ?? '?'}`;
  if (parent?.type === 'CallExpression' && grand?.type === 'VariableDeclarator' && grand.id.type === 'Identifier' && /^(use(Callback|Memo)|define[A-Z]\w*)$/.test(parent.callee?.name ?? '')) return grand.id.name;
  if (parent?.type === 'ExportDefaultDeclaration') return 'default';
  return null;
}

/** Max nesting and explicit returns of one function's own body (nested functions excluded). */
function shape(fn) {
  let maxNesting = 0;
  let returns = 0;
  const visit = (node, level) => {
    if (!node || FN_TYPES.has(node.type)) return;
    if (node.type === 'ReturnStatement') returns += 1;
    const deeper = NESTING_TYPES.has(node.type);
    for (const c of children(node)) {
      // a structure's condition stays at its own level; its bodies are one deeper
      const isCondition = deeper && (c === node.test || c === node.discriminant || c === node.right || c === node.init || c === node.update || c === node.param);
      const next = deeper && !isCondition && !(node.type === 'IfStatement' && c.type === 'IfStatement' && c === node.alternate) ? level + 1 : level;
      if (next > maxNesting) maxNesting = next;
      visit(c, next);
    }
  };
  if (fn.body.type === 'BlockStatement') visit(fn.body, 0);
  else { returns = 1; visit(fn.body, 0); }
  return { maxNesting, returns };
}

/**
 * @typedef {object} FallowFunction One function from `fallow health --format json`, normalized by fallowFunctions.
 * @property {number} line            1-based start line.
 * @property {string|null} name
 * @property {number|null} cognitive
 * @property {number|null} cyclomatic
 */

/**
 * @typedef {object} FunctionComplexity
 * @property {string|null} name    See complexityFunctionName; null for an anonymous callback.
 * @property {number} index        Start offset of the function node.
 * @property {number} line         1-based first line.
 * @property {number} endLine      1-based last line.
 * @property {number} loc          Lines spanned (endLine - line + 1).
 * @property {number} params
 * @property {number} cyclomatic   ESLint `complexity`.
 * @property {number|null} cognitive  fallow's cognitive complexity, or null when fallow's results were not given.
 * @property {number} maxNesting
 * @property {number} returns
 */

/**
 * Per-function complexity for every function in a file (declarations, function expressions, arrows, class and object
 * methods, TSX components), in source order: cyclomatic from ESLint's `complexity` rule, cognitive from fallow's
 * results when given. The counting sets are in this module's header.
 *
 * @param {string} source Source text.
 * @param {{ast?: object, fallow?: FallowFunction[]}} [options] `ast`: the same source already parsed with parseToAst;
 *   `fallow`: this file's fallow functions (fallowFunctions(report).get(file)).
 * @returns {FunctionComplexity[]} One entry per function, in source order.
 *
 * @example
 * functionComplexity('function f(a, b) { if (a && b) return 1; return 2; }');
 * // => [{ name: 'f', index: 0, line: 1, endLine: 1, loc: 1, params: 2, cyclomatic: 3, cognitive: null, maxNesting: 1, returns: 2 }]
 */
export function functionComplexity(source, { ast = parseToAst(source), fallow = [] } = {}) {
  /** @type {{node: any, start: number, name: string|null}[]} */
  const fns = [];
  const stack = [];
  (function walk(node, parent) {
    stack.push(node);
    if (FN_TYPES.has(node.type) && node.body) {
      // a method's report sits on its key, before the FunctionExpression starts: match from the key
      const owner = parent && (parent.type === 'MethodDefinition' || parent.type === 'Property' || parent.type === 'PropertyDefinition') && parent.value === node ? parent : node;
      fns.push({ node, start: owner.range[0], name: complexityFunctionName(node, parent, stack[stack.length - 3]) });
    }
    for (const c of children(node)) walk(c, node);
    stack.pop();
  })(ast, null);
  if (!fns.length) return [];

  // ESLint reports at the function's head; the innermost function whose range holds that offset is the one it names.
  const lineStarts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === '\n') lineStarts.push(i + 1);
  const cyclomatic = new Map();
  for (const r of eslintCyclomatic(source)) {
    if (/^Class (field initializer|static block)/.test(r.message)) continue;
    const offset = lineStarts[r.line - 1] + r.column - 1;
    let best = null;
    for (const f of fns) if (f.start <= offset && offset < f.node.range[1] && (!best || f.start >= best.start)) best = f;
    if (best && !cyclomatic.has(best.node)) cyclomatic.set(best.node, r.cyclomatic);
  }

  const used = new Set();
  const perLine = new Map();
  for (const f of fns) perLine.set(f.node.loc.start.line, (perLine.get(f.node.loc.start.line) ?? 0) + 1);
  // fallow's result for a function: same start line; on a line with several functions, the same name (or an unnamed one)
  const cognitiveOf = (line, name) => {
    const here = fallow.filter((x) => x.line === line && !used.has(x));
    const hit = here.find((x) => name && x.name === name) ?? here.find((x) => !x.name) ?? (perLine.get(line) === 1 ? here[0] : undefined);
    if (!hit) return null;
    used.add(hit);
    return hit.cognitive ?? null;
  };
  return fns.map(({ node, name }) => ({
    name,
    index: node.range[0],
    line: node.loc.start.line,
    endLine: node.loc.end.line,
    loc: node.loc.end.line - node.loc.start.line + 1,
    params: node.params.filter((p) => !(p.type === 'Identifier' && p.name === 'this')).length,
    cyclomatic: cyclomatic.get(node) ?? 1,
    cognitive: cognitiveOf(node.loc.start.line, name),
    ...shape(node),
  })).sort((a, b) => a.index - b.index);
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Normalize a `fallow health --format json` report into its per-function results by file. Tolerant of the report's
 * exact nesting: every object anywhere in it that carries a file (`path` / `file` / `filePath`), a start `line` and a
 * `cognitive` (or `cognitive_complexity` / `cognitiveComplexity`) number is one function. Paths are kept as fallow
 * wrote them, with backslashes turned into slashes and a leading `./` dropped.
 * @param {any} report The parsed JSON.
 * @returns {Map<string, FallowFunction[]>} File -> its functions.
 */
export function fallowFunctions(report) {
  /** @type {Map<string, FallowFunction[]>} */
  const byFile = new Map();
  const seen = new Set();
  (function visit(v, file) {
    if (!v || typeof v !== 'object' || seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) { for (const x of v) visit(x, file); return; }
    const own = v.path ?? v.file ?? v.filePath ?? file;
    const cognitive = num(v.cognitive ?? v.cognitive_complexity ?? v.cognitiveComplexity);
    const line = num(v.line ?? v.start_line ?? v.startLine ?? v.loc?.start?.line);
    if (typeof own === 'string' && line !== null && cognitive !== null) {
      const key = own.replace(/\\/g, '/').replace(/^\.\//, '');
      const list = byFile.get(key) ?? [];
      list.push({ line, name: typeof v.name === 'string' ? v.name : null, cognitive, cyclomatic: num(v.cyclomatic ?? v.cyclomatic_complexity ?? v.cyclomaticComplexity) });
      byFile.set(key, list);
    }
    for (const x of Object.values(v)) visit(x, typeof own === 'string' ? own : file);
  })(report, undefined);
  return byFile;
}

/**
 * Cyclomatic complexity of a whole file: 1 + the decisions of every function in it (sum of ESLint `complexity` - 1
 * per function). Module-scope decisions outside any function are not counted (ESLint reports functions only).
 * parser.mjs's `complexityEstimate`.
 * @param {string} source Source text.
 * @returns {number} The file's cyclomatic complexity.
 */
export function fileCyclomatic(source) {
  return 1 + functionComplexity(source).reduce((s, f) => s + f.cyclomatic - 1, 0);
}

/**
 * The complexity signature of the first function named `name` in a file: name -> {cyclomatic, cognitive, maxNesting,
 * params, returns}. Anonymous functions are skipped. The logic map attaches it to every unit whose enclosing function
 * has that name.
 * @param {string} source Source text.
 * @param {{ast?: object, fallow?: FallowFunction[]}} [options] As functionComplexity.
 * @returns {Map<string, {cyclomatic: number, cognitive: number|null, maxNesting: number, params: number, returns: number}>} The signatures by name.
 */
export function complexityByName(source, options) {
  const map = new Map();
  for (const f of functionComplexity(source, options)) {
    if (f.name && !map.has(f.name)) map.set(f.name, { cyclomatic: f.cyclomatic, cognitive: f.cognitive, maxNesting: f.maxNesting, params: f.params, returns: f.returns });
  }
  return map;
}
