// #943 -- atomicGate: a generated function lands only when it is atomic and Smith can read it (owner, 2026-10-13).
// Both halves must hold; every failed check comes back as one line. Deterministic, no model.
//
//   Smith round trip   summarizeCode (atomic-codemod's to-english) gives a non-empty translation that is not mostly
//                      placeholders: smith-system1's smithEmptyReason (PLACEHOLDER_EMPTY_RATIO, imported, not copied)
//   atomic shape       stubProblems clean (nothing unused, it returns what it declares; line/path/stubs.mjs)
//                      purity where the layer requires it (domain, expression: logicVerify/purity.mjs classifyFile)
//                      one job: ESLint core `complexity` (@construct/ast functionComplexity, FUNC-001's counter) within
//                      the layer's FUNC-001 budget (architecture-enforcer DEFAULT_FUNCTION_BUDGETS)
//                      connections only through functions: an imported binding is only called, rendered as a JSX tag
//                      or used as a type -- never read as data
//   templates exempt   dumb JSX that only binds view-model fields (a body of `return <jsx/>`, plus destructuring, with
//                      only names, field reads and calls inside braces) is checked by DOM render, not Smith
//
//   atomicGate({ rel, source, fn, layer? }) -> { pass, exempt, checks: [{ check, ok, line }], failed: string[] }
import { ts } from './host.mjs';
import { stubProblems } from '../line/path/stubs.mjs';
import { classifyFile } from '../line/logicVerify/purity.mjs';
import { functionComplexity } from '@construct/ast';
import { functionBudgetFor } from '@line/construct-core/architecture-enforcer';
import { smithOfFunction } from './smith.mjs';
import { PLACEHOLDER_EMPTY_RATIO } from './smithText.mjs';

export { PLACEHOLDER_EMPTY_RATIO };
export const PURE_LAYERS = Object.freeze(new Set(['domain', 'expression']));
const LAYER_OF = { domains: 'domain', expressions: 'expression', services: 'service', usecases: 'workflow', workflows: 'workflow', hooks: 'hook', controllers: 'controller', pages: 'page', components: 'component', store: 'service', providers: 'hook', contracts: 'domain' };

/** The layer of a root-relative file from its folder (features/<f>/<kind>/... or library/<kind>/...). */
export function layerOf(rel) {
  for (const part of rel.split('/').slice(0, -1).reverse()) if (LAYER_OF[part]) return LAYER_OF[part];
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

/** Dumb JSX: the body is destructuring plus one `return <jsx>`, and every `{...}` in it is a name, a field read or a call of them. */
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

/** Imported bindings read as data inside `node` (not called, not a JSX tag, not a type). */
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
    if (ts.isIdentifier(n) && imported.has(n.text)) {
      const p = n.parent;
      const ok = (ts.isCallExpression(p) && p.expression === n)
        || ((ts.isJsxOpeningElement(p) || ts.isJsxSelfClosingElement(p) || ts.isJsxClosingElement(p)) && p.tagName === n)
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
 * The gate for one function of one file.
 * @param {{rel: string, source: string, fn: string, layer?: string, smith?: Function}} a `smith` overrides the round trip (tests).
 */
export async function atomicGate({ rel, source, fn, layer = layerOf(rel), smith = smithOfFunction }) {
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

/** The gate for every top-level function of a file, as diagnostics lines (`<rel>:<fn> GATE <check> <why>`). */
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
