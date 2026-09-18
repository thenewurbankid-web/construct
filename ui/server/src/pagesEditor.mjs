// Backend for epic #48 (visual page/JSX tree editor) — #49 pages browser,
// #50 JSX tree parse, #52 snippet save-back, #53 props inspector, #54
// auto-map, #56 enforcement guard. Kept in one module (rather than one file
// per sub-issue) because every later piece re-parses the same page file
// with the same node-id scheme the earlier piece defined — splitting them
// would just mean re-exporting the same handful of helpers back and forth.
//
// Scope guard (#56, applied everywhere from the start, not bolted on at the
// end): every function here that takes a `feature`/`file` pair validates
// the resolved path is inside `features/<feature>/pages/` before touching
// disk. This mirrors the `page` layer's pattern in src/config.mjs's
// DEFAULT_LAYERS (`features/*/pages/**`) — the editor must never be able to
// read or write outside that layer.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import * as t from '@babel/types';
import ts from 'typescript';
import { loadConfig } from '../../../src/config.mjs';
import { loadLayerGraph } from '../../../src/architecture-graph.mjs';
import { validateArchitecture } from '../../../src/architecture-enforcer.mjs';
import { validateSeparationOfConcerns } from '../../../src/soc-enforcer.mjs';
import { walk, rel } from '../../../src/fs.mjs';

// @babel/traverse's default export shape differs between ESM interop modes;
// this normalizes it the same way babel's own docs recommend.
const traverse = _traverse.default || _traverse;

const JSX_EXTENSIONS = new Set(['.jsx', '.tsx', '.js', '.ts']);

export class PagesEditorError extends Error {
  constructor(message, { status = 400, violations } = {}) {
    super(message);
    this.status = status;
    this.violations = violations;
  }
}

function featuresRootOf(root) {
  return loadConfig(root).features?.root || 'features';
}

/** Every feature directory under the configured features root. */
export function listFeatures(root) {
  const base = path.join(root, featuresRootOf(root));
  if (!fs.existsSync(base)) return [];
  return fs
    .readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

/** Every file under features/<feature>/pages/**, relative to that pages/
 * folder (e.g. "Home.jsx", "billing/Detail.tsx"). */
export function listPages(root, feature) {
  const featuresRoot = featuresRootOf(root);
  const pagesDir = path.join(root, featuresRoot, feature, 'pages');
  if (!fs.existsSync(pagesDir)) return [];
  return walk(pagesDir)
    .filter((p) => JSX_EXTENSIONS.has(path.extname(p)))
    .map((p) => rel(pagesDir, p))
    .sort();
}

/** Resolve + validate a (feature, file) pair to an absolute path strictly
 * inside that feature's pages/ folder. Throws PagesEditorError (#56 scope
 * guard) on any attempt to escape it — a `..` segment, an absolute file
 * path, a symlink-free resolution that lands outside pages/, or a
 * feature/file that simply doesn't exist. */
export function resolvePageFile(root, feature, file) {
  if (!feature || typeof feature !== 'string' || /[/\\]/.test(feature)) {
    throw new PagesEditorError('Invalid feature name.');
  }
  if (!file || typeof file !== 'string') {
    throw new PagesEditorError('Invalid file path.');
  }
  const featuresRoot = featuresRootOf(root);
  const pagesDir = path.resolve(path.join(root, featuresRoot, feature, 'pages'));
  const resolved = path.resolve(path.join(pagesDir, file));
  const withSep = pagesDir.endsWith(path.sep) ? pagesDir : pagesDir + path.sep;
  if (resolved !== pagesDir && !resolved.startsWith(withSep)) {
    throw new PagesEditorError(`Path "${file}" escapes features/${feature}/pages/ — the editor is scoped to the pages/ layer only.`);
  }
  if (!JSX_EXTENSIONS.has(path.extname(resolved))) {
    throw new PagesEditorError(`"${file}" is not a JS/JSX/TS/TSX file.`);
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new PagesEditorError(`No such page file: features/${feature}/pages/${file}`, { status: 404 });
  }
  // Belt-and-suspenders: also confirm the layer graph actually classifies
  // this path as the `page` layer (catches a project-level architecture.yml
  // override that redefines the pages/ pattern out from under us).
  const graph = loadLayerGraph(root);
  const relFromRoot = rel(root, resolved);
  const pattern = graph.page?.pattern;
  if (pattern) {
    const re = new RegExp('^' + pattern.replaceAll('**', '§').replaceAll('*', '[^/]*').replaceAll('§', '.*') + '$');
    if (!re.test(relFromRoot)) {
      throw new PagesEditorError(`"${relFromRoot}" is not classified as the "page" layer by this project's architecture.yml.`);
    }
  }
  return { absPath: resolved, relPath: relFromRoot };
}

function parseSource(source) {
  return parse(source, {
    sourceType: 'module',
    plugins: ['jsx', 'typescript'],
    errorRecovery: false,
  });
}

function jsxNameToString(nameNode) {
  if (t.isJSXIdentifier(nameNode)) return nameNode.name;
  if (t.isJSXMemberExpression(nameNode)) return `${jsxNameToString(nameNode.object)}.${jsxNameToString(nameNode.property)}`;
  if (t.isJSXNamespacedName(nameNode)) return `${nameNode.namespace.name}:${nameNode.name.name}`;
  return '?';
}

function attrsOf(openingElement, source) {
  return openingElement.attributes.map((attr) => {
    if (t.isJSXSpreadAttribute(attr)) {
      return { kind: 'spread', name: null, value: source.slice(attr.argument.start, attr.argument.end) };
    }
    const name = jsxNameToString(attr.name);
    if (attr.value == null) return { kind: 'boolean', name, value: true };
    if (t.isStringLiteral(attr.value)) return { kind: 'string', name, value: attr.value.value };
    if (t.isJSXExpressionContainer(attr.value)) {
      const expr = attr.value.expression;
      if (t.isStringLiteral(expr)) return { kind: 'string', name, value: expr.value };
      if (t.isNumericLiteral(expr)) return { kind: 'number', name, value: expr.value };
      if (t.isBooleanLiteral(expr)) return { kind: 'boolean', name, value: expr.value };
      if (t.isIdentifier(expr)) return { kind: 'identifier', name, value: expr.name };
      return { kind: 'expression', name, value: source.slice(expr.start, expr.end) };
    }
    return { kind: 'expression', name, value: source.slice(attr.value.start, attr.value.end) };
  });
}

/**
 * Parse a page file's JSX into a navigable, serializable element tree.
 * Node ids are assigned in source (document) order during one traversal —
 * `n0`, `n1`, ... — which is what every later save/props/auto-map lookup
 * uses to re-find "the same" node on a fresh re-parse. Ids are only valid
 * for the exact source text they were computed from, which is why every
 * mutating endpoint re-parses fresh and includes `contentHash` (sha256 of
 * the file's current text) so a stale client can't silently patch the
 * wrong node after the file changed underneath it.
 */
export function parsePageTree(source) {
  const ast = parseSource(source);
  let counter = 0;
  const byId = new Map();
  const roots = [];
  const stack = []; // ancestor chain, outermost first

  // A single enter-only visitor over both node types, in document (source)
  // order. Ancestry is derived purely from source ranges — pop any stack
  // entry that has already closed before this node starts — which
  // correctly nests elements found anywhere in a parent's subtree
  // (including inside `{cond && <Child/>}` or `.map(...)` callbacks, not
  // just its direct `children` array), unlike walking `node.children` by
  // hand.
  traverse(ast, {
    'JSXElement|JSXFragment'(nodePath) {
      const node = nodePath.node;
      const isFragment = t.isJSXFragment(node);
      const openingElement = isFragment ? null : node.openingElement;
      const record = {
        id: `n${counter++}`,
        tag: isFragment ? 'Fragment' : jsxNameToString(openingElement.name),
        isFragment,
        isCustomComponent: !isFragment && /^[A-Z]/.test(jsxNameToString(openingElement.name).split('.')[0]),
        props: isFragment ? [] : attrsOf(openingElement, source),
        start: node.start,
        end: node.end,
        line: node.loc?.start.line ?? null,
        children: [],
        // Internal-only (never reaches serializeTree's stripped output):
        // the raw opening-element AST node, so attribute edits can use
        // exact AST offsets instead of re-deriving them with regexes.
        openingElementNode: openingElement,
      };
      byId.set(record.id, record);

      while (stack.length && stack[stack.length - 1].end <= node.start) stack.pop();

      const parent = stack[stack.length - 1];
      if (parent) parent.children.push(record);
      else roots.push(record);

      stack.push(record);
    },
  });

  return { roots, byId, ast };
}

/** Lightweight JSON-safe projection of parsePageTree's node records (drops
 * `start`/`end`/internal fields the frontend doesn't need, but keeps a
 * content hash so the client can detect the tree going stale). */
export function serializeTree(source) {
  const { roots } = parsePageTree(source);
  const strip = (n) => ({
    id: n.id,
    tag: n.tag,
    isFragment: n.isFragment,
    isCustomComponent: n.isCustomComponent,
    props: n.props,
    line: n.line,
    children: n.children.map(strip),
  });
  return {
    roots: roots.map(strip),
    contentHash: hashOf(source),
  };
}

export function hashOf(source) {
  return crypto.createHash('sha256').update(source).digest('hex');
}

/** The exact source snippet for one node (#52's read side) plus its parent
 * chain's tag names for breadcrumb display. */
export function getNodeSnippet(source, nodeId) {
  const { byId } = parsePageTree(source);
  const node = byId.get(nodeId);
  if (!node) throw new PagesEditorError(`No such node "${nodeId}" — the file may have changed; reload the tree.`, { status: 409 });
  return {
    nodeId,
    snippet: source.slice(node.start, node.end),
    contentHash: hashOf(source),
  };
}

/**
 * Patch one node's JSX back into the file (#52 — AST-located, textual
 * splice, not a whole-file AST reprint). We re-parse the *current* disk
 * content, re-locate the node by id, verify the caller's `contentHash`
 * still matches (optimistic-concurrency guard), verify the replacement
 * parses as a standalone JSX expression on its own, then splice
 * `source.slice(0, node.start) + newSnippet + source.slice(node.end)`.
 * Splicing the original text (rather than handing the whole file to a
 * generator) is what guarantees every *other* line in the file — imports,
 * comments, unrelated formatting — comes out byte-for-byte unchanged.
 */
export function patchNode(source, nodeId, newSnippet, expectedHash) {
  if (expectedHash && hashOf(source) !== expectedHash) {
    throw new PagesEditorError('The file changed on disk since this snippet was loaded — reload the tree and try again.', { status: 409 });
  }
  const { byId } = parsePageTree(source);
  const node = byId.get(nodeId);
  if (!node) throw new PagesEditorError(`No such node "${nodeId}" — the file may have changed; reload the tree.`, { status: 409 });

  let replacementAst;
  try {
    replacementAst = parse(`const __x__ = (\n${newSnippet}\n);`, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
  } catch (e) {
    throw new PagesEditorError(`Replacement snippet is not valid JSX: ${e.message}`);
  }
  const decl = replacementAst.program.body[0]?.declarations?.[0]?.init;
  if (!decl || !(t.isJSXElement(decl) || t.isJSXFragment(decl))) {
    throw new PagesEditorError('Replacement snippet must be a single JSX element or fragment.');
  }

  const patched = source.slice(0, node.start) + newSnippet.trim() + source.slice(node.end);

  // Sanity check: the patched file as a whole must still parse.
  try {
    parseSource(patched);
  } catch (e) {
    throw new PagesEditorError(`Patched file would no longer parse: ${e.message}`);
  }

  return patched;
}

/** #53 read-only helper: same shape as a tree node's `props`, for a single
 * node, plus the enclosing page component's own in-scope prop/state names
 * (used by #54's auto-mapper). */
export function getNodeProps(source, nodeId) {
  const { byId, ast } = parsePageTree(source);
  const node = byId.get(nodeId);
  if (!node) throw new PagesEditorError(`No such node "${nodeId}" — the file may have changed; reload the tree.`, { status: 409 });
  return { nodeId, tag: node.tag, props: node.props, scopeNames: collectComponentScopeNames(ast) };
}

/**
 * Update a single JSXAttribute's value on a node (#53's save path) by
 * textually replacing just that attribute (or appending a new one if it
 * doesn't exist yet) inside the node's opening tag, then delegating to the
 * same splice-based patchNode used by #52 so both go through one
 * mechanism (and one #56 enforcement gate).
 */
export function buildAttributeSnippet(source, nodeId, propName, kind, value) {
  const { byId } = parsePageTree(source);
  const node = byId.get(nodeId);
  if (!node) throw new PagesEditorError(`No such node "${nodeId}" — the file may have changed; reload the tree.`, { status: 409 });
  if (node.isFragment) throw new PagesEditorError('Fragments (<>...</>) have no props to edit.');

  const rendered = renderAttrValue(kind, value);
  const opening = node.openingElementNode;
  const existing = opening.attributes.find((a) => t.isJSXAttribute(a) && jsxNameToString(a.name) === propName);

  // Offsets below are relative to `node.start` (the whole element's start),
  // matching the slice of `source` we're rebuilding from — using the real
  // AST offsets (rather than re-deriving attribute boundaries with a
  // regex) is what makes this exact regardless of quoting/whitespace/
  // multi-line attribute values.
  if (existing) {
    return source.slice(node.start, existing.start) + propName + rendered + source.slice(existing.end, node.end);
  }
  // New attribute: insert right before the opening tag's closing `>` (or
  // `/>`), i.e. at the end of the existing attribute list — so repeated
  // auto-map insertions land in the order they were requested instead of
  // all piling up right after the tag name.
  const insertAt = opening.selfClosing ? opening.end - 2 : opening.end - 1;
  const needsSpace = !/\s$/.test(source.slice(insertAt - 1, insertAt));
  return source.slice(node.start, insertAt) + (needsSpace ? ' ' : '') + propName + rendered + source.slice(insertAt, node.end);
}

function renderAttrValue(kind, value) {
  if (kind === 'boolean' && value === true) return '';
  if (kind === 'boolean') return `={${value ? 'true' : 'false'}}`;
  if (kind === 'string') return `="${String(value).replaceAll('"', '&quot;')}"`;
  if (kind === 'number') return `={${Number(value)}}`;
  if (kind === 'identifier') return `={${value}}`;
  return `={${value}}`; // 'expression' — value is raw source text of the expression
}

/** In-scope names for #54's auto-mapper: the page component's own
 * destructured prop names plus any top-level `useState` binding names.
 * Deliberately single-file/heuristic (no cross-file type resolution of
 * what a child component *expects*) — see #54's decision-point comment on
 * the issue for the exact, scoped-down definition this implements. */
export function collectComponentScopeNames(ast) {
  const names = new Set();
  traverse(ast, {
    FunctionDeclaration(p) { collectFromParams(p.node.params, names); },
    ArrowFunctionExpression(p) { collectFromParams(p.node.params, names); },
    FunctionExpression(p) { collectFromParams(p.node.params, names); },
    VariableDeclarator(p) {
      const init = p.node.init;
      if (!t.isCallExpression(init) || !t.isArrayPattern(p.node.id)) return;
      const calleeName = t.isIdentifier(init.callee)
        ? init.callee.name
        : t.isMemberExpression(init.callee) && t.isIdentifier(init.callee.property)
          ? init.callee.property.name
          : null;
      if (calleeName !== 'useState') return;
      for (const el of p.node.id.elements) {
        if (t.isIdentifier(el)) names.add(el.name);
      }
    },
  });
  return [...names];
}

function collectFromParams(params, names) {
  for (const param of params) {
    if (t.isObjectPattern(param)) {
      for (const prop of param.properties) {
        if (t.isObjectProperty(prop) && t.isIdentifier(prop.value)) names.add(prop.value.name);
        else if (t.isRestElement(prop) && t.isIdentifier(prop.argument)) names.add(prop.argument.name);
      }
    } else if (t.isIdentifier(param)) {
      names.add(param.name);
    }
  }
}

const COMPONENT_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js'];

/** Resolve a relative import specifier (as written in a page file) to an
 * absolute file path, trying the specifier as-is, each of
 * COMPONENT_EXTENSIONS appended, and each extension under an `index.*`
 * inside it (for `./components` importing `./components/index.tsx`).
 * Returns null for bare/package specifiers (no cross-file resolution
 * attempted for node_modules) or anything that resolves outside `root`. */
function resolveImportSource(pageAbsPath, specifier, root) {
  if (!specifier.startsWith('.')) return null;
  const base = path.resolve(path.dirname(pageAbsPath), specifier);
  const candidates = path.extname(base)
    ? [base]
    : [...COMPONENT_EXTENSIONS.map((ext) => base + ext), ...COMPONENT_EXTENSIONS.map((ext) => path.join(base, 'index' + ext))];
  const rootResolved = path.resolve(root);
  const rootWithSep = rootResolved.endsWith(path.sep) ? rootResolved : rootResolved + path.sep;
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) continue;
    const resolved = path.resolve(candidate);
    if (resolved === rootResolved || resolved.startsWith(rootWithSep)) return resolved;
  }
  return null;
}

/** Find the function node backing a component export: for a named import,
 * a same-named FunctionDeclaration or `const Name = (...) => ...`
 * (top-level or inside `export ...`); for a default import, the default
 * export itself (function/arrow directly, or an identifier referencing a
 * locally-declared one). */
function findLocalFunction(body, name) {
  for (const node of body) {
    if (t.isFunctionDeclaration(node) && node.id?.name === name) return node;
    if (t.isVariableDeclaration(node)) {
      for (const d of node.declarations) {
        if (t.isIdentifier(d.id) && d.id.name === name && (t.isArrowFunctionExpression(d.init) || t.isFunctionExpression(d.init))) {
          return d.init;
        }
      }
    }
  }
  return null;
}

function findComponentFunction(ast, tagName, isDefault) {
  const body = ast.program.body;
  if (isDefault) {
    for (const node of body) {
      if (!t.isExportDefaultDeclaration(node)) continue;
      const decl = node.declaration;
      if (t.isFunctionDeclaration(decl) || t.isArrowFunctionExpression(decl) || t.isFunctionExpression(decl)) return decl;
      if (t.isIdentifier(decl)) return findLocalFunction(body, decl.name);
    }
    return null;
  }
  const direct = findLocalFunction(body, tagName);
  if (direct) return direct;
  // `export function Foo(...)` / `export const Foo = (...) => ...`: the
  // exported declaration is a single statement, not a top-level one, so
  // findLocalFunction (which iterates a statement list) is reused on a
  // one-element list wrapping it.
  for (const node of body) {
    if (t.isExportNamedDeclaration(node) && node.declaration) {
      const found = findLocalFunction([node.declaration], tagName);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Member names of a TS interface/type-literal alias named `typeName`,
 * declared anywhere in `source`, or `null` if it has an index signature
 * (open — can't enumerate) or isn't found.
 *
 * Built on the TypeScript compiler API's own parser (`ts.createSourceFile`)
 * rather than babel's TS AST support that the rest of this file otherwise
 * uses — per this repo's "prefer an established library over hand-rolled
 * logic" guidance, actual TS *type* syntax (interfaces/type aliases,
 * inherited members, generics) is TypeScript's own domain, and `typescript`
 * is already a project dependency (used the same way by src/prose.mjs) —
 * reusing its canonical, always-in-sync-with-the-language parser here beats
 * re-deriving the same TS-type-syntax node walk a second time by hand on
 * top of babel's parallel (and narrower) TS AST support. babel stays the
 * parser for everything else in this file (JS/JSX structure, destructuring)
 * since that's plain syntax with no type-system dimension to it.
 */
function findTypeMembers(source, typeName) {
  const sourceFile = ts.createSourceFile('child.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let result = null;
  const visit = (node) => {
    if (result) return;
    const isInterface = ts.isInterfaceDeclaration(node) && node.name.text === typeName;
    const isTypeLiteralAlias =
      ts.isTypeAliasDeclaration(node) && node.name.text === typeName && ts.isTypeLiteralNode(node.type);
    if (isInterface || isTypeLiteralAlias) {
      const members = isInterface ? node.members : node.type.members;
      if (members.some((m) => ts.isIndexSignatureDeclaration(m))) {
        result = { closed: false, names: new Set() };
      } else {
        const names = new Set();
        for (const m of members) {
          if (ts.isPropertySignature(m) && m.name && ts.isIdentifier(m.name)) names.add(m.name.text);
        }
        result = { closed: true, names };
      }
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return result;
}

/** The declared prop set for a component function's first parameter: an
 * object-destructuring pattern's own property names (the common case), or
 * — bonus, best-effort — a typed non-destructured `props: FooProps`
 * param's interface/type-literal members (via the TS compiler API — see
 * findTypeMembers above). Returns `null` (open/unknown, don't filter) when
 * neither shape is recognized. */
function declaredNamesFromFunction(fn, childSource) {
  const param = fn.params[0];
  if (!param) return { closed: true, names: new Set() };
  if (t.isObjectPattern(param)) {
    const names = new Set();
    for (const prop of param.properties) {
      if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) names.add(prop.key.name);
    }
    return { closed: true, names };
  }
  if (t.isIdentifier(param) && param.typeAnnotation && t.isTSTypeAnnotation(param.typeAnnotation)) {
    const typeRef = param.typeAnnotation.typeAnnotation;
    if (t.isTSTypeReference(typeRef) && t.isIdentifier(typeRef.typeName)) {
      const members = findTypeMembers(childSource, typeRef.typeName.name);
      if (members) return members;
    }
  }
  return null;
}

/**
 * #77 follow-up to #54 — resolve the child component actually rendered by
 * JSX tag `tagName` (via the page file's own import of it) and return its
 * declared prop names, so findUnmappedProps can filter candidates to ones
 * the child can actually use instead of every in-scope name. Returns null
 * when the child can't be resolved (bare/package import, dynamic tag, no
 * matching export) or its param shape isn't recognized — callers treat
 * null as "unknown, don't filter" (today's permissive behavior).
 */
export function resolveDeclaredPropNames(root, pageAbsPath, pageAst, tagName) {
  let importSource = null;
  let isDefault = false;
  for (const node of pageAst.program.body) {
    if (!t.isImportDeclaration(node)) continue;
    for (const spec of node.specifiers) {
      if (spec.local.name !== tagName) continue;
      importSource = node.source.value;
      isDefault = t.isImportDefaultSpecifier(spec);
    }
  }
  if (!importSource) return null;

  const childAbsPath = resolveImportSource(pageAbsPath, importSource, root);
  if (!childAbsPath) return null;

  let childSource;
  let childAst;
  try {
    childSource = fs.readFileSync(childAbsPath, 'utf8');
    childAst = parseSource(childSource);
  } catch {
    return null;
  }

  const fn = findComponentFunction(childAst, tagName, isDefault);
  if (!fn) return null;

  return declaredNamesFromFunction(fn, childSource);
}

/**
 * #54 — for a selected custom-component node, find scope names (parent
 * page's own props/state) that are NOT currently passed down to it as a
 * same-named attribute, and propose the shorthand `{name}` wiring for each.
 * #77 follow-up: when the child component's own declared props can be
 * resolved across files (see resolveDeclaredPropNames above), candidates
 * are further filtered to names the child actually declares — e.g. a
 * state setter like `setCount` is no longer offered for a child that
 * doesn't destructure a same-named prop. `root`/`pageAbsPath` are optional
 * so in-memory single-string callers (existing tests) keep working; omit
 * them to keep the old, fully permissive behavior.
 */
export function findUnmappedProps(source, nodeId, root, pageAbsPath) {
  const { byId, ast } = parsePageTree(source);
  const node = byId.get(nodeId);
  if (!node) throw new PagesEditorError(`No such node "${nodeId}" — the file may have changed; reload the tree.`, { status: 409 });
  if (!node.isCustomComponent) return { nodeId, candidates: [], childPropsResolved: false };

  const scopeNames = collectComponentScopeNames(ast);
  const currentNames = new Set(node.props.filter((p) => p.kind !== 'spread').map((p) => p.name));
  let candidates = scopeNames.filter((n) => !currentNames.has(n));

  let childPropsResolved = false;
  if (root && pageAbsPath) {
    const declared = resolveDeclaredPropNames(root, pageAbsPath, ast, node.tag.split('.')[0]);
    if (declared && declared.closed) {
      candidates = candidates.filter((n) => declared.names.has(n));
      childPropsResolved = true;
    }
  }
  return { nodeId, candidates, childPropsResolved };
}

export function applyAutoMap(source, nodeId, propNames) {
  let patched = source;
  let hash = hashOf(patched);
  for (const name of propNames) {
    const snippet = buildAttributeSnippet(patched, nodeId, name, 'identifier', name);
    patched = patchNode(patched, nodeId, snippet, hash);
    hash = hashOf(patched);
  }
  return patched;
}

/**
 * #56 — run the existing PAGE-* / COMPONENT-* architecture rules and the
 * separation-of-concerns rules against a prospective file, scoped to just
 * that one file, and surface any *error*-severity violation before it
 * lands (the caller writes `patched` to disk only if this returns
 * `ok: true`, and reverts otherwise — see server route below).
 */
export function checkEnforcement(root, relPath, patchedSource) {
  const absPath = path.join(root, relPath);
  const original = fs.readFileSync(absPath, 'utf8');
  fs.writeFileSync(absPath, patchedSource);
  try {
    const arch = validateArchitecture(root, { files: [relPath] });
    // soc-enforcer has no per-file filter, so run project-wide and keep
    // only violations attributed to this file — still exercised against
    // the *patched* content already written above.
    const soc = validateSeparationOfConcerns(root).violations.filter((v) => v.file === relPath);
    const violations = [...arch.violations.filter((v) => v.file === relPath), ...soc];
    const errors = violations.filter((v) => v.severity === 'error');
    return { ok: errors.length === 0, violations, errors };
  } finally {
    fs.writeFileSync(absPath, original);
  }
}
