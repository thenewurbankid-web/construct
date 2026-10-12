// line-expressions -- `line.extractExpression`: the typed fix of COMPONENT-005, COMPONENT-006 and PAGE-008 inside a
// Line project. It moves one inline conditional or loop out of a page's or component's JSX into a Line expression (the
// `expressions` kind, packages/core/profiles/line/contract.mjs): a pure, typed function component whose inputs are all
// explicit props.
//
// It reuses Construct's extractExpression AST work (collectInlineJsxLogic finds the block, deriveExpressionName names it)
// and closes the three gaps that kept that codemod out of Line:
//   1. the new file imports nothing outside the project: no typed-contracts factory, only the page's own imports
//      (re-pointed from the new folder), the page's own types (exported when they were not) and plain TypeScript;
//   2. every free variable the JSX uses (a prop, a state value, a handler, a top-level constant) becomes a typed prop,
//      found with the TypeScript checker (a symbol declared in the file outside the block), and the call site passes it;
//   3. a feature expression links `@line-base expressions/<Name>` when the library has an expression of that name;
//      otherwise it is a feature expression with no base (LINE-BASE allows that for expressions) and the summary says so.
// The change is planned only (pure): it lands through applyChange like every Line step, after the type gate
// (typeGate.mjs) checked the page and the new file as the change would leave them.
//
//   planExtractExpression(root, {file, name?})  -> StagedChange       the plan tool's planner (fixes.mjs planStep)
//   expressionFixes(root, file, rule)           -> LineFix[]          the typed fix of an expression warning
//   expressionTarget(layout, file, name)        -> string | null      where the expression of `file` named `name` goes
import fs from 'node:fs';
import path from 'node:path';
import { ts } from '@construct/ast/lazy';
import { parseToAst, collectInlineJsxLogic, lineOf } from '@construct/ast';
import { deriveExpressionName } from '@line/construct-core/extract-expression';
import { loadConfig } from '@line/construct-core/config';
import { normalizeLineConfig } from '@line/construct-core/profiles/line/contract';
import { resolveLayout, classify } from '@line/construct-core/profiles/line/checks';
import { LineOpError } from './contract.mjs';
import { typeCheckStaged, typeRefusal, optionsOf } from './typeGate.mjs';

const posix = path.posix;
/** The rules whose typed fix is line.extractExpression. */
export const EXPRESSION_RULES = Object.freeze(['COMPONENT-005', 'COMPONENT-006', 'PAGE-008']);
/** The kinds an expression is extracted from, and the file types (JSX) it can come from. */
const FROM_KINDS = Object.freeze(['components', 'pages']);
const JSX_FILE = /\.(tsx|jsx)$/;
/** Prop names React keeps for itself: such a value is passed under `<name>Value`. */
const RESERVED_PROPS = new Set(['key', 'ref', 'children']);
const NAME = /^[A-Z][A-Za-z0-9]*$/;

const layoutOf = (root) => resolveLayout(root, normalizeLineConfig(/** @type {any} */ (loadConfig(root)).line));
const readOrNull = (abs) => { try { return fs.readFileSync(abs, 'utf8'); } catch { return null; } };
const stripExt = (p) => p.replace(/\.[cm]?[jt]sx?$/, '');
const pascal = (s) => s.replace(/[^A-Za-z0-9]+(.)?/g, (_m, c) => (c ? c.toUpperCase() : '')).replace(/^./, (c) => c.toUpperCase());
/** A relative import specifier from folder `fromDir` to file `to` (root-relative posix), without its extension. */
const specifierTo = (fromDir, to) => { const s = posix.relative(fromDir, stripExt(to)).replace(/\/index$/, ''); return s.startsWith('.') ? s : `./${s}`; };

/** A root-relative path with no escape, or null. */
function cleanRel(p) {
  if (typeof p !== 'string' || !p || p.includes('\\') || p.includes('\0') || path.isAbsolute(p)) return null;
  return p.split('/').some((s) => s === '' || s === '.' || s === '..' || s === 'node_modules' || s.startsWith('.')) ? null : p;
}

/** The inline conditionals and loops of `source` that no other one contains (an inner one moves with its outer one). */
function outerHits(source) {
  let ast;
  try { ast = parseToAst(source); } catch { return []; }
  const hits = collectInlineJsxLogic(ast);
  return hits.filter((h) => !hits.some((o) => o !== h && o.node.range[0] <= h.node.range[0] && o.node.range[1] >= h.node.range[1]));
}

/** The name an expression of `hit` in `file` gets: derived from what it tests or maps, else from the file. */
function nameFor(hit, file) {
  const derived = deriveExpressionName(hit);
  if (derived && NAME.test(derived)) return derived;
  const item = pascal(stripExt(posix.basename(file))) || 'Item';
  return `${item}${hit.kind === 'loop' ? 'Rows' : 'Branch'}`;
}

/**
 * Where the expression named `name` extracted from `file` goes: `<library>/expressions/` for a library item,
 * `<features>/<feature>/expressions/` for a feature item; null for a file that is neither.
 * @param {{library: string, features: string}} layout @param {string} file @param {string} name
 * @returns {string | null}
 */
export function expressionTarget(layout, file, name) {
  const place = classify(String(file ?? ''), /** @type {any} */ (layout));
  if (place.area === 'library') return `${layout.library}/expressions/${name}.tsx`;
  if (place.area === 'feature' && place.feature) return `${layout.features}/${place.feature}/expressions/${name}.tsx`;
  return null;
}

/** The library expression of that name, if there is one (root-relative), else null. */
function libraryExpression(root, layout, name) {
  for (const ext of ['.tsx', '.jsx', '.ts', '.js']) {
    const rel = `${layout.library}/expressions/${name}${ext}`;
    if (fs.existsSync(path.join(root, rel))) return rel;
  }
  return null;
}

/** The first free name `<base>`, `<base>2`, ... with no expression file in the target folder. */
function freeName(root, layout, file, base) {
  for (let i = 1; i < 50; i += 1) {
    const name = i === 1 ? base : `${base}${i}`;
    const target = expressionTarget(layout, file, name);
    if (target && !['.tsx', '.jsx', '.ts', '.js'].some((x) => fs.existsSync(path.join(root, stripExt(target) + x)))) return name;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// The free variables of a JSX block (the TypeScript checker)

/** The outermost TS node spanning exactly [start, end). */
function nodeAt(sf, start, end) {
  let hit = null;
  const visit = (n) => {
    if (hit || n.getStart(sf) > start || n.end < end) return;
    if (n.getStart(sf) === start && n.end === end) { hit = n; return; }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(sf, visit);
  return hit;
}

/** Whether identifier `id` is a name (a property, an attribute, an intrinsic tag), not a reference to a value. */
function isNameOnly(id) {
  const p = id.parent;
  if (!p) return true;
  if ((ts.isPropertyAccessExpression(p) || ts.isQualifiedName(p)) && (/** @type {any} */ (p).name === id || /** @type {any} */ (p).right === id)) return true;
  if ((ts.isPropertyAssignment(p) || ts.isPropertySignature(p) || ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p)) && p.name === id) return true;
  if (ts.isJsxAttribute(p) || ts.isJsxNamespacedName(p)) return true;
  if (ts.isBindingElement(p) && p.propertyName === id) return true;
  if ((ts.isJsxOpeningElement(p) || ts.isJsxSelfClosingElement(p) || ts.isJsxClosingElement(p)) && p.tagName === id && /^[a-z]/.test(id.text)) return true;
  return false;
}

/** The import declaration text that brings `localName` in, from the declaration node of an import alias. */
function importOf(decl) {
  let clause = null; let what = null;
  if (ts.isImportSpecifier(decl)) { clause = decl.parent.parent; what = { named: decl.propertyName ? decl.propertyName.text : decl.name.text, local: decl.name.text, typeOnly: decl.isTypeOnly }; }
  else if (ts.isImportClause(decl)) { clause = decl; what = { default: true, local: /** @type {any} */ (decl.name).text }; }
  else if (ts.isNamespaceImport(decl)) { clause = decl.parent; what = { namespace: true, local: decl.name.text }; }
  if (!clause || !ts.isImportDeclaration(clause.parent) || !ts.isStringLiteral(clause.parent.moduleSpecifier)) return null;
  return { ...what, typeOnly: Boolean(clause.isTypeOnly || what?.typeOnly), specifier: clause.parent.moduleSpecifier.text };
}

/** The top-level statement of the source file that holds `node`. */
function topStatementOf(node, sf) {
  let n = node;
  while (n.parent && n.parent !== sf) n = n.parent;
  return n.parent === sf ? n : null;
}

const isExported = (stmt) => Boolean(ts.getCombinedModifierFlags(stmt) & ts.ModifierFlags.Export);

/**
 * The type the source wrote for a value: its own annotation, or (a destructured prop) its member in the parameter's
 * type literal or in the file's interface or type alias of that name. Null when the source wrote none.
 * @returns {{node: any, optional: boolean} | null}
 */
function annotationOf(sym, sf) {
  const d = sym.declarations?.[0];
  if (!d) return null;
  if ((ts.isVariableDeclaration(d) || ts.isParameter(d)) && d.type) return { node: d.type, optional: false };
  if (!ts.isBindingElement(d) || !ts.isObjectBindingPattern(d.parent)) return null;
  const holder = d.parent.parent;
  const key = (d.propertyName ?? d.name).getText(sf);
  let t = /** @type {any} */ (holder).type;
  if (t && ts.isTypeReferenceNode(t) && ts.isIdentifier(t.typeName)) {
    const name = t.typeName.text;
    const decl = sf.statements.find((s) => (ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s)) && s.name.text === name);
    t = decl && ts.isTypeAliasDeclaration(decl) ? decl.type : decl;
  }
  const members = t && (ts.isTypeLiteralNode(t) || ts.isInterfaceDeclaration(t)) ? t.members : [];
  const m = members.find((x) => ts.isPropertySignature(x) && x.name.getText(sf) === key);
  return m?.type ? { node: m.type, optional: Boolean(m.questionToken) && !d.initializer } : null;
}

/**
 * What a JSX block in `file` uses from outside itself: the values (free variables, each with its declared type as
 * TypeScript prints it), the imports it relies on and the page's own types the prop types name.
 * @param {string} root Project root.
 * @param {string} rel The page or component (root-relative).
 * @param {string} source Its source text.
 * @param {[number, number]} range The block's [start, end) offsets.
 * @returns {{props: {name: string, type: string}[], imports: ReturnType<typeof importOf>[], localTypes: {name: string, exported: boolean, at: number}[], unresolved: string[], replace: [number, number]}}
 *   `replace` is what the call site replaces: the block, or its `{...}` when it is a child of the JSX.
 */
export function freeVariables(root, rel, source, range) {
  const abs = path.join(root, rel);
  const options = { ...(optionsOf(root) ?? { jsx: ts.JsxEmit.ReactJSX, strict: true, target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler }), noEmit: true };
  const host = ts.createCompilerHost(options, true);
  const readFile = host.readFile.bind(host);
  host.readFile = (f) => (path.resolve(f) === path.resolve(abs) ? source : readFile(f));
  const program = ts.createProgram({ rootNames: [abs], options, host });
  const sf = program.getSourceFile(abs);
  const checker = program.getTypeChecker();
  if (!sf) throw new LineOpError(`${rel} could not be read as TypeScript.`, 'BAD_CODE');
  const block = nodeAt(sf, range[0], range[1]);
  if (!block) throw new LineOpError(`The inline logic at line ${lineOf(source, range[0])} of ${rel} could not be found in its syntax tree.`, 'BAD_CODE');
  const inside = (d) => d.getSourceFile() === sf && d.pos >= block.pos && d.end <= block.end;

  /** @type {Map<string, any>} */ const values = new Map();
  /** @type {Map<string, any>} */ const imports = new Map();
  /** @type {Set<any>} */ const typeSymbols = new Set();
  const visit = (n) => {
    if (ts.isIdentifier(n) && !isNameOnly(n)) {
      const sym = ts.isShorthandPropertyAssignment(n.parent) && n.parent.name === n ? checker.getShorthandAssignmentValueSymbol(n.parent) : checker.getSymbolAtLocation(n);
      const decls = sym?.declarations ?? [];
      if (decls.length && decls.every((d) => d.getSourceFile() === sf) && !decls.every(inside)) {
        const d = decls[0];
        const imp = importOf(d);
        if (imp) imports.set(imp.local, imp);
        else if (sym && !(sym.flags & ts.SymbolFlags.Value)) typeSymbols.add(sym);
        else if (sym && !values.has(n.text)) values.set(n.text, sym);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(block);

  // Each value's declared type (never the type narrowed at its use: the block re-tests what it tests).
  const flags = ts.NodeBuilderFlags.NoTruncation | ts.NodeBuilderFlags.UseAliasDefinedOutsideOfCurrentScope | ts.NodeBuilderFlags.IgnoreErrors;
  const printer = ts.createPrinter({ removeComments: true });
  const typeNames = new Set();
  const unresolved = [];
  const props = [];
  for (const [name, sym] of values) {
    const declared = checker.getTypeOfSymbol(sym);
    // A constant's literal type ('$') is widened (string), so the prop takes any value of its kind.
    const type = declared.flags & (ts.TypeFlags.StringLiteral | ts.TypeFlags.NumberLiteral) ? checker.getBaseTypeOfLiteralType(declared) : declared;
    // A type TypeScript cannot work out (any, e.g. a package's types not installed) falls back to what the source wrote.
    const written = type.flags & ts.TypeFlags.Any ? annotationOf(sym, sf) : null;
    const node = written ? written.node : checker.typeToTypeNode(type, block, flags);
    if (!node) { unresolved.push(name); continue; }
    const walk = (t) => {
      if (ts.isTypeReferenceNode(t) || ts.isExpressionWithTypeArguments(t)) {
        let e = /** @type {any} */ (ts.isTypeReferenceNode(t) ? t.typeName : t.expression);
        while (e && (ts.isQualifiedName(e) || ts.isPropertyAccessExpression(e))) e = ts.isQualifiedName(e) ? e.left : e.expression;
        if (e && ts.isIdentifier(e)) typeNames.add(e.text);
      } else if (ts.isTypeQueryNode(t)) {
        let e = /** @type {any} */ (t.exprName);
        while (e && ts.isQualifiedName(e)) e = e.left;
        if (e && ts.isIdentifier(e)) typeNames.add(e.text);
      }
      ts.forEachChild(t, walk);
    };
    walk(node);
    let text = written ? `${node.getText(sf).replace(/\s*\n\s*/g, ' ')}${written.optional ? ' | undefined' : ''}` : printer.printNode(ts.EmitHint.Unspecified, node, sf).replace(/\s*\n\s*/g, ' ');
    // An inaccessible type is printed as import("<absolute path>").Name: point it at the project file or the package.
    text = text.replace(/import\("([^"]+)"\)/g, (_m, spec) => {
      const r = path.isAbsolute(spec) ? path.relative(root, spec).split(path.sep).join('/') : spec;
      if (!path.isAbsolute(spec)) return `import("${spec}")`;
      const nm = r.lastIndexOf('node_modules/');
      if (nm >= 0) { const segs = r.slice(nm + 'node_modules/'.length).split('/'); const pkg = segs[0].startsWith('@') ? `${segs[0]}/${segs[1]}` : segs[0]; return `import("${pkg.replace(/^@types\//, '')}")`; }
      return `import("${r.startsWith('..') ? spec : `@@ROOT@@/${stripExt(r)}`}")`;
    });
    props.push({ name, type: text });
  }
  // The type names the prop types use, as the page sees them: its imports, its own declarations or globals.
  const localTypes = new Map();
  const typeSyms = new Set(typeSymbols);
  for (const n of typeNames) {
    const sym = checker.resolveName(n, block, ts.SymbolFlags.Type | ts.SymbolFlags.Namespace | ts.SymbolFlags.Alias, false);
    if (!sym) { unresolved.push(n); continue; }
    typeSyms.add(sym);
  }
  for (const sym of typeSyms) {
    const d = sym.declarations?.[0];
    if (!d || d.getSourceFile() !== sf || inside(d)) continue;
    const imp = importOf(d);
    if (imp) { if (!imports.has(imp.local)) imports.set(imp.local, { ...imp, typeOnly: true }); continue; }
    const stmt = topStatementOf(d, sf);
    if (!stmt) { unresolved.push(sym.name); continue; }
    localTypes.set(sym.name, { name: sym.name, exported: isExported(stmt), at: stmt.getStart(sf) });
  }
  // What the call site replaces: the block, or its `{...}` when the block is a child of the JSX.
  let outer = block;
  while (outer.parent && ts.isParenthesizedExpression(outer.parent)) outer = outer.parent;
  const holder = outer.parent;
  const child = holder && ts.isJsxExpression(holder) && holder.parent && (ts.isJsxElement(holder.parent) || ts.isJsxFragment(holder.parent));
  /** @type {[number, number]} */
  const replace = child ? [holder.getStart(sf), holder.end] : [range[0], range[1]];
  return { props, imports: [...imports.values()], localTypes: [...localTypes.values()], unresolved, replace };
}

// ---------------------------------------------------------------------------------------------
// The planner

/**
 * Plan `line.extractExpression`: the first inline conditional or loop of `file` (the one the warning reports) moves into
 * a new expression; the call site renders it with every value it uses passed as a typed prop. Pure (nothing written).
 * @param {string} root Project root.
 * @param {import('./contract.mjs').ExtractExpressionRequest} req
 * @returns {import('./contract.mjs').StagedChange}
 * @throws {LineOpError} UNKNOWN_ITEM, WRONG_KIND, NOTHING_TO_DO, BAD_NAME, NAME_TAKEN, BAD_CODE or TYPE_ERROR.
 */
export function planExtractExpression(root, { file, name } = /** @type {any} */ ({})) {
  const layout = layoutOf(root);
  const rel = cleanRel(file);
  const source = rel ? readOrNull(path.join(root, rel)) : null;
  if (!rel || source === null) throw new LineOpError(`There is no file ${file} in the library or a feature.`, 'UNKNOWN_ITEM');
  const place = classify(rel, /** @type {any} */ (layout));
  if ((place.area !== 'library' && place.area !== 'feature') || !FROM_KINDS.includes(String(place.kind)) || !JSX_FILE.test(rel)) {
    throw new LineOpError(`An expression is extracted from a page or component (.tsx or .jsx) in the library or a feature; ${rel} is not one.`, 'WRONG_KIND');
  }
  const [hit] = outerHits(source);
  if (!hit) throw new LineOpError(`${posix.basename(rel)} renders no inline conditional or loop, so there is nothing to extract.`, 'NOTHING_TO_DO');
  const exprName = name === undefined ? nameFor(hit, rel) : String(name);
  if (!NAME.test(exprName)) throw new LineOpError(`"${exprName}" is not a component name; an expression is named like ProductList (a capital letter, then letters and digits).`, 'BAD_NAME');
  const target = /** @type {string} */ (expressionTarget(layout, rel, exprName));
  if (['.tsx', '.jsx', '.ts', '.js'].some((x) => fs.existsSync(path.join(root, stripExt(target) + x)))) {
    throw new LineOpError(`There is already an expression ${exprName} in ${posix.dirname(target)}; pick another name.`, 'NAME_TAKEN');
  }
  if (new RegExp(`\\b${exprName}\\b`).test(source)) throw new LineOpError(`${posix.basename(rel)} already uses the name ${exprName}; pick another name for the expression.`, 'NAME_TAKEN');

  const range = /** @type {[number, number]} */ (hit.node.range);
  const free = freeVariables(root, rel, source, range);
  if (free.unresolved.length) {
    throw new LineOpError(`The ${hit.kind} at line ${lineOf(source, range[0])} uses ${free.unresolved.join(', ')}, whose type Line cannot name outside ${posix.basename(rel)}; move ${free.unresolved.length === 1 ? 'that type' : 'those types'} to the top of the file first.`, 'BAD_CODE');
  }
  const targetDir = posix.dirname(target);
  const relDir = posix.dirname(rel);

  // The new file's imports: the page's own (relative ones re-pointed from the new folder) and the page's types.
  /** @type {Map<string, {named: Set<string>, typeNamed: Set<string>, default?: string, namespace?: string}>} */
  const bySpec = new Map();
  const entry = (spec) => { if (!bySpec.has(spec)) bySpec.set(spec, { named: new Set(), typeNamed: new Set() }); return /** @type {any} */ (bySpec.get(spec)); };
  for (const imp of free.imports) {
    if (!imp) continue;
    const spec = imp.specifier.startsWith('.') ? specifierTo(targetDir, posix.normalize(posix.join(relDir, imp.specifier))) : imp.specifier;
    const e = entry(spec);
    if (imp.default) e.default = imp.local;
    else if (imp.namespace) e.namespace = imp.local;
    else (imp.typeOnly ? e.typeNamed : e.named).add(imp.named === imp.local ? imp.local : `${imp.named} as ${imp.local}`);
  }
  const pageSpec = specifierTo(targetDir, rel);
  for (const t of free.localTypes) entry(pageSpec).typeNamed.add(t.name);
  const importLines = [...bySpec].map(([spec, e]) => {
    const lines = [];
    if (e.namespace) lines.push(`import * as ${e.namespace} from '${spec}';`);
    const named = [...e.named];
    if (e.default || named.length) lines.push(`import ${[e.default, named.length ? `{ ${named.join(', ')} }` : null].filter(Boolean).join(', ')} from '${spec}';`);
    if (e.typeNamed.size) lines.push(`import type { ${[...e.typeNamed].join(', ')} } from '${spec}';`);
    return lines.join('\n');
  }).filter(Boolean);

  const props = free.props.map((p) => ({ ...p, prop: RESERVED_PROPS.has(p.name) ? `${p.name}Value` : p.name }))
    .map((p) => ({ ...p, type: p.type.replace(/import\("@@ROOT@@\/([^"]+)"\)/g, (_m, r) => `import("${specifierTo(targetDir, r)}")`) }));
  const base = place.area === 'feature' ? libraryExpression(root, layout, exprName) : null;
  const blockText = source.slice(range[0], range[1]);
  const what = hit.kind === 'loop' ? 'list' : 'conditional';
  const header = [
    ...(base ? [`// @line-base expressions/${exprName}`] : []),
    `// A Line expression: the ${what} ${posix.basename(rel)} rendered inline. Pure: every value it uses is a prop.`,
  ];
  const propsType = `${exprName}Props`;
  const binding = props.map((p) => (p.prop === p.name ? p.name : `${p.prop}: ${p.name}`)).join(', ');
  const exprSource = [
    ...header,
    ...importLines,
    '',
    ...(props.length ? [`export interface ${propsType} {`, ...props.map((p) => `  ${p.prop}: ${p.type};`), '}', ''] : []),
    props.length ? `export function ${exprName}({ ${binding} }: ${propsType}) {` : `export function ${exprName}() {`,
    `  return <>{${blockText}}</>;`,
    '}',
    '',
  ].join('\n');

  // The call site: the block (with its {} when it is a child of the JSX) becomes the expression with its props.
  const call = `<${exprName}${props.map((p) => ` ${p.prop}={${p.name}}`).join('')} />`;
  const [from, to] = free.replace;
  /** @type {{at: number, end: number, text: string}[]} */
  const edits = [{ at: from, end: to, text: call }];
  for (const t of free.localTypes) if (!t.exported) edits.push({ at: t.at, end: t.at, text: 'export ' });
  // The page imports the expression after its last import, else after a directive and the leading comments (the
  // @line-base link stays the first line).
  const imports = [...source.matchAll(/^import\s[^;]*;[ \t]*$/gm)];
  const importLine = `import { ${exprName} } from '${specifierTo(relDir, target)}';`;
  const last = imports.at(-1);
  if (last) {
    const at = /** @type {number} */ (last.index) + last[0].length;
    edits.push({ at, end: at, text: `\n${importLine}` });
  } else {
    const lead = /^(?:(['"])use [a-z]+\1;?[ \t]*\n|\/\/[^\n]*\n)*/.exec(source);
    const at = lead ? lead[0].length : 0;
    edits.push({ at, end: at, text: `${importLine}\n` });
  }
  let page = source;
  for (const e of edits.sort((a, b) => b.at - a.at || b.end - a.end)) page = page.slice(0, e.at) + e.text + page.slice(e.end);

  const files = [{ path: rel, content: page }, { path: target, content: exprSource }];
  const types = typeCheckStaged(root, files);
  const warnings = [];
  if (types && types.errors.length) {
    if (!types.slow) {
      const { sentence, detail } = typeRefusal(types.errors);
      throw new LineOpError(sentence, 'TYPE_ERROR', detail);
    }
    for (const d of types.errors) warnings.push({ sentence: `The extracted code may not compile (${d.message.split('\n')[0].replace(/[.?!]$/, '')}).`, rule: d.code, severity: 'warning', file: d.file, line: d.line });
  }
  const inputs = props.length ? `with ${props.length === 1 ? 'its one input' : `its ${props.length} inputs`} (${props.map((p) => p.prop).join(', ')}) as typed props` : 'with no inputs';
  const baseSentence = place.area === 'library' ? 'It is a library expression.'
    : base ? `It is based on the library expression ${exprName}.`
      : `No library expression is called ${exprName}, so it is a feature expression with no base; promote it with line.promote once a second feature needs it.`;
  return {
    summary: `Moves the ${what} at line ${lineOf(source, range[0])} of ${posix.basename(rel)} into the new expression ${exprName} (${target}), ${inputs}. ${baseSentence}`,
    files,
    ...(types ? { typeCheck: { ms: types.ms, slow: types.slow } } : {}),
    ...(warnings.length ? { warnings } : {}),
  };
}

/**
 * The typed fix of an expression warning (COMPONENT-005, COMPONENT-006, PAGE-008) on `file`: one line.extractExpression
 * step whose sentence names the new expression; advice only (step null) when the file has no inline logic to move.
 * @param {string} root Project root.
 * @param {string} file The page or component the warning is on.
 * @param {string} rule The rule id.
 * @returns {import('./contract.mjs').LineFix[]}
 */
export function expressionFixes(root, file, rule) {
  const layout = layoutOf(root);
  const source = cleanRel(file) ? readOrNull(path.join(root, file)) : null;
  const [hit] = source === null ? [] : outerHits(source);
  const base = (file && posix.basename(file)) || 'this file';
  if (!hit || !JSX_FILE.test(String(file))) {
    return [{ id: `${rule}/split-by-hand`, rank: 1, step: null, sentence: `Split ${base} into smaller components; it has no inline conditional or loop Line can move into an expression.` }];
  }
  const name = freeName(root, layout, file, nameFor(hit, file));
  const target = name && expressionTarget(layout, file, name);
  if (!name || !target) return [{ id: `${rule}/name-taken`, rank: 1, step: null, sentence: `Move the inline logic of ${base} into an expression by hand; every name Line would give it is taken.` }];
  const what = hit.kind === 'loop' ? 'list' : 'conditional';
  return [{
    id: `${rule}/extract-expression:${name}`, rank: 1,
    sentence: `Move the ${what} at line ${lineOf(source ?? '', hit.node.range[0])} of ${base} into a new expression ${name} (${target}), with every value it uses passed in as a typed prop.`,
    step: { tool: 'line.extractExpression', args: { file, name } },
  }];
}
