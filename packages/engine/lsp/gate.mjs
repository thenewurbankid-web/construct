// #943 -- atomicGate: a generated function lands only when it is atomic and Smith can read it (owner, 2026-10-13).
// Both halves must hold; every failed check comes back as one line. Deterministic, no model.
//
//   Smith round trip   summarizeCode (atomic-codemod's to-english) gives a non-empty translation that is not mostly
//                      placeholders: smith-system1's smithEmptyReason (PLACEHOLDER_EMPTY_RATIO, imported, not copied)
//   atomic shape       stubProblems clean (nothing unused, it returns what it declares; line/path/stubs.mjs)
//                      purity where the layer requires it (domain, expression: logicVerify/purity.mjs classifyFile)
//                      one job: ESLint core `complexity` (@construct/ast functionComplexity, FUNC-001's counter) within
//                      the layer's FUNC-001 budget (architecture-enforcer DEFAULT_FUNCTION_BUDGETS); and as a WHOLE:
//                      nested callbacks rolled up within budget x UNIT_BUDGET_FACTOR, at most CONCERN_LIMIT concerns
//                      connections only through functions: an imported binding is only called, rendered as a JSX tag
//                      (dotted too: <React.Fragment>, <SideNav.NavItem>) or used as a type -- never read as data
//   templates exempt   dumb JSX that only binds view-model fields (a body of `return <jsx/>`, plus destructuring, with
//                      only names, field reads and calls inside braces) is checked by DOM render, not Smith
//
//   atomicGate({ rel, source, fn, layer? }) -> { pass, exempt, checks: [{ check, ok, line }], failed: string[] }
import path from 'node:path';
import { ts } from './host.mjs';
import { stubProblems } from '../line/path/stubs.mjs';
import { classifyFile } from '../line/logicVerify/purity.mjs';
import { functionComplexity } from '@construct/ast';
import { functionBudgetFor } from '@line/construct-core/architecture-enforcer';
import { DEFAULT_LAYERS } from '@line/construct-core/config';
import { ITEM_KINDS, KIND_LAYER } from '@line/construct-core/profiles/line/contract';
import { smithOfFunction } from './smith.mjs';
import { booleanNameOf, name002Severity, NAME_002_DEFAULTS, BOOLEAN_PREFIXES } from './booleanNames.mjs';
import { PLACEHOLDER_EMPTY_RATIO } from './smithText.mjs';

export { PLACEHOLDER_EMPTY_RATIO };
export const PURE_LAYERS = Object.freeze(new Set(['domain', 'expression']));
/**
 * Line folders that are not a layer's own name and not in the Line profile's KIND_LAYER: what each one holds is a unit
 * of an existing layer (a use case is a workflow step, a store is a service, a provider is a hook, a contract is
 * types plus pure helpers, so domain).
 */
const FOLDER_ALIASES = Object.freeze({ usecases: 'workflow', store: 'service', providers: 'hook', contracts: 'domain' });

/**
 * Folder -> layer, derived from the profiles rather than written out: every Construct layer whose pattern is
 * `features/<f>/<folder>/**` (core config DEFAULT_LAYERS: domain/, services/, hooks/, adapters/, viewmodels/, ...),
 * every Line item kind (ITEM_KINDS, through KIND_LAYER or its singular when that is a layer: domains/ -> domain),
 * then FOLDER_ALIASES.
 * @param {Record<string, {pattern?: string}>} [layers] A layer graph (a project's own, or the default).
 * @returns {Record<string, string>}
 */
export function folderLayers(layers = DEFAULT_LAYERS) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const [name, def] of Object.entries(layers)) {
    const m = /^features\/\*\/([^/*]+)\/\*\*$/.exec(def?.pattern ?? '');
    if (m) { out[m[1]] = name; out[name] ??= name; }
  }
  for (const kind of ITEM_KINDS) {
    const one = kind.replace(/s$/, '');
    const layer = KIND_LAYER[kind] ?? (layers[one] ? one : null);
    if (layer) out[kind] ??= layer;
  }
  for (const [folder, layer] of Object.entries(FOLDER_ALIASES)) out[folder] ??= layer;
  return out;
}
const LAYER_OF = folderLayers();

/**
 * The layer of a root-relative file from its nearest layer folder (features/<f>/<folder>/..., library/<kind>/...,
 * src/features/<f>/domain/...); a file in no layer folder is a component (.tsx) or a service.
 * @param {string} rel Root-relative file.
 * @param {Record<string, string>} [map] folderLayers() of the project's own layer graph.
 * @returns {string}
 */
export function layerOf(rel, map = LAYER_OF) {
  for (const part of rel.split('/').slice(0, -1).reverse()) if (map[part]) return map[part];
  return /\.tsx$/.test(rel) ? 'component' : 'service';
}

const parse = (rel, source) => ts.createSourceFile(rel, source, ts.ScriptTarget.Latest, true, /\.tsx$/.test(rel) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
function findFn(sf, fn) {
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name?.text === fn) return st;
    if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name) && d.name.text === fn && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) return d.initializer;
  }
  return null;
}

/**
 * Dumb JSX: the body is destructuring plus one `return <jsx>`, and every `{...}` in it is a name, a field read or a call of them.
 * @param {any} node A TypeScript function node.
 * @returns {boolean}
 */
export function isTemplate(node) {
  const body = node.body;
  if (!body) return false;
  const ret = ts.isBlock(body) ? body.statements : [body];
  const stmts = [...ret];
  const last = stmts.pop();
  const expr = ts.isBlock(body) ? (last && ts.isReturnStatement(last) ? last.expression : null) : last;
  if (!expr) return false;
  if (stmts.some((s) => !(ts.isVariableStatement(s) && s.declarationList.declarations.every((d) => !ts.isIdentifier(d.name) && d.initializer && simple(d.initializer))))) return false;
  const inner = ts.isParenthesizedExpression(expr) ? expr.expression : expr;
  if (!(ts.isJsxElement(inner) || ts.isJsxSelfClosingElement(inner) || ts.isJsxFragment(inner))) return false;
  let dumb = true;
  const visit = (n) => { if (!dumb) return; if (ts.isJsxExpression(n) && n.expression && !simple(n.expression)) { dumb = false; return; } ts.forEachChild(n, visit); };
  visit(inner);
  return dumb;
}
function simple(e) {
  if (ts.isIdentifier(e) || ts.isStringLiteral(e) || ts.isNumericLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return true;
  if (ts.isPropertyAccessExpression(e)) return simple(e.expression);
  if (ts.isCallExpression(e)) return simple(e.expression) && e.arguments.every(simple);
  if (ts.isArrowFunction(e)) return ts.isCallExpression(e.body) && simple(e.body); // onClick={() => onRemove(id)}
  return false;
}

/**
 * Whether `n` names a JSX tag: the whole tag (`<Button>`), or the root of a dotted one (`<React.Fragment>`,
 * `<SubframeCore.DropdownMenu.Root>`, `<SideNav.NavItem>`): a component reference, not a data read.
 * @param {any} n An identifier.
 * @returns {boolean}
 */
export function isJsxTag(n) {
  let top = n;
  while (ts.isPropertyAccessExpression(top.parent) && top.parent.expression === top) top = top.parent;
  const p = top.parent;
  return !!p && (ts.isJsxOpeningElement(p) || ts.isJsxSelfClosingElement(p) || ts.isJsxClosingElement(p)) && p.tagName === top;
}

/**
 * Whether `n` is only a name, not a reference to a binding: the member of a property access (`DropdownMenu` in
 * `SubframeCore.DropdownMenu.Root`), an object key, a JSX attribute name, a declaration's own name.
 * @param {any} n An identifier.
 * @returns {boolean}
 */
function isNameOnly(n) {
  const p = n.parent;
  return (ts.isPropertyAccessExpression(p) && p.name === n) || (ts.isPropertyAssignment(p) && p.name === n) || ts.isJsxAttribute(p)
    || ((ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isFunctionDeclaration(p) || ts.isBindingElement(p)) && p.name === n);
}

/**
 * Imported bindings read as data inside `node` (not called, not a JSX tag, not a type).
 * @param {any} sf The TypeScript source file.
 * @param {any} node A function node in it.
 * @returns {string[]} The imported names read as data.
 */
export function dataConnections(sf, node) {
  const imported = new Set();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !st.importClause || st.importClause.isTypeOnly) continue;
    const c = st.importClause;
    if (c.name) imported.add(c.name.text);
    if (c.namedBindings && ts.isNamedImports(c.namedBindings)) for (const e of c.namedBindings.elements) if (!e.isTypeOnly) imported.add(e.name.text);
    if (c.namedBindings && ts.isNamespaceImport(c.namedBindings)) imported.add(c.namedBindings.name.text);
  }
  const hits = new Set();
  const visit = (n) => {
    if (ts.isIdentifier(n) && imported.has(n.text) && !isNameOnly(n)) {
      const p = n.parent;
      const ok = (ts.isCallExpression(p) && p.expression === n)
        || isJsxTag(n)
        || ts.isTypeReferenceNode(p) || ts.isTypeQueryNode(p) || ts.isQualifiedName(p) || ts.isExpressionWithTypeArguments(p)
        || (ts.isPropertyAccessExpression(p) && p.expression === n && ts.isCallExpression(p.parent) && p.parent.expression === p); // ns.fn()
      if (!ok) hits.add(n.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return [...hits];
}

/**
 * The unit budget is FUNC-001's per-function budget times this. Construct's own corpus (bench starters, examples/,
 * typed-contracts examples, line-atoms, trace/examples: 149 top-level units, 36 with nested functions) rolls up to at
 * most 0.8x its layer's budget (p95 0.5x), so every unit Line shows as an example passes with room for a hook that
 * bundles a few small handlers; 1.5x still flags max-ai-ui's spread-out hooks (8 of 47 with callbacks, e.g.
 * useAdminNavigation 16/15, useUserDataStep 51/15).
 */
export const UNIT_BUDGET_FACTOR = 1.5;
/**
 * The most distinct concerns one unit may call into (modules outside its own feature, plus the browser). Construct's
 * corpus: at most 3 (p95 1), so 4; max-ai-ui has 5 units above it, useAdminNavigation at 8 (router, intl, profile,
 * breadcrumbs, side-nav sync, data loads, analytics, browser scroll).
 */
export const CONCERN_LIMIT = 4;
/** Browser globals: calling or reading one is the `browser` concern (DOM, storage, location, timers aside). */
const BROWSER = new Set(['window', 'document', 'getComputedStyle', 'localStorage', 'sessionStorage', 'navigator', 'location', 'history', 'matchMedia', 'requestAnimationFrame', 'IntersectionObserver', 'ResizeObserver', 'fetch']);
/** Framework modules every hook or component uses: never a concern of their own. */
const FRAMEWORK = new Set(['react', 'react-dom']);

/**
 * A unit's complexity as a WHOLE: ESLint's per-function cyclomatic (functionComplexity, FUNC-001's counter) of the unit
 * and of every function nested in it, rolled up as one function would count them (1 + the decisions of each).
 * @param {string} source The file.
 * @param {string} fn The unit's name.
 * @returns {{whole: number, own: number, parts: {name: string, line: number, cyclomatic: number}[]} | null}
 */
export function wholeComplexity(source, fn) {
  let all;
  try { all = functionComplexity(source); } catch { return null; }
  const unit = all.filter((f) => f.name === fn).sort((a, b) => b.loc - a.loc)[0];
  if (!unit) return null;
  const nested = all.filter((f) => f !== unit && f.line >= unit.line && f.endLine <= unit.endLine);
  const parts = nested.map((f) => ({ name: f.name ?? `callback L${f.line}`, line: f.line, cyclomatic: f.cyclomatic }));
  return { whole: 1 + [unit, ...nested].reduce((n, f) => n + f.cyclomatic - 1, 0), own: unit.cyclomatic, parts };
}

/**
 * The distinct concerns a unit calls into: each module outside its own feature an imported binding it calls or reads
 * comes from (type-only imports, react, the unit's own feature's files and components it only renders as JSX tags left
 * out: composing views is one job), plus `browser` for a browser global.
 * @param {any} sf The TypeScript source file.
 * @param {any} node The unit's function node.
 * @param {string} rel Root-relative file (its features/<f>/ folder is the unit's own feature).
 * @returns {string[]} Module specifiers (and `browser`), in first-use order.
 */
export function concernsOf(sf, node, rel) {
  const from = new Map();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !st.importClause || st.importClause.isTypeOnly || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    const spec = st.moduleSpecifier.text;
    const c = st.importClause;
    const names = [c.name?.text, c.namedBindings && ts.isNamespaceImport(c.namedBindings) ? c.namedBindings.name.text : null,
      ...(c.namedBindings && ts.isNamedImports(c.namedBindings) ? c.namedBindings.elements.filter((e) => !e.isTypeOnly).map((e) => e.name.text) : [])];
    for (const n of names) if (n) from.set(n, spec);
  }
  const feature = /(?:^|\/)features\/[^/]+\//.exec(rel)?.[0] ?? null;
  const own = (spec) => {
    if (!spec.startsWith('.')) return false;
    if (!feature) return true;
    const abs = path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec));
    return abs.includes(feature.replace(/^\//, ''));
  };
  const out = [];
  const add = (c) => { if (!out.includes(c)) out.push(c); };
  const visit = (n) => {
    if (ts.isIdentifier(n) && !(ts.isPropertyAccessExpression(n.parent) && n.parent.name === n) && !ts.isTypeReferenceNode(n.parent) && !isJsxTag(n)) {
      const spec = from.get(n.text);
      if (spec && !FRAMEWORK.has(spec) && !own(spec)) add(spec);
      else if (!spec && BROWSER.has(n.text)) add('browser');
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return out;
}

/**
 * The gate for one function of one file.
 * @param {{rel: string, source: string, fn: string, layer?: string, smith?: Function, root?: string|null}} a `smith` overrides the round trip (tests);
 *   `root` (optional) types the function against its project and reads NAME-002's `generated` severity from it.
 * @returns {Promise<any>} {pass, exempt, layer, checks, failed, smith, ms}.
 */
export async function atomicGate({ rel, source, fn, layer = layerOf(rel), smith = smithOfFunction, root = null }) {
  const t0 = Date.now();
  const sf = parse(rel, source);
  const node = findFn(sf, fn);
  if (!node) return { pass: false, exempt: false, checks: [{ check: 'found', ok: false, line: `no function ${fn} in ${rel}` }], failed: ['found'], ms: Date.now() - t0 };
  /** @type {any[] & {smith?: any}} */
  const checks = [];
  const add = (check, ok, line) => checks.push({ check, ok, line: `${ok ? 'ok  ' : 'FAIL'} ${check}: ${line}` });
  const code = (ts.isFunctionDeclaration(node) ? node : node.parent.parent.parent).getText(sf);
  const exempt = /\.tsx$/.test(rel) && isTemplate(node);

  // atomic shape
  const probs = stubProblems(source, fn).filter((p) => p.code !== 'NO_STUB');
  add('stub', probs.length === 0, probs.length ? probs.map((p) => p.sentence).join(' ') : 'nothing unused, it returns what it declares');
  if (PURE_LAYERS.has(layer)) {
    const pur = classifyFile(source, rel).get(fn);
    const ok = !pur || pur.purity === 'pure';
    add('purity', ok, ok ? `pure (${layer} layer)` : `${pur.purity} (${pur.effects.join(', ')}) in a ${layer} unit`);
  }
  const budget = functionBudgetFor(layer) ?? { cyclomatic: 10 };
  const cx = functionComplexity(source).filter((f) => f.name === fn).sort((a, b) => b.cyclomatic - a.cyclomatic)[0];
  if (cx) add('complexity', cx.cyclomatic <= budget.cyclomatic, `cyclomatic ${cx.cyclomatic}/${budget.cyclomatic} (${layer})`);
  // one job, measured on the unit as a whole: its nested callbacks rolled up, and how many concerns it calls into
  const w = wholeComplexity(source, fn);
  const unitBudget = Math.round(budget.cyclomatic * UNIT_BUDGET_FACTOR);
  const concerns = concernsOf(sf, node, rel);
  if (w) {
    const okW = w.whole <= unitBudget; const okC = concerns.length <= CONCERN_LIMIT;
    const parts = [`${fn} ${w.own}`, ...w.parts.map((p) => `${p.name} ${p.cyclomatic}`)].join(', ');
    add('one-job', okW && okC, `whole cyclomatic ${w.whole}/${unitBudget} (${layer} ${budget.cyclomatic} x ${UNIT_BUDGET_FACTOR}: ${parts}); concerns ${concerns.length}/${CONCERN_LIMIT}${concerns.length ? ` (${concerns.join(', ')})` : ''}`);
  }
  // NAME-002 on generated code: a boolean function (or type guard) is named is/has/can/should/does (default error)
  const nameSev = root ? name002Severity(root).generated : NAME_002_DEFAULTS.generated;
  if (nameSev !== 'off') {
    let bad = null;
    try { bad = booleanNameOf(rel, source, fn, { root }); } catch { bad = null; }
    add('naming', !bad || nameSev !== 'error', bad ? `${nameSev === 'error' ? '' : 'warning: '}NAME-002 ${fn} ${bad.guard ? 'is a boolean type guard' : 'returns boolean'}; name it ${bad.suggested} (${BOOLEAN_PREFIXES.join('/')})` : 'NAME-002: not a boolean function, or named for one');
  }
  const data = dataConnections(sf, node);
  add('connections', data.length === 0, data.length ? `reads imported ${data.join(', ')} as data, not through a function` : 'only through functions');

  // Smith round trip (templates are checked by DOM render instead)
  if (exempt) add('smith', true, 'template: dumb JSX, checked by DOM render');
  else {
    let s;
    try { s = await smith(code, { fileName: rel }); } catch (e) { s = { steps: [], empty: 'failed', all: [String(e?.message ?? e)] }; }
    const ok = !s.empty && s.steps.length > 0;
    add('smith', ok, ok ? `${s.steps.length} sentence(s): ${s.steps[0].slice(0, 80)}` : `${s.empty ?? 'blank'} translation (cutoff ${PLACEHOLDER_EMPTY_RATIO}): ${(s.all ?? []).join(' ').slice(0, 100)}`);
    checks.smith = s;
  }
  const failed = checks.filter((c) => !c.ok).map((c) => c.check);
  return { pass: failed.length === 0, exempt, layer, checks: checks.map(({ check, ok, line }) => ({ check, ok, line })), failed, smith: checks.smith?.steps ?? [], ms: Date.now() - t0 };
}

/**
 * The gate for every top-level function of a file, as diagnostics lines (`<rel>:<fn> GATE <check> <why>`).
 * @param {{rel: string, source: string}} a
 * @returns {Promise<any>} {ok, lines, ...}.
 */
export async function gateDiagnostics({ rel, source }) {
  const sf = parse(rel, source);
  const names = [];
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name && st.body) names.push(st.name.text);
    if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) names.push(d.name.text);
  }
  const out = [];
  for (const fn of names) {
    const g = await atomicGate({ rel, source, fn });
    for (const c of g.checks) if (!c.ok) out.push(`${rel}:${fn} GATE ${c.line.replace(/^FAIL /, '')}`);
  }
  return out;
}
