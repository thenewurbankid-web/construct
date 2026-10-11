// Line Import v2, step 4 (docs/line/import-v2/CONTRACT.md "Fit"): the line.import.extract* plan tools. Each one plans
// ONE StagedChange (pure: it reads files and returns {summary, files}); the write happens only in applyChange
// (ops.mjs), through Construct's checked writer, when a person approves the plan step (planTools.mjs runChange).
// Every path is relative to the import folder, which is the writer's root, so a step can never write outside it.
//
//   line.import.extractService   top-level functions of a file (data hooks, adapters) -> <area>/services/<name>
//   line.import.extractDomain    top-level pure functions and rules                    -> <area>/domains/<name>
//   line.import.extractUsecase   top-level orchestration functions (one user goal)     -> <area>/usecases/<name>
//   line.import.splitPage        a page's or component's logic (everything before its JSX) -> a use<Name> hook in
//                                <area>/usecases/; the component keeps only its presentation (the presentation/logic
//                                split of pageTransformer.mjs, checked with controllerBinder.mjs's hook signature)
//   line.import.extractWorkflow  a component's implicit screen flow (URL state and navigation) -> an xstate workflow in
//                                library/workflows plus the feature's workflow based on it (research/specToCode.mjs
//                                buildWorkflowDescriptor + workflowGenerator.mjs compileWorkflow)
//
// <area> is features/<feature> (or the library when no feature is named). Moving code keeps the app working: the old
// file imports back what it still uses and re-exports what it exported, so no other file has to change. A value the
// moved code needs moves with it (the old file imports it back), so the new file never imports the old one at run time;
// a type both sides need stays and is imported as a type. Refusals are one sentence (LineOpError) with the fix in it.
import fs from 'node:fs';
import path from 'node:path';
import { ts } from '@construct/ast';
import { loadConfig } from '@line/construct-core/config';
import { normalizeLineConfig, LOGIC_KINDS } from '@line/construct-core/profiles/line/contract';
import { resolveLayout } from '@line/construct-core/profiles/line/checks';
import { compileWorkflow } from '../../workflowGenerator.mjs';
import { extractHookSignature, matchSlotsToHandlers } from '../../controllerBinder.mjs';
import { buildWorkflowDescriptor } from '@line/construct-core/research/spec-to-code';
import { LineOpError, assertStagedChange } from '../contract.mjs';
import { EXTRACT_KIND, extractTarget } from './extractTarget.mjs';

const posix = path.posix;
const NAME = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const FEATURE = /^[a-z0-9][a-z0-9-]*$/;
/** `text` with the first `find` replaced by `by`, taken literally (String.replace would read `$'` and `$&` in code). */
const replaceOnce = (text, find, by) => { const i = text.indexOf(find); return i < 0 ? text : text.slice(0, i) + by + text.slice(i + find.length); };
const stripExt = (rel) => rel.slice(0, rel.length - posix.extname(rel).length);

export { EXTRACT_KIND, EXTRACT_TOOLS, extractTarget } from './extractTarget.mjs';

// ------------------------------------------------------------------------------------------------- reading

/** The folder's Line layout (its library and features folders). */
function layoutOf(root) {
  let line;
  try { line = normalizeLineConfig(/** @type {any} */ (loadConfig(root)).line); } catch { line = normalizeLineConfig(undefined); }
  return resolveLayout(root, line);
}

/** A safe folder-relative path to an existing code file, or a LineOpError. */
function readCode(root, rel, what = 'file') {
  const r = String(rel ?? '');
  if (!r || r.startsWith('/') || r.includes('\\') || r.split('/').some((s) => s === '..' || s === '.' || s === '')) throw new LineOpError(`"${rel}" is not a ${what} inside the import folder.`, 'UNKNOWN_FILE');
  if (!/\.[cm]?[jt]sx?$/.test(r)) throw new LineOpError(`Line cannot move logic out of ${r}, because it is not a code file.`, 'UNKNOWN_FILE');
  const abs = path.join(root, r);
  if (!fs.statSync(abs, { throwIfNoEntry: false })?.isFile()) throw new LineOpError(`There is no ${what} ${r} in the import folder.`, 'UNKNOWN_FILE');
  return fs.readFileSync(abs, 'utf8');
}

/** A TypeScript source file of `rel` (TSX for .tsx/.jsx, else TS). */
function parse(rel, src) {
  const kind = /x$/.test(posix.extname(rel)) ? ts.ScriptKind.TSX : /\.[cm]?js$/.test(rel) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  return ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true, kind);
}

const hasMod = (node, kind) => Boolean(ts.canHaveModifiers?.(node) && ts.getModifiers(node)?.some((m) => m.kind === kind));
const isFnLike = (n) => ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n) || ts.isConstructorDeclaration(n) || ts.isGetAccessor(n) || ts.isSetAccessor(n);

/** Names a binding name (identifier or pattern) declares. */
function bindingNames(name, out = []) {
  if (ts.isIdentifier(name)) out.push(name.text);
  else if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) for (const el of name.elements) if (!ts.isOmittedExpression(el)) bindingNames(el.name, out);
  return out;
}

/**
 * Identifier names a node refers to (an over-approximation that leaves out property names, object keys, JSX attribute
 * names and member names, which never name a binding).
 * @param {any} node @returns {Set<string>}
 */
function refsOf(node) {
  const out = new Set();
  const visit = (n) => {
    if (ts.isIdentifier(n)) {
      const p = n.parent;
      const isName = p && ((ts.isPropertyAccessExpression(p) && p.name === n) || (ts.isPropertyAssignment(p) && p.name === n) || (ts.isJsxAttribute(p) && p.name === n)
        || (ts.isPropertySignature(p) && p.name === n) || (ts.isMethodSignature(p) && p.name === n) || (ts.isQualifiedName(p) && p.right === n)
        || (ts.isPropertyDeclaration(p) && p.name === n) || (ts.isMethodDeclaration(p) && p.name === n) || (ts.isBindingElement(p) && p.propertyName === n)
        || (ts.isEnumMember(p) && p.name === n) || (ts.isImportSpecifier(p)) || (ts.isExportSpecifier(p) && p.propertyName === n));
      if (!isName) out.add(n.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return out;
}

/**
 * The file's top-level statements: what each declares, whether it is a type, exported or the default export.
 * @param {any} sf
 */
function topLevel(sf) {
  return sf.statements.map((st, index) => {
    /** @type {string[]} */
    let names = [];
    let type = false;
    if (ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) names = st.name ? [st.name.text] : [];
    else if (ts.isVariableStatement(st)) names = st.declarationList.declarations.flatMap((d) => bindingNames(d.name));
    else if (ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st)) { names = [st.name.text]; type = true; }
    else if (ts.isEnumDeclaration(st) || ts.isModuleDeclaration(st)) names = st.name && ts.isIdentifier(st.name) ? [st.name.text] : [];
    const isImport = ts.isImportDeclaration(st) || ts.isImportEqualsDeclaration(st);
    return {
      st, index, names, type, isImport,
      exported: hasMod(st, ts.SyntaxKind.ExportKeyword), isDefault: hasMod(st, ts.SyntaxKind.DefaultKeyword),
      refs: isImport ? new Set() : refsOf(st),
    };
  });
}

/** Names exported by `export { a, b as c }` (no module) and `export default a`. */
function exportedViaList(sf) {
  const out = new Set();
  for (const st of sf.statements) {
    if (ts.isExportDeclaration(st) && !st.moduleSpecifier && st.exportClause && ts.isNamedExports(st.exportClause)) for (const e of st.exportClause.elements) out.add((e.propertyName ?? e.name).text);
    if (ts.isExportAssignment(st) && ts.isIdentifier(st.expression)) out.add(st.expression.text);
  }
  return out;
}

/** The text of a statement with its leading comments (JSDoc), without the blank lines before it. */
const stmtText = (sf, st) => st.getFullText(sf).replace(/^\s*\n/, '').replace(/^\n+/, '');

// ------------------------------------------------------------------------------------------------- imports

/** A module specifier as seen from `toRel` instead of `fromRel` (only relative ones change). */
function respec(spec, fromRel, toRel) {
  if (!spec.startsWith('.')) return spec;
  const target = posix.normalize(posix.join(posix.dirname(fromRel), spec));
  const r = posix.relative(posix.dirname(toRel), target);
  return r.startsWith('.') ? r : `./${r}`;
}
/** A relative specifier from file `fromRel` to file `toRel` (both folder-relative), without the extension. */
function specTo(fromRel, toRel) {
  const r = posix.relative(posix.dirname(fromRel), stripExt(toRel));
  return r.startsWith('.') ? r : `./${r}`;
}

/** The import declarations of the file, each with its local names. */
function importsOf(sf) {
  return sf.statements.filter((st) => ts.isImportDeclaration(st)).map((st) => {
    const clause = st.importClause;
    const spec = /** @type {any} */ (st.moduleSpecifier).text;
    const locals = [];
    if (clause?.name) locals.push({ local: clause.name.text, kind: 'default', typeOnly: clause.isTypeOnly });
    const nb = clause?.namedBindings;
    if (nb && ts.isNamespaceImport(nb)) locals.push({ local: nb.name.text, kind: 'namespace', typeOnly: clause.isTypeOnly });
    if (nb && ts.isNamedImports(nb)) for (const e of nb.elements) locals.push({ local: e.name.text, kind: 'named', imported: (e.propertyName ?? e.name).text, typeOnly: clause.isTypeOnly || e.isTypeOnly });
    return { st, spec, locals, sideEffect: !clause };
  });
}

/** One import declaration's text for the given locals (all from the same declaration). */
function importText(spec, locals) {
  const def = locals.find((l) => l.kind === 'default');
  const ns = locals.find((l) => l.kind === 'namespace');
  const named = locals.filter((l) => l.kind === 'named');
  const allType = locals.every((l) => l.typeOnly);
  const typeKw = allType ? 'type ' : '';
  const namedText = named.map((l) => `${!allType && l.typeOnly ? 'type ' : ''}${l.imported === l.local ? l.local : `${l.imported} as ${l.local}`}`).join(', ');
  const parts = [def ? def.local : null, ns ? `* as ${ns.local}` : null, named.length ? `{ ${namedText} }` : null].filter(Boolean);
  // A default and a namespace import cannot share one declaration with named ones beyond what TS allows; keep it simple.
  if (def && ns) return `import ${typeKw}${def.local} from '${spec}';\nimport ${typeKw}* as ${ns.local} from '${spec}';\n`;
  return `import ${typeKw}${parts.join(', ')} from '${spec}';\n`;
}

/** The imports a moved piece of code needs, re-pointed from the old file to the new one. */
function neededImports(imports, refs, fromRel, toRel) {
  let out = '';
  for (const imp of imports) {
    const used = imp.locals.filter((l) => refs.has(l.local));
    if (used.length) out += importText(respec(imp.spec, fromRel, toRel), used);
  }
  return out;
}

/**
 * The old file's import declarations, pruned to what its remaining code still uses (a declaration that loses every
 * name is removed; side-effect imports and a default React import are always kept). Returns text edits.
 */
function pruneImports(sf, imports, keepRefs) {
  /** @type {{start: number, end: number, text: string}[]} */
  const edits = [];
  for (const imp of imports) {
    if (imp.sideEffect) continue;
    const kept = imp.locals.filter((l) => keepRefs.has(l.local) || (l.kind === 'default' && l.local === 'React'));
    if (kept.length === imp.locals.length) continue;
    const start = imp.st.getStart(sf);
    const end = imp.st.getEnd();
    edits.push({ start, end: sf.text[end] === '\n' && !kept.length ? end + 1 : end, text: kept.length ? importText(imp.spec, kept).replace(/\n$/, '') : '' });
  }
  return edits;
}

/** Apply non-overlapping text edits ({start, end, text}) to a source. */
function applyEdits(src, edits) {
  let out = src;
  for (const e of [...edits].sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

/** Where a new import line goes: after the last import declaration, else after a leading directive, else at the top. */
function importInsertAt(sf) {
  const imps = sf.statements.filter((st) => ts.isImportDeclaration(st));
  if (imps.length) return imps[imps.length - 1].getEnd();
  const first = sf.statements[0];
  if (first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression)) return first.getEnd();
  return 0;
}

// ------------------------------------------------------------------------------------------------- moving declarations

/**
 * Which top-level statements move: `seeds`, plus every value declaration the moved code refers to (so the new file
 * never imports the old one at run time), plus every type only the moved code uses. Types the rest of the file also
 * uses stay (exported) and are imported as types.
 * @param {ReturnType<typeof topLevel>} tops
 * @param {Set<any>} seeds statements that move
 * @param {Set<string>} extraRefs names the moved code refers to besides the seeds' own (a hook body, a parameter type)
 * @param {Set<string>} [staying] names code that stays (outside `tops`) refers to, such as a split component's JSX
 */
function moveClosure(tops, seeds, extraRefs = new Set(), staying = new Set()) {
  const moved = new Set(seeds);
  const sharedTypes = new Set();
  const decl = new Map();
  for (const t of tops) for (const n of t.names) if (!t.isImport) decl.set(n, t);
  let changed = true;
  while (changed) {
    changed = false;
    const refs = new Set(extraRefs);
    for (const t of moved) for (const r of t.refs) refs.add(r);
    for (const r of refs) {
      const t = decl.get(r);
      if (!t || moved.has(t) || sharedTypes.has(t)) continue;
      if (t.type) {
        const usedByRest = t.names.some((n) => staying.has(n)) || tops.some((o) => o !== t && !o.isImport && !moved.has(o) && t.names.some((n) => o.refs.has(n)));
        if (usedByRest) { sharedTypes.add(t); continue; }
      }
      moved.add(t);
      changed = true;
    }
  }
  return { moved, sharedTypes };
}

/**
 * Plan moving top-level declarations of `from` into a new file `to` (both folder-relative).
 * @param {string} root The import folder (the writer's root).
 * @param {{from: string, names: string[], to: string, tool: string, typedContracts?: string, factory?: string}} o
 * @returns {{summary: string, files: {path: string, content: string}[], moved: string[]}}
 */
export function planMoveDeclarations(root, { from, names, to, tool, typedContracts, factory }) {
  const src = readCode(root, from);
  if (!Array.isArray(names) || !names.length || names.some((n) => !NAME.test(String(n)))) throw new LineOpError('Name the functions to move, such as ["getOrders"].', 'BAD_ARGS');
  if (fs.existsSync(path.join(root, to))) throw new LineOpError(`There is already a file ${to}; pick another name.`, 'NAME_TAKEN');
  const sf = parse(from, src);
  const tops = topLevel(sf);
  const seeds = new Set();
  for (const n of names) {
    const t = tops.find((x) => !x.isImport && x.names.includes(n));
    if (!t) throw new LineOpError(`There is no top-level ${n} in ${posix.basename(from)}, so it cannot be moved; name one of its functions.`, 'UNKNOWN_ITEM');
    if (t.isDefault) throw new LineOpError(`The default export of ${posix.basename(from)} is ${n}; move the whole file with line.moveFile instead.`, 'BAD_ARGS');
    if (ts.isVariableStatement(t.st) && t.names.length > 1 && !t.names.every((x) => names.includes(x))) throw new LineOpError(`The declaration of ${n} also declares ${t.names.filter((x) => x !== n).join(', ')}; name all of them to move them together.`, 'BAD_ARGS');
    seeds.add(t);
  }
  const { moved, sharedTypes } = moveClosure(tops, seeds);
  const movedNames = new Set([...moved].flatMap((t) => t.names));
  const listed = exportedViaList(sf);
  const rest = tops.filter((t) => !t.isImport && !moved.has(t));
  const restRefs = new Set(rest.flatMap((t) => [...t.refs]));
  // other statements (export lists, export default x, side effects) also count as the rest
  for (const st of sf.statements) if ((ts.isExportDeclaration(st) || ts.isExportAssignment(st)) && !(/** @type {any} */ (st)).moduleSpecifier) for (const r of refsOf(st)) restRefs.add(r);
  const imports = importsOf(sf);
  const movedRefs = new Set([...moved].flatMap((t) => [...t.refs]));

  // The new file: the imports the moved code needs, the shared types as type imports, the moved statements in order.
  const typeImports = [...sharedTypes].flatMap((t) => t.names).filter((n) => movedRefs.has(n)).sort();
  const needExport = (t) => t.names.some((n) => names.includes(n) || restRefs.has(n) || listed.has(n));
  let body = '';
  let usesFactory = false;
  for (const t of tops.filter((x) => moved.has(x))) {
    let text = stmtText(sf, t.st);
    if (!t.exported && needExport(t)) text = replaceOnce(text, t.st.getText(sf), `export ${t.st.getText(sf)}`);
    const wrapped = typedContracts && factory ? wrapWithFactory(sf, t, factory) : null;
    if (wrapped) { text = replaceOnce(text, t.st.getText(sf), wrapped); usesFactory = true; }
    body += `${text.replace(/\s+$/, '')}\n\n`;
  }
  const kindWord = EXTRACT_KIND[tool]?.replace(/s$/, '') ?? 'item';
  const head = `// Line Import (${tool}): moved here from ${from}; it is a ${kindWord} of this ${to.startsWith('library/') ? 'library' : 'feature'}.\n`;
  const newSrc = `${head}${usesFactory ? `import { ${factory} } from '${typedContracts}';\n` : ''}${neededImports(imports, movedRefs, from, to)}${typeImports.length ? `import type { ${typeImports.join(', ')} } from '${specTo(to, from)}';\n` : ''}\n${body.replace(/\n+$/, '\n')}`;

  // The old file: the moved statements removed, the names it still uses imported back, the ones it exported re-exported.
  /** @type {{start: number, end: number, text: string}[]} */
  const edits = [];
  for (const t of moved) edits.push({ start: t.st.getFullStart(), end: t.st.getEnd(), text: '' });
  for (const t of sharedTypes) if (!t.exported) edits.push({ start: t.st.getStart(sf), end: t.st.getStart(sf), text: 'export ' });
  edits.push(...pruneImports(sf, imports, restRefs));
  const typeNames = new Set([...moved].filter((t) => t.type).flatMap((t) => t.names));
  const usedBack = [...movedNames].filter((n) => restRefs.has(n));
  const reExported = [...moved].filter((t) => t.exported).flatMap((t) => t.names).filter((n) => !listed.has(n));
  const spec = specTo(from, to);
  let lines = '';
  const values = usedBack.filter((n) => !typeNames.has(n)).sort();
  const types = usedBack.filter((n) => typeNames.has(n)).sort();
  if (values.length) lines += `\nimport { ${values.join(', ')} } from '${spec}';`;
  if (types.length) lines += `\nimport type { ${types.join(', ')} } from '${spec}';`;
  const reValues = reExported.filter((n) => !typeNames.has(n)).sort();
  const reTypes = reExported.filter((n) => typeNames.has(n)).sort();
  if (reValues.length) lines += `\nexport { ${reValues.join(', ')} } from '${spec}';`;
  if (reTypes.length) lines += `\nexport type { ${reTypes.join(', ')} } from '${spec}';`;
  const at = importInsertAt(sf);
  edits.push({ start: at, end: at, text: at === 0 ? `${lines.trimStart()}\n` : lines });
  const oldSrc = `${applyEdits(src, edits).replace(/\n{3,}/g, '\n\n').replace(/\s*$/, '')}\n`;
  return {
    summary: `Moves ${[...names].join(', ')} from ${posix.basename(from)} into ${to}${moved.size > seeds.size ? `, with ${moved.size - seeds.size} helper${moved.size - seeds.size === 1 ? '' : 's'} only they use` : ''}; ${posix.basename(from)} keeps working through ${reValues.length + reTypes.length ? 're-exports' : 'imports'} of the new file.`,
    files: [{ path: to, content: newSrc }, { path: from, content: oldSrc }],
    moved: [...movedNames].sort(),
  };
}

/**
 * `export const x = (props) => ...` as `export const x = defineService('x', (props) => ...)` (typed-contracts), when it
 * is an arrow or function expression with at most one parameter; else null (it stays a plain function).
 */
function wrapWithFactory(sf, t, factory) {
  if (!ts.isVariableStatement(t.st) || t.st.declarationList.declarations.length !== 1) return null;
  const d = t.st.declarationList.declarations[0];
  if (!ts.isIdentifier(d.name) || !d.initializer || d.type) return null;
  const init = d.initializer;
  if (!(ts.isArrowFunction(init) || ts.isFunctionExpression(init)) || init.parameters.length > 1) return null;
  const whole = t.st.getText(sf);
  const initText = init.getText(sf);
  const out = replaceOnce(whole, initText, `${factory}('${d.name.text}', ${initText})`);
  return /^export\b/.test(out) ? out : `export ${out}`;
}

// ------------------------------------------------------------------------------------------------- targets

function checkTargetArgs(args) {
  if (!NAME.test(String(args?.name ?? ''))) throw new LineOpError(`"${args?.name ?? ''}" is not a name Line can give a file; use letters and digits, such as ordersService.`, 'BAD_NAME');
  if (args?.feature !== undefined && !FEATURE.test(String(args.feature))) throw new LineOpError(`"${args.feature}" is not a feature name; use lower-case words joined by dashes, such as orders.`, 'BAD_NAME');
}

// ------------------------------------------------------------------------------------------------- split page

/** The component `name` in the file: its function node (declaration, or arrow/function expression in a const). */
function findComponent(sf, name) {
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name?.text === name) return { st, fn: st };
    if (ts.isFunctionDeclaration(st) && !st.name && name === 'default' && hasMod(st, ts.SyntaxKind.DefaultKeyword)) return { st, fn: st };
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.name.text === name && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) return { st, fn: d.initializer };
        if (ts.isIdentifier(d.name) && d.name.text === name && d.initializer && ts.isCallExpression(d.initializer)) return { st, fn: null, wrapped: d.initializer.expression.getText(sf) };
      }
    }
  }
  return null;
}

/** True when the statement returns from the component (a `return` that is not inside a nested function). */
function returnsHere(st) {
  let found = false;
  const visit = (n) => { if (found || isFnLike(n) || ts.isClassLike(n)) return; if (ts.isReturnStatement(n)) { found = true; return; } ts.forEachChild(n, visit); };
  visit(st);
  return found;
}

/** Names a block of statements declares at its own level. */
function declaredIn(stmts) {
  const out = [];
  for (const st of stmts) {
    if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) out.push(...bindingNames(d.name).map((n) => ({ n, isLet: !(st.declarationList.flags & ts.NodeFlags.Const) })));
    else if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && st.name) out.push({ n: st.name.text, isLet: false });
  }
  return out;
}

/** Names assigned (=, +=, ++, --) anywhere in the nodes. */
function assignedIn(nodes) {
  const out = new Set();
  const visit = (n) => {
    if (ts.isBinaryExpression(n) && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment && ts.isIdentifier(n.left)) out.add(n.left.text);
    if ((ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(n.operator) && ts.isIdentifier(n.operand)) out.add(n.operand.text);
    ts.forEachChild(n, visit);
  };
  for (const n of nodes) visit(n);
  return out;
}

/** The object pattern's elements whose bound names are in `used`, as text (`{ a, b = 1 }`), or null when none are. */
function patternFor(sf, pattern, used) {
  const els = pattern.elements.filter((el) => bindingNames(el.name).some((n) => used.has(n)));
  return els.length ? `{ ${els.map((el) => el.getText(sf)).join(', ')} }` : null;
}

/**
 * Plan splitting a page or component into its presentation and a `use<Name>` hook holding its logic (every statement
 * before its JSX). The hook goes to `to`; the component calls it and keeps only what renders.
 * @param {string} root
 * @param {{from: string, component: string, name: string, to: string}} o
 * @returns {{summary: string, files: {path: string, content: string}[], returned: string[]}} The change, and what the hook returns.
 */
export function planSplit(root, { from, component, name, to }) {
  const src = readCode(root, from);
  if (!NAME.test(String(component ?? ''))) throw new LineOpError('Name the component to split, such as OrdersPage.', 'BAD_ARGS');
  if (fs.existsSync(path.join(root, to))) throw new LineOpError(`There is already a file ${to}; pick another name for the hook.`, 'NAME_TAKEN');
  const sf = parse(from, src);
  const found = findComponent(sf, component);
  if (!found) throw new LineOpError(`There is no component ${component} in ${posix.basename(from)}; name one of its components.`, 'UNKNOWN_ITEM');
  if (!found.fn) throw new LineOpError(`The component ${component} is wrapped in ${found.wrapped}(...), so Line cannot split it yet; split the inner function first.`, 'BAD_ARGS');
  const fn = found.fn;
  if (!fn.body || !ts.isBlock(fn.body)) throw new LineOpError(`The component ${component} returns its JSX directly, so it has no logic to move.`, 'NOTHING_TO_DO');
  if (fn.parameters.length > 1) throw new LineOpError(`The component ${component} takes ${fn.parameters.length} parameters; Line splits a component with at most one (its props).`, 'BAD_ARGS');
  const stmts = [...fn.body.statements];
  const cut = stmts.findIndex(returnsHere);
  const prefix = cut < 0 ? stmts : stmts.slice(0, cut);
  const restStmts = cut < 0 ? [] : stmts.slice(cut);
  if (!prefix.length) throw new LineOpError(`The component ${component} has no logic before its JSX, so there is nothing to move into a hook.`, 'NOTHING_TO_DO');
  if (!restStmts.length) throw new LineOpError(`The component ${component} never returns JSX, so it is not a component Line can split.`, 'BAD_ARGS');

  // Props: `(props: T)` stays as it is; `({a, b}: T)` becomes `(props: T)` with the pattern destructured on each side.
  const param = fn.parameters[0];
  let propsName = null;
  let propsType = null;
  /** @type {any} */
  let pattern = null;
  if (param) {
    if (!param.type) throw new LineOpError(`The props of ${component} have no type, so its logic cannot move into a typed hook; give them a type first.`, 'NO_PROPS_TYPE');
    propsType = param.type.getText(sf);
    if (ts.isIdentifier(param.name)) propsName = param.name.text;
    else if (ts.isObjectBindingPattern(param.name)) { pattern = param.name; propsName = 'props'; }
    else throw new LineOpError(`The props of ${component} are not an object, so Line cannot split it.`, 'BAD_ARGS');
    if (pattern && declaredIn(stmts).some((d) => d.n === 'props')) throw new LineOpError(`The component ${component} already declares a "props" of its own, so Line cannot name its props parameter; rename it first.`, 'BAD_ARGS');
  }
  const prefixRefs = new Set(prefix.flatMap((st) => [...refsOf(st)]));
  const restRefs = new Set(restStmts.flatMap((st) => [...refsOf(st)]));
  const declared = declaredIn(prefix);
  const returned = declared.filter((d) => restRefs.has(d.n));
  const reassigned = assignedIn(restStmts);
  const bad = returned.find((d) => d.isLet && reassigned.has(d.n));
  if (bad) throw new LineOpError(`The component ${component} changes ${bad.n} after its logic, so ${bad.n} cannot move into a hook; make it a state or a const first.`, 'BAD_ARGS');
  const hookName = name;
  const tops = topLevel(sf);
  const compTop = tops.find((t) => t.st === found.st);
  // Module-level code the hook needs: values move with it (the component file imports back what it still uses).
  const hookRefs = new Set([...prefixRefs, ...(param?.type ? refsOf(param.type) : [])]);
  const staying = new Set([...restRefs, ...(param?.type ? refsOf(param.type) : [])]);
  const { moved, sharedTypes } = moveClosure(tops.filter((t) => t !== compTop), new Set(), hookRefs, staying);
  if ([...moved].some((t) => t === compTop)) throw new LineOpError(`The logic of ${component} refers to ${component} itself, so it cannot move into a hook.`, 'BAD_ARGS');
  const movedNames = new Set([...moved].flatMap((t) => t.names));
  const imports = importsOf(sf);
  const allMovedRefs = new Set([...hookRefs, ...[...moved].flatMap((t) => [...t.refs])]);

  // The hook file.
  const prefixText = sf.text.slice(prefix[0].getFullStart(), prefix[prefix.length - 1].getEnd()).replace(/^\s*\n/, '');
  const hookPattern = pattern ? patternFor(sf, pattern, prefixRefs) : null;
  const typeImports = [...sharedTypes].flatMap((t) => t.names).filter((n) => allMovedRefs.has(n)).sort();
  // What the component file still refers to once the logic is gone (its JSX part, its props type, the other statements).
  const compRefsAfter = new Set([...restRefs, ...(param?.type ? refsOf(param.type) : []), ...tops.filter((t) => t !== compTop && !t.isImport && !moved.has(t)).flatMap((t) => [...t.refs])]);
  for (const st of sf.statements) if ((ts.isExportDeclaration(st) || ts.isExportAssignment(st)) && !(/** @type {any} */ (st)).moduleSpecifier) for (const r of refsOf(st)) compRefsAfter.add(r);
  let movedText = '';
  for (const t of tops.filter((x) => moved.has(x))) {
    let text = stmtText(sf, t.st);
    if (!t.exported && t.names.some((n) => compRefsAfter.has(n))) text = replaceOnce(text, t.st.getText(sf), `export ${t.st.getText(sf)}`);
    movedText += `${text.replace(/\s+$/, '')}\n\n`;
  }
  const hookSrc = [
    `// Line Import (line.import.splitPage): ${component}'s logic, moved here from ${from}; ${component} keeps its presentation.`,
    `${neededImports(imports, allMovedRefs, from, to)}${typeImports.length ? `import type { ${typeImports.join(', ')} } from '${specTo(to, from)}';\n` : ''}`.replace(/\n$/, ''),
    '',
    movedText.replace(/\n+$/, ''),
    movedText ? '' : null,
    `export function ${hookName}(${param ? `${propsName}: ${propsType}` : ''}) {`,
    ...(hookPattern ? [`  const ${hookPattern} = ${propsName};`] : []),
    prefixText,
    `  return { ${returned.map((d) => d.n).join(', ')} };`,
    '}',
    '',
  ].filter((l) => l !== null).join('\n').replace(/\n{3,}/g, '\n\n');

  // Check the hook's signature with Construct's controller binder: every name the presentation uses must be returned.
  const members = extractHookSignature(hookSrc, hookName);
  const unmatched = matchSlotsToHandlers(returned.map((d) => d.n), members).filter((m) => m.matchType !== 'exact');
  if (unmatched.length) throw new LineOpError(`The hook would not return ${unmatched.map((m) => m.slot).join(', ')}, which ${component} still uses; this is a bug in Line's split, so nothing was planned.`, 'SPLIT_FAILED');

  // The component file.
  /** @type {{start: number, end: number, text: string}[]} */
  const edits = [];
  const restPattern = pattern ? patternFor(sf, pattern, restRefs) : null;
  const call = `${returned.length ? `const { ${returned.map((d) => d.n).join(', ')} } = ` : ''}${hookName}(${param ? propsName : ''});`;
  const lead = sf.text.slice(prefix[0].getFullStart(), prefix[0].getStart(sf)).match(/[ \t]*$/)?.[0] ?? '  ';
  edits.push({ start: prefix[0].getStart(sf), end: prefix[prefix.length - 1].getEnd(), text: `${restPattern ? `const ${restPattern} = ${propsName};\n${lead}` : ''}${call}` });
  if (pattern) edits.push({ start: param.getStart(sf), end: param.getEnd(), text: `${propsName}: ${propsType}` });
  for (const t of moved) edits.push({ start: t.st.getFullStart(), end: t.st.getEnd(), text: '' });
  for (const t of sharedTypes) if (!t.exported) edits.push({ start: t.st.getStart(sf), end: t.st.getStart(sf), text: 'export ' });
  edits.push(...pruneImports(sf, imports, compRefsAfter));
  const spec = specTo(from, to);
  const back = [...movedNames].filter((n) => compRefsAfter.has(n));
  const typeNames = new Set([...moved].filter((t) => t.type).flatMap((t) => t.names));
  const backValues = back.filter((n) => !typeNames.has(n)).sort();
  const backTypes = back.filter((n) => typeNames.has(n)).sort();
  const reExported = [...moved].filter((t) => t.exported).flatMap((t) => t.names);
  let lines = `\nimport { ${[hookName, ...backValues].join(', ')} } from '${spec}';`;
  if (backTypes.length) lines += `\nimport type { ${backTypes.join(', ')} } from '${spec}';`;
  if (reExported.length) lines += `\nexport { ${reExported.filter((n) => !typeNames.has(n)).join(', ')} } from '${spec}';`.replace(/export \{ {2}\} from[^\n]*/, '');
  const at = importInsertAt(sf);
  edits.push({ start: at, end: at, text: at === 0 ? `${lines.trimStart()}\n` : lines });
  const compSrc = `${applyEdits(src, edits).replace(/\n{3,}/g, '\n\n').replace(/\s*$/, '')}\n`;
  return {
    summary: `Splits ${component}: its logic (${prefix.length} statement${prefix.length === 1 ? '' : 's'}) moves into ${hookName} in ${to}, and ${component} keeps only what it renders, using ${returned.length} value${returned.length === 1 ? '' : 's'} from the hook.`,
    files: [{ path: to, content: hookSrc }, { path: from, content: compSrc }],
    returned: returned.map((d) => d.n),
  };
}

// ------------------------------------------------------------------------------------------------- workflow

/** The app's package.json at or above the folder (read only), or null. */
function appPackage(root) {
  let dir = path.resolve(root);
  for (;;) {
    const p = path.join(dir, 'package.json');
    if (fs.existsSync(p)) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

const stateId = (s) => s.replace(/[^A-Za-z0-9]+(.)?/g, (_m, c) => (c ? c.toUpperCase() : '')).replace(/^[A-Z]/, (c) => c.toLowerCase()) || 'view';
const eventId = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase();

/**
 * What a component's screen flow is made of: the URL values it reads, the state it keeps, and where it navigates.
 * @param {any} sf @param {any} fn
 */
function readFlow(sf, fn) {
  const urlKeys = new Set();
  const targets = new Set();
  const states = [];
  const visit = (n) => {
    if (ts.isCallExpression(n)) {
      const callee = n.expression.getText(sf);
      const a0 = n.arguments[0];
      if (/(searchParams|params)\.get$/.test(callee) && a0 && ts.isStringLiteralLike(a0)) urlKeys.add(a0.text);
      if (/\b(router|navigate|history)\.(push|replace)$|^navigate$/.test(callee) && a0) {
        const head = ts.isStringLiteralLike(a0) ? a0.text : ts.isTemplateExpression(a0) ? a0.head.text : '';
        const p = head.split(/[?#]/)[0].replace(/\/+$/, '');
        if (p) targets.add(p);
      }
      if (/^use(State|Reducer)$/.test(callee) && ts.isVariableDeclaration(n.parent) && ts.isArrayBindingPattern(n.parent.name)) {
        const first = n.parent.name.elements[0];
        if (first && !ts.isOmittedExpression(first) && ts.isIdentifier(first.name)) states.push(first.name.text);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(fn);
  return { urlKeys: [...urlKeys].sort(), targets: [...targets].sort(), states };
}

/**
 * Plan an xstate workflow for a component's screen flow: one state for the view it renders and one per place it
 * navigates to, the URL values it reads as the workflow's context. The complete machine goes to the library and the
 * feature gets a workflow based on it (Line's library/feature pattern).
 * @param {string} root
 * @param {{from: string, component: string, name: string, feature?: string}} o
 * @param {{library: string, features: string}} layout
 * @returns {{summary: string, files: {path: string, content: string}[]}} The change: the library workflow and the feature's.
 */
export function planWorkflow(root, { from, component, name, feature }, layout) {
  const src = readCode(root, from);
  const pkg = appPackage(root);
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}), ...(pkg?.peerDependencies ?? {}) };
  if (!deps.xstate) throw new LineOpError('The app does not depend on xstate, so a Line workflow would not compile in it; add xstate to its package.json first, then run this step again.', 'NO_XSTATE');
  const sf = parse(from, src);
  const found = findComponent(sf, String(component ?? ''));
  if (!found?.fn) throw new LineOpError(`There is no component ${component} in ${posix.basename(from)}; name one of its components.`, 'UNKNOWN_ITEM');
  const flow = readFlow(sf, found.fn);
  if (!flow.targets.length && !flow.urlKeys.length) throw new LineOpError(`The component ${component} reads no URL values and navigates nowhere, so it has no screen flow to make a workflow of.`, 'NOTHING_TO_DO');
  const home = stateId(String(component).replace(/(Page|Client|Screen|View)$/, '')) || 'view';
  const stateOf = (p) => stateId(p.split('/').filter(Boolean).pop() ?? p);
  const targetStates = [...new Set(flow.targets.map(stateOf))].filter((s) => s !== home);
  const req = [{ id: 'r1', text: `${component} shows its view and moves to ${targetStates.length ? targetStates.join(', ') : 'itself'} as its URL and links say.` }];
  const transitions = [
    ...targetStates.map((s) => ({ from: home, event: `OPEN_${eventId(s)}`, to: s, req: ['r1'] })),
    ...targetStates.map((s) => ({ from: s, event: 'BACK', to: home, req: ['r1'] })),
    ...flow.urlKeys.map((k) => ({ from: home, event: `SET_${eventId(k)}`, to: home, req: ['r1'] })),
  ];
  const spec = {
    requirement: req,
    states: [{ id: home, initial: true }, ...targetStates.map((id) => ({ id }))],
    events: [...new Set(transitions.map((t) => t.event))].map((id) => ({ id })),
    transitions,
  };
  const descriptor = /** @type {any} */ (buildWorkflowDescriptor(spec));
  descriptor.context = Object.fromEntries(flow.urlKeys.map((k) => [stateId(k), { type: 'string | null', default: null }]));
  const { source } = compileWorkflow(descriptor, { name });
  const libRel = `${layout.library}/workflows/${name}.ts`;
  const featRel = feature ? `${layout.features}/${feature}/workflows/${name}.ts` : null;
  for (const p of [libRel, featRel].filter(Boolean)) if (fs.existsSync(path.join(root, /** @type {string} */ (p)))) throw new LineOpError(`There is already a file ${p}; pick another name for the workflow.`, 'NAME_TAKEN');
  const libSrc = `// Line Import (line.import.extractWorkflow): ${component}'s screen flow (from ${from}): URL values ${flow.urlKeys.join(', ') || 'none'}; navigates to ${flow.targets.join(', ') || 'nowhere'}.\n${source}`;
  const files = [{ path: libRel, content: libSrc }];
  if (featRel) files.push({ path: featRel, content: `// @line-base workflows/${name}\nexport * from '${specTo(featRel, libRel)}';\n` });
  return {
    summary: `Makes ${name}, an xstate workflow of ${component}'s screen flow (${1 + targetStates.length} state${targetStates.length ? 's' : ''}, ${flow.urlKeys.length} URL value${flow.urlKeys.length === 1 ? '' : 's'}), in the library${featRel ? ` with feature ${feature}'s workflow based on it` : ''}.`,
    files,
  };
}

// ------------------------------------------------------------------------------------------------- the tools

const FACTORY = { 'line.import.extractService': 'defineService', 'line.import.extractDomain': 'defineDomain' };

/**
 * Every extract tool, as (folderRoot, args) -> StagedChange. Args are folder-relative; `feature` names the feature the
 * new file belongs to (none: the library).
 */
export const EXTRACT_STEP_TOOLS = Object.freeze({
  'line.import.extractService': (root, args) => moveStep(root, 'line.import.extractService', args),
  'line.import.extractDomain': (root, args) => moveStep(root, 'line.import.extractDomain', args),
  'line.import.extractUsecase': (root, args) => moveStep(root, 'line.import.extractUsecase', args),
  'line.import.splitPage': (root, args) => {
    checkTargetArgs(args);
    if (!/^use[A-Z]/.test(String(args.name))) throw new LineOpError(`A hook's name starts with "use", such as use${args.component ?? 'Orders'}; "${args.name}" does not.`, 'BAD_NAME');
    const to = extractTarget(layoutOf(root), 'line.import.splitPage', args);
    const { summary, files } = planSplit(root, { from: args.from, component: args.component, name: args.name, to });
    return { summary, files };
  },
  'line.import.extractWorkflow': (root, args) => {
    checkTargetArgs(args);
    return planWorkflow(root, { from: args.from, component: args.component, name: args.name, feature: args.feature }, layoutOf(root));
  },
});

function moveStep(root, tool, args) {
  checkTargetArgs(args);
  const to = extractTarget(layoutOf(root), tool, args);
  const factory = FACTORY[tool];
  const typed = typeof args.typedContracts === 'string' && args.typedContracts ? args.typedContracts : undefined;
  const { summary, files } = planMoveDeclarations(root, { from: args.from, names: args.names, to, tool, typedContracts: typed, factory });
  return { summary, files };
}

/**
 * One extract step's StagedChange, planned on the folder as it is now.
 * @param {string} folderRoot `<project>/<args.folder>` (absolute).
 * @param {{tool: string, args: Record<string, any>}} step
 * @returns {import('../contract.mjs').StagedChange}
 */
export function planExtractStep(folderRoot, step) {
  const tool = EXTRACT_STEP_TOOLS[/** @type {keyof typeof EXTRACT_STEP_TOOLS} */ (step?.tool)];
  if (!tool) throw new LineOpError(`"${step?.tool}" is not an extract step Line knows.`, 'UNKNOWN_TOOL');
  const change = tool(folderRoot, /** @type {any} */ (step.args ?? {}));
  assertStagedChange(change);
  return change;
}

/** The logic kinds the extract tools write (the profile's LOGIC_KINDS, plus workflows). */
export const EXTRACT_KINDS = Object.freeze([...LOGIC_KINDS, 'workflows']);
