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
import {
  parseJsxTree, findParentRecord, jsxParseError, checkJsxReplacement,
  spliceNode, setAttributeText, setSpreadText, removeAttributeText, removeNodeText, swapNodesText, addChildText,
  collectComponentScopeNames, findImportOfName, declaredPropNames,
} from '../../../src/ast/index.mjs';
import { buildScopeLinks, importOfTag } from '../../../src/engine/scopeLinks.mjs';
import { loadConfig } from '../../../src/config.mjs';
import { loadLayerGraph } from '../../../src/architecture-graph.mjs';
import { validateArchitecture } from '../../../src/architecture-enforcer.mjs';
import { validateSeparationOfConcerns } from '../../../src/soc-enforcer.mjs';
import { walk, rel } from '../../../src/fs.mjs';
import { matchGlob } from '../../../src/glob.mjs';

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
    if (!matchGlob(pattern, relFromRoot)) {
      throw new PagesEditorError(`"${relFromRoot}" is not classified as the "page" layer by this project's architecture.yml.`);
    }
  }
  return { absPath: resolved, relPath: relFromRoot };
}

// All JSX parsing/analysis/edit primitives live in the shared AST package (src/ast, typescript-estree).
// This module is the Pages Editor's glue: HTTP-facing error wording/statuses, the optimistic-concurrency
// hash guard, the #56 enforcement gate, and path scoping / cross-file import resolution.
function noSuchNode(nodeId) {
  return new PagesEditorError(`No such node "${nodeId}" — the file may have changed; reload the tree.`, { status: 409 });
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
  return parseJsxTree(source);
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

/**
 * Ticket F.1 (#120, epic #119) — parse a bare snippet's *own* text (not a
 * whole page file) into the same node tree shape serializeTree produces, so
 * the visual composer can derive its graph live from exactly the text
 * currently sitting in the snippet editor, with zero persisted metadata: no
 * `.flyde`-style side file, no cached JSON layout, just a fresh parse of
 * whatever text is passed in. Reuses parsePageTree/serializeTree completely
 * unchanged — a standalone JSX snippet (e.g. `<div><Foo/></div>`) is already
 * valid module source on its own (it parses as an ExpressionStatement
 * wrapping the JSXElement/JSXFragment), so no wrapping hack is needed.
 * Parse failures are expected transiently while the user is mid-edit (an
 * unclosed tag, etc.) — reported as `{roots: [], error}` rather than thrown,
 * so the canvas can just keep showing its last-good graph instead of
 * crashing on every keystroke.
 */
export function parseSnippetToTree(snippetSource) {
  if (typeof snippetSource !== 'string' || !snippetSource.trim()) return { roots: [], error: null };
  try {
    return { ...serializeTree(snippetSource), error: null };
  } catch (e) {
    return { roots: [], error: e.message };
  }
}

/** The exact source snippet for one node (#52's read side) plus its parent
 * chain's tag names for breadcrumb display. */
export function getNodeSnippet(source, nodeId) {
  const { byId } = parsePageTree(source);
  const node = byId.get(nodeId);
  if (!node) throw noSuchNode(nodeId);
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
  if (!node) throw noSuchNode(nodeId);

  const replacement = checkJsxReplacement(newSnippet);
  if (!replacement.ok && replacement.kind === 'parse') {
    throw new PagesEditorError(`Replacement snippet is not valid JSX: ${replacement.error}`);
  }
  if (!replacement.ok) throw new PagesEditorError('Replacement snippet must be a single JSX element or fragment.');

  const patched = spliceNode(source, node, newSnippet.trim());

  // Sanity check: the patched file as a whole must still parse.
  const patchedError = jsxParseError(patched);
  if (patchedError) throw new PagesEditorError(`Patched file would no longer parse: ${patchedError}`);

  return patched;
}

/** #53 read-only helper: same shape as a tree node's `props`, for a single
 * node, plus the enclosing page component's own in-scope prop/state names
 * (used by #54's auto-mapper). */
export function getNodeProps(source, nodeId) {
  const { byId, ast } = parsePageTree(source);
  const node = byId.get(nodeId);
  if (!node) throw noSuchNode(nodeId);
  return { nodeId, tag: node.tag, props: node.props, scopeNames: collectComponentScopeNames(ast) };
}

/**
 * Update a single JSXAttribute's value on a node (#53's save path) by
 * textually replacing just that attribute (or appending a new one if it
 * doesn't exist yet) inside the node's opening tag, then delegating to the
 * same splice-based patchNode used by #52 so both go through one
 * mechanism (and one #56 enforcement gate).
 *
 * #77 follow-up to #53 — a `kind === 'spread'` edit is a different shape
 * (`{...expr}`, no attribute name, no `=`) and has no name to look it up
 * by, so it takes its own branch keyed on `index` (its position in the
 * opening tag's attribute list, from the prop record's `index` field) instead of
 * going through the name lookup below. Only edits an
 * *existing* spread — this doesn't support inserting a brand new one.
 */
export function buildAttributeSnippet(source, nodeId, propName, kind, value, index) {
  const { byId } = parsePageTree(source);
  const node = byId.get(nodeId);
  if (!node) throw noSuchNode(nodeId);
  if (node.isFragment) throw new PagesEditorError('Fragments (<>...</>) have no props to edit.');

  if (kind === 'spread') {
    const text = setSpreadText(source, node, index, value);
    if (text === null) {
      throw new PagesEditorError('That spread prop is no longer at this position — the file may have changed; reload the tree.', { status: 409 });
    }
    return text;
  }
  return setAttributeText(source, node, propName, kind, value);
}

/**
 * Ticket F.2 (#121, epic #119) — remove one named attribute from a node's
 * opening tag, returning that node's whole replacement text (same "whole
 * node's new text" contract buildAttributeSnippet above already uses, so
 * patchNode splices it back the same way). Also consumes one
 * immediately-preceding whitespace run so the removal doesn't
 * leave a double space behind in the tag. Only for a named (non-spread)
 * attribute that currently exists.
 */
export function removeAttributeSnippet(source, nodeId, propName) {
  const { byId } = parsePageTree(source);
  const node = byId.get(nodeId);
  if (!node) throw noSuchNode(nodeId);
  if (node.isFragment) throw new PagesEditorError('Fragments (<>...</>) have no props to edit.');
  const text = removeAttributeText(source, node, propName);
  if (text === null) throw new PagesEditorError(`Node "${nodeId}" has no "${propName}" attribute to remove.`);
  return text;
}

/**
 * Ticket F.2 (#121, epic #119) — the visual composer's wire-rewrite: moves
 * an existing prop from one child to a different sibling under the same
 * parent, expressed as an unambiguous source-text edit (remove the
 * attribute from the old child, add the identical attribute — same kind
 * and value — to the new one), reusing removeAttributeSnippet/
 * buildAttributeSnippet/patchNode unchanged rather than a second splicing
 * mechanism. Operates purely on the snippet's own text (never a file) so
 * the result can be handed straight to the existing save-back-to-source +
 * diff-preview flow. Never throws — an invalid drag (stale ids, a
 * cross-parent target, a name collision on the target) comes back as
 * `{ok: false, error}` so the canvas can show a clear inline message and
 * leave the snippet untouched, per #119's "reject rather than write broken
 * code" instruction.
 */
export function rewireWireInSnippet(snippetSource, { parentId, propName, fromChildId, toChildId }) {
  let byId;
  try {
    byId = parsePageTree(snippetSource).byId;
  } catch (e) {
    return { ok: false, error: `Snippet does not parse: ${e.message}` };
  }
  const parent = byId.get(parentId);
  const fromChild = byId.get(fromChildId);
  const toChild = byId.get(toChildId);
  if (!parent || !fromChild || !toChild) {
    return { ok: false, error: "One of this wire's endpoints no longer exists — the snippet may have changed." };
  }
  if (fromChildId === toChildId) return { ok: false, error: 'Nothing to rewire — dropped back on the same node.' };
  const isSibling = (id) => parent.children.some((c) => c.id === id);
  if (!isSibling(fromChildId) || !isSibling(toChildId)) {
    return { ok: false, error: 'A wire can only be rewired to a sibling under the same parent.' };
  }
  const prop = fromChild.props.find((p) => p.kind !== 'spread' && p.name === propName);
  if (!prop) return { ok: false, error: `"${fromChildId}" no longer has a "${propName}" prop.` };
  if (toChild.props.some((p) => p.kind !== 'spread' && p.name === propName)) {
    return { ok: false, error: `"${toChildId}" already has its own "${propName}" prop — rewiring would overwrite it.` };
  }

  try {
    const removed = removeAttributeSnippet(snippetSource, fromChildId, propName);
    let patched = patchNode(snippetSource, fromChildId, removed);
    const added = buildAttributeSnippet(patched, toChildId, propName, prop.kind, prop.value);
    patched = patchNode(patched, toChildId, added);
    return { ok: true, snippet: patched };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Ticket F.3 (#122, epic #119) — remove a node (and its whole subtree) from
 * the snippet, expressed as a plain text-range deletion plus a small
 * whitespace cleanup (one run of leading indentation, one trailing newline)
 * so it doesn't leave a blank line behind. Rejects removing the snippet's
 * own single root — a snippet is always exactly one root element/fragment
 * (the same invariant patchNode's own save-time validation enforces), so
 * there is nothing left to save if the root itself were removed. Never
 * throws — `{ok:false, error}` on any rejection.
 */
export function removeNodeInSnippet(snippetSource, nodeId) {
  let roots, byId;
  try {
    ({ roots, byId } = parsePageTree(snippetSource));
  } catch (e) {
    return { ok: false, error: `Snippet does not parse: ${e.message}` };
  }
  const node = byId.get(nodeId);
  if (!node) return { ok: false, error: `No such node "${nodeId}" — the snippet may have changed.` };
  if (roots.some((r) => r.id === nodeId)) {
    return { ok: false, error: "The snippet's own root element can't be removed — it would leave nothing to save." };
  }
  const patched = removeNodeText(snippetSource, node);
  const patchedError = jsxParseError(patched);
  if (patchedError) return { ok: false, error: `Removing this node would leave invalid JSX: ${patchedError}` };
  return { ok: true, snippet: patched };
}

/**
 * Ticket F.3 (#122, epic #119) — move a node one position up/down among its
 * own siblings, expressed as swapping its text with the adjacent sibling's
 * (whatever sits between the two — other text/elements — stays exactly
 * where it is; only the two elements' own text spans trade places).
 * Rejects a root (no siblings to move among) or a node already at the
 * first/last position for the requested direction. Never throws.
 */
export function moveNodeInSnippet(snippetSource, nodeId, direction) {
  if (direction !== 'up' && direction !== 'down') return { ok: false, error: `Unknown move direction "${direction}".` };
  let byId;
  try {
    ({ byId } = parsePageTree(snippetSource));
  } catch (e) {
    return { ok: false, error: `Snippet does not parse: ${e.message}` };
  }
  const node = byId.get(nodeId);
  if (!node) return { ok: false, error: `No such node "${nodeId}" — the snippet may have changed.` };
  const parent = findParentRecord(byId, nodeId);
  if (!parent) return { ok: false, error: "The snippet's own root element has no siblings to move among." };
  const siblings = parent.children;
  const idx = siblings.findIndex((c) => c.id === nodeId);
  const otherIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (otherIdx < 0 || otherIdx >= siblings.length) {
    return { ok: false, error: `Already at the ${direction === 'up' ? 'first' : 'last'} position among its siblings.` };
  }
  const [a, b] = direction === 'up' ? [siblings[otherIdx], node] : [node, siblings[otherIdx]];
  const patched = swapNodesText(snippetSource, a, b);
  const patchedError = jsxParseError(patched);
  if (patchedError) return { ok: false, error: `Moving this node would leave invalid JSX: ${patchedError}` };
  return { ok: true, snippet: patched };
}

/**
 * Ticket F.3 (#122, epic #119) — append a new (fixed, deliberately minimal
 * — `<div />`) child right before a node's closing tag, reusing the
 * start/end offsets parsePageTree already computed (no second AST walk).
 * Only supported when the node already has an opening/closing tag pair or
 * is a fragment (`<Tag>...</Tag>` / `<>...</>`) — a self-closing element
 * (`<Tag />`) is rejected rather than the tool guessing how to split `/>`
 * into an open/close pair on the caller's behalf. Never throws.
 */
export function addChildInSnippet(snippetSource, parentId) {
  let byId;
  try {
    ({ byId } = parsePageTree(snippetSource));
  } catch (e) {
    return { ok: false, error: `Snippet does not parse: ${e.message}` };
  }
  const parent = byId.get(parentId);
  if (!parent) return { ok: false, error: `No such node "${parentId}" — the snippet may have changed.` };
  const added = addChildText(snippetSource, parent);
  if (!added.ok && added.reason === 'self-closing') {
    return { ok: false, error: 'This element is self-closing (`<Tag />`) — convert it to an open/close pair before adding a child.' };
  }
  if (!added.ok) return { ok: false, error: 'Could not determine where to insert a new child.' };
  const patchedError = jsxParseError(added.source);
  if (patchedError) return { ok: false, error: `Adding a child here would leave invalid JSX: ${patchedError}` };
  return { ok: true, snippet: added.source };
}

export { collectComponentScopeNames };

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

/**
 * #77 follow-up to #54 — resolve the child component actually rendered by
 * JSX tag `tagName` (via the page file's own import of it) and return its
 * declared prop names, so findUnmappedProps can filter candidates to ones
 * the child can actually use instead of every in-scope name. Returns null
 * when the child can't be resolved (bare/package import, dynamic tag, no
 * matching export) or its param shape isn't recognized — callers treat
 * null as "unknown, don't filter" (today's permissive behavior). The AST
 * work (import lookup, finding the component function, reading its declared
 * props) is src/ast's; this function only does the file resolution, scoped to `root`.
 */
export function resolveDeclaredPropNames(root, pageAbsPath, pageAst, tagName) {
  const imported = findImportOfName(pageAst, tagName);
  if (!imported) return null;

  const childAbsPath = resolveImportSource(pageAbsPath, imported.source, root);
  if (!childAbsPath) return null;

  let childSource;
  try {
    childSource = fs.readFileSync(childAbsPath, 'utf8');
  } catch {
    return null;
  }
  return declaredPropNames(childSource, tagName, imported.isDefault);
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
  if (!node) throw noSuchNode(nodeId);
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

/**
 * Scope/binding link graph for one element (#223): thin glue over the core `buildScopeLinks` block --
 * this only does the path-scoped cross-file lookup of the child component's source (bare/package
 * imports and anything outside `root` resolve to null, leaving `childProps` unknown).
 */
export function getScopeLinks(source, nodeId, root, pageAbsPath) {
  let childSource;
  const { byId } = parsePageTree(source);
  const node = byId.get(nodeId);
  if (!node) throw noSuchNode(nodeId);
  if (node.isCustomComponent && root && pageAbsPath) {
    const imported = importOfTag(source, node.tag);
    const childAbs = imported ? resolveImportSource(pageAbsPath, imported.source, root) : null;
    if (childAbs) {
      try {
        childSource = fs.readFileSync(childAbs, 'utf8');
      } catch {
        childSource = undefined;
      }
    }
  }
  return buildScopeLinks(source, nodeId, { childSource });
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
