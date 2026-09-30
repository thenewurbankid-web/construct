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
  parseJsx, parseJsxTree, findParentRecord, jsxParseError, checkJsxReplacement,
  spliceNode, setAttributeText, setSpreadText, removeAttributeText, removeNodeText, swapNodesText, addChildText,
  collectComponentScopeNames, findImportOfName, declaredPropNames, insertNamedImport, insertStatementBeforeJsx,
} from '../ast/index.mjs';
import { buildScopeLinks, importOfTag, providerHookImports } from './scopeLinks.mjs';
import { describeComponent } from './describeComponent.mjs';
import { buildWrapSuggestions, findWrapHit, describeWrapHit } from './palette.mjs';
import { loadConfig } from '../core/config.mjs';
import { loadLayerGraph } from '../core/architecture-graph.mjs';
import { validateArchitecture } from '../core/architecture-enforcer.mjs';
import { validateSeparationOfConcerns } from '../core/soc-enforcer.mjs';
import { extractExpression } from '../core/extractExpression.mjs';
import { ConstructError } from '../core/diagnostics.mjs';
import { walk, rel, isInside } from '../core/fs.mjs';
import { matchGlob } from '../core/glob.mjs';

const JSX_EXTENSIONS = new Set(['.jsx', '.tsx', '.js', '.ts']);

/** An HTTP-facing error from one of the Pages Editor's own operations (the #56 scope guard, the
 * #590 content-hash guard, a missing node/file, an enforcement rejection, ...): carries the
 * response `status` to send, an optional `violations` list (#56 architecture/SoC failures) and an
 * optional machine-readable `code` (e.g. `HASH_REQUIRED`, `CHANGED_ON_DISK`) callers branch on. */
export class PagesEditorError extends Error {
  /**
   * @param {string} message Human-readable error message.
   * @param {{status?: number, violations?: object[], code?: string}} [options] `status` defaults to
   *   400; `violations` is the #56 enforcement violation list when this rejects a save; `code` is a
   *   short machine-readable reason (e.g. `HASH_REQUIRED`, `CHANGED_ON_DISK`) for client branching.
   */
  constructor(message, { status = 400, violations, code } = {}) {
    super(message);
    this.status = status;
    this.violations = violations;
    this.code = code;
  }
}

/**
 * The configured features-root directory name for a project (e.g. `"features"`), from
 * `construct.config`'s `features.root`, defaulting to `"features"` when unset.
 * @param {string} root Project root.
 * @returns {string} The features-root directory name, relative to `root`.
 */
export function featuresRootOf(root) {
  return loadConfig(root).features?.root || 'features';
}

/**
 * Every feature directory under the configured features root.
 * @param {string} root Project root.
 * @returns {string[]} Feature directory names, sorted; `[]` when the features root doesn't exist.
 */
export function listFeatures(root) {
  const base = path.join(root, featuresRootOf(root));
  if (!fs.existsSync(base)) return [];
  return fs
    .readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

/**
 * Every file under features/<feature>/pages/**, relative to that pages/
 * folder (e.g. "Home.jsx", "billing/Detail.tsx").
 * @param {string} root Project root.
 * @param {string} feature Feature directory name.
 * @returns {string[]} Page file paths relative to that feature's pages/ folder, sorted; `[]` when
 *   the feature has no pages/ folder.
 */
export function listPages(root, feature) {
  const featuresRoot = featuresRootOf(root);
  const pagesDir = path.join(root, featuresRoot, feature, 'pages');
  if (!fs.existsSync(pagesDir)) return [];
  return walk(pagesDir)
    .filter((p) => JSX_EXTENSIONS.has(path.extname(p)))
    .map((p) => rel(pagesDir, p))
    .sort();
}

/**
 * Every page of the project, `[{ feature, file }]`: what the Browser lists on the Pages screen (#431). Only names
 * the client may later send back to the per-feature routes, each of which re-checks it with resolvePageFile.
 * @param {string} root Project root.
 * @returns {{feature:string, file:string}[]} Every page, across every feature.
 */
export function listAllPages(root) {
  return listFeatures(root).flatMap((feature) => listPages(root, feature).map((file) => ({ feature, file })));
}

/** Resolve + validate a (feature, file) pair to an absolute path strictly
 * inside that feature's pages/ folder. Throws PagesEditorError (#56 scope
 * guard) on any attempt to escape it — a `..` segment, an absolute file
 * path, a symlink-free resolution that lands outside pages/, or a
 * feature/file that simply doesn't exist.
 * @param {string} root Project root.
 * @param {string} feature Feature directory name.
 * @param {string} file Page file path relative to that feature's pages/ folder, as sent by the client.
 * @returns {{absPath:string, relPath:string}} The resolved absolute path and its path relative to `root`.
 */
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
  // #365: a symlink inside pages/ (say, from a cloned repository) must not lead out of the project, and so out of
  // the workspace: the REAL path has to stay inside the project root, for reads and for the write-back alike.
  if (!realInside(root, resolved)) {
    throw new PagesEditorError(`"${file}" resolves outside the project.`);
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
 * #590 — the one hash guard every Pages-editor write that lands on disk goes through, the same
 * contract `componentSave` (componentsApi.mjs) already enforces for the Components screen: a hash
 * that's missing, empty or not a string is a distinct 400 `HASH_REQUIRED` (the client never fetched,
 * or forgot to resend, the hash it loaded the file against — a client bug, never routine) from a
 * present-but-wrong hash's 409 `CHANGED_ON_DISK` (someone else's edit landed on disk first — routine,
 * "reload and try again"). Never optional: a save endpoint that skips this on a falsy hash is exactly
 * #590's bug (a client that omits the hash silently wins over whatever is on disk).
 * @param {string} source Current on-disk file content to hash and compare against.
 * @param {string} contentHash The hash the caller loaded the file against (from a prior read).
 * @param {{mismatchMessage?: string}} [options] `mismatchMessage` overrides the 409 message used
 *   when a present hash doesn't match the current content.
 * @throws {PagesEditorError} 400 `HASH_REQUIRED` when `contentHash` is missing/empty; 409
 *   `CHANGED_ON_DISK` when it doesn't match `source`'s current hash.
 */
export function assertContentHash(
  source,
  contentHash,
  { mismatchMessage = 'The file changed on disk since this was loaded — reload the tree and try again.' } = {},
) {
  if (typeof contentHash !== 'string' || contentHash === '') {
    throw new PagesEditorError('contentHash is required to save — reload the tree and try again.', { status: 400, code: 'HASH_REQUIRED' });
  }
  if (hashOf(source) !== contentHash) {
    throw new PagesEditorError(mismatchMessage, { status: 409, code: 'CHANGED_ON_DISK' });
  }
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
 * @param {string} source Page file's full JSX/TSX source text.
 * @returns {{roots:object[], byId:Map<string,object>, ast:object}} The navigable node tree.
 */
export function parsePageTree(source) {
  return parseJsxTree(source);
}

/**
 * Lightweight JSON-safe projection of parsePageTree's node records (drops
 * `start`/`end`/internal fields the frontend doesn't need, but keeps a
 * content hash so the client can detect the tree going stale).
 * @param {string} source Page file's full JSX/TSX source text.
 * @returns {{roots:object[], contentHash:string}} The stripped-down tree the client renders, plus
 *   `source`'s content hash.
 */
export function serializeTree(source) {
  const { roots } = parsePageTree(source);
  const strip = (n) => ({
    id: n.id,
    tag: n.tag,
    isFragment: n.isFragment,
    isCustomComponent: n.isCustomComponent,
    props: n.props,
    line: n.line,
    column: n.column,
    children: n.children.map(strip),
  });
  return {
    roots: roots.map(strip),
    contentHash: hashOf(source),
  };
}

/**
 * The sha256 content hash of a file's source text, used as the Pages Editor's optimistic-concurrency
 * token (#590): the client resends the hash it last loaded, and every mutating endpoint rejects a
 * save whose hash no longer matches the current on-disk content.
 * @param {string} source File content to hash.
 * @returns {string} The hex-encoded sha256 digest.
 */
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
 * @param {string} snippetSource The snippet's own current source text (not a whole page file).
 * @returns {{roots:object[], contentHash?:string, error:string|null}} The parsed tree (same shape
 *   as serializeTree) plus a null `error`, or `{roots: [], error}` when it doesn't currently parse
 *   or is blank.
 */
export function parseSnippetToTree(snippetSource) {
  if (typeof snippetSource !== 'string' || !snippetSource.trim()) return { roots: [], error: null };
  try {
    return { ...serializeTree(snippetSource), error: null };
  } catch (e) {
    return { roots: [], error: e.message };
  }
}

/**
 * The exact source snippet for one node (#52's read side) plus its parent
 * chain's tag names for breadcrumb display.
 * @param {string} source Page file's full source text.
 * @param {string} nodeId Id of the node to read (from a prior parsePageTree/serializeTree call).
 * @returns {{nodeId:string, snippet:string, contentHash:string}} The node's own source text and
 *   `source`'s content hash.
 * @throws {PagesEditorError} 409 when `nodeId` doesn't exist in `source`.
 */
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
 * The actual AST-located, textual splice (#52) — re-locate the node by id, verify the replacement
 * parses as a standalone JSX expression on its own, then splice
 * `source.slice(0, node.start) + newSnippet + source.slice(node.end)`. Splicing the original text
 * (rather than handing the whole file to a generator) is what guarantees every *other* line in the
 * file — imports, comments, unrelated formatting — comes out byte-for-byte unchanged. No hash check
 * here: this is the primitive `patchNode` (disk-backed, hash-required) and `rewireWireInSnippet`
 * (in-memory snippet text with no disk/hash of its own) both build on.
 */
function spliceNodeText(source, nodeId, newSnippet) {
  const { byId } = parsePageTree(source);
  const node = byId.get(nodeId);
  if (!node) throw noSuchNode(nodeId);

  const replacement = checkJsxReplacement(newSnippet);
  // Explicit `=== false` (rather than `!replacement.ok`): with this repo's tsconfig
  // (strictNullChecks off), tsc only narrows this discriminated union on an equality check against
  // the discriminant, not on its truthiness (#788's checkJs narrowing gotcha; #815).
  if (replacement.ok === false && replacement.kind === 'parse') {
    throw new PagesEditorError(`Replacement snippet is not valid JSX: ${replacement.error}`);
  }
  if (replacement.ok === false) throw new PagesEditorError('Replacement snippet must be a single JSX element or fragment.');

  const patched = spliceNode(source, node, newSnippet.trim());

  // Sanity check: the patched file as a whole must still parse.
  const patchedError = jsxParseError(patched);
  if (patchedError) throw new PagesEditorError(`Patched file would no longer parse: ${patchedError}`);

  return patched;
}

/**
 * Patch one node's JSX back into the file (#52). We re-parse the *current* disk content, require the
 * caller's `contentHash` to match it (#590's `assertContentHash` guard — missing is 400
 * `HASH_REQUIRED`, stale is 409 `CHANGED_ON_DISK`, so a client that omits or forgets to refresh its
 * hash can never silently clobber a concurrent edit), then delegate the actual splice to
 * `spliceNodeText`.
 * @param {string} source Current disk content of the page file.
 * @param {string} nodeId Id of the node to replace.
 * @param {string} newSnippet Replacement JSX text for that node (one element or fragment).
 * @param {string} expectedHash The content hash the caller loaded `source` against.
 * @returns {string} The patched full page source.
 * @throws {PagesEditorError} 400/409 from the hash guard, 409 if `nodeId` no longer exists, or 400
 *   if `newSnippet` isn't valid JSX / leaves the file unparseable.
 */
export function patchNode(source, nodeId, newSnippet, expectedHash) {
  assertContentHash(source, expectedHash, { mismatchMessage: 'The file changed on disk since this snippet was loaded — reload the tree and try again.' });
  return spliceNodeText(source, nodeId, newSnippet);
}

/**
 * #53 read-only helper: same shape as a tree node's `props`, for a single
 * node, plus the enclosing page component's own in-scope prop/state names
 * (used by #54's auto-mapper).
 * @param {string} source Page file's full source text.
 * @param {string} nodeId Id of the node to read.
 * @returns {{nodeId:string, tag:string, props:object[], scopeNames:string[]}} The node's tag/props
 *   plus the enclosing component's in-scope prop/state names.
 * @throws {PagesEditorError} 409 when `nodeId` doesn't exist in `source`.
 */
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
 * @param {string} source Page file's full source text.
 * @param {string} nodeId Id of the node whose opening tag is edited.
 * @param {string|null} propName The attribute's name, or `null` for a `kind === 'spread'` edit.
 * @param {'spread'|'string'|'number'|'boolean'|'identifier'|'expression'} kind The prop's value
 *   kind, as recorded on the node's `props` entries; `'spread'` takes the `index` branch below,
 *   every other kind is passed straight through to setAttributeText.
 * @param {string|number|boolean} value The new attribute value (rendered by setAttributeText/setSpreadText).
 * @param {number} [index] Position of the spread among the tag's attributes (only for `kind === 'spread'`).
 * @returns {string} The node's whole new opening-tag-through-node text, ready for patchNode to splice in.
 * @throws {PagesEditorError} 409 when `nodeId`/the targeted spread no longer exists, or the node is a fragment.
 */
export function buildAttributeSnippet(source, nodeId, propName, kind, value, index) {
  const { byId } = parsePageTree(source);
  const node = byId.get(nodeId);
  if (!node) throw noSuchNode(nodeId);
  if (node.isFragment) throw new PagesEditorError('Fragments (<>...</>) have no props to edit.');

  if (kind === 'spread') {
    // A spread's value is always its argument's source text (jsxAttributes' 'spread' record shape) --
    // never the number/boolean setAttributeText also accepts for a plain attribute.
    const text = setSpreadText(source, node, index, /** @type {string} */ (value));
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
 * @param {string} source Page file's full source text.
 * @param {string} nodeId Id of the node whose opening tag is edited.
 * @param {string} propName Name of the attribute to remove.
 * @returns {string} The node's whole new text with that attribute removed.
 * @throws {PagesEditorError} 409 when `nodeId` doesn't exist or the node is a fragment; a plain
 *   error when `propName` isn't currently on the node.
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
 * @param {string} snippetSource The snippet's own current source text.
 * @param {{parentId:string, propName:string, fromChildId:string, toChildId:string}} wire The common
 *   parent, the prop being moved, and the sibling ids it moves from/to.
 * @returns {{ok:true, snippet:string}|{ok:false, error:string}} The rewired snippet text, or why the
 *   rewire was rejected.
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
    let patched = spliceNodeText(snippetSource, fromChildId, removed);
    const added = buildAttributeSnippet(patched, toChildId, propName, prop.kind, prop.value);
    patched = spliceNodeText(patched, toChildId, added);
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
 * @param {string} snippetSource The snippet's own current source text.
 * @param {string} nodeId Id of the node (and subtree) to remove.
 * @returns {{ok:true, snippet:string}|{ok:false, error:string}} The snippet with that node removed,
 *   or why the removal was rejected.
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
 * @param {string} snippetSource The snippet's own current source text.
 * @param {string} nodeId Id of the node to move.
 * @param {'up'|'down'} direction Which way to move it among its siblings.
 * @returns {{ok:true, snippet:string}|{ok:false, error:string}} The snippet with the node moved, or
 *   why the move was rejected.
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
 * @param {string} snippetSource The snippet's own current source text.
 * @param {string} parentId Id of the node to append a new child into.
 * @returns {{ok:true, snippet:string}|{ok:false, error:string}} The snippet with a new `<div />`
 *   child appended, or why it couldn't be added.
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
  // Explicit `=== false` (rather than `!added.ok`): see spliceNodeText's note on this tsconfig's
  // narrowing (strictNullChecks off) not applying to truthiness checks on a discriminated union.
  if (added.ok === false && added.reason === 'self-closing') {
    return { ok: false, error: 'This element is self-closing (`<Tag />`) — convert it to an open/close pair before adding a child.' };
  }
  if (added.ok === false) return { ok: false, error: 'Could not determine where to insert a new child.' };
  const patchedError = jsxParseError(added.source);
  if (patchedError) return { ok: false, error: `Adding a child here would leave invalid JSX: ${patchedError}` };
  return { ok: true, snippet: added.source };
}

export { collectComponentScopeNames };

const COMPONENT_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js'];

/** #365: true when `file`'s REAL path (symlinks followed) is inside `root`'s real path. False on any error. */
function realInside(root, file) {
  try {
    return isInside(fs.realpathSync.native(root), fs.realpathSync.native(file));
  } catch {
    return false;
  }
}

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
    // #365: judged on the REAL path too, so a symlinked component cannot lead out of the project (and so the workspace).
    if ((resolved === rootResolved || resolved.startsWith(rootWithSep)) && realInside(rootResolved, resolved)) return resolved;
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
 * @param {string} root Project root.
 * @param {string} pageAbsPath Absolute path of the page file `tagName` is rendered in.
 * @param {object} pageAst The page's already-parsed AST (from parsePageTree).
 * @param {string} tagName The JSX tag name to resolve (the rendered custom component).
 * @returns {object|null} `{closed, names, types}` (see declaredPropNames), or `null` when the child
 *   can't be resolved or its prop shape isn't recognized.
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
 * @param {string} source Page file's full source text.
 * @param {string} nodeId Id of the selected custom-component node.
 * @param {string} [root] Project root, so the child's declared props can be resolved across files.
 * @param {string} [pageAbsPath] Absolute path of `source`'s own file (paired with `root`).
 * @returns {{nodeId:string, candidates:string[], childPropsResolved:boolean}} Unmapped in-scope
 *   names to offer, and whether they were filtered to the child's own declared props.
 * @throws {PagesEditorError} 409 when `nodeId` doesn't exist in `source`.
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
 * #529 -- every Provider hook reachable from the page's own top-level imports (`providerHookImports`,
 * the exact detection `buildScopeLinks` already uses internally -- reused, not re-derived a third
 * time), each resolved across the import to that hook's own file the same way `childSource` already
 * resolves a rendered child component's file, keyed by import specifier so `buildScopeLinks`'s
 * `providerSources` lookup (`providerSources?.[source] ?? providerSources?.[hookName]`) finds it. An
 * import that doesn't resolve to a real in-project file (bare/package import, missing file) is simply
 * left out -- same "unresolved -> no scope added" contract `childSource` already has.
 * @param {string} source Page file's full source text.
 * @param {string} root Project root.
 * @param {string} pageAbsPath Absolute path of the page file `source` came from.
 * @returns {Record<string,string>|undefined} Provider hook import specifier -> that hook's own file
 *   source, for every one that resolves; `undefined` when none do (or `source` doesn't parse).
 */
function resolveProviderSources(source, root, pageAbsPath) {
  let ast;
  try {
    ast = parseJsx(source);
  } catch {
    return undefined;
  }
  /** @type {Record<string,string>} */
  const entries = {};
  for (const { source: specifier } of providerHookImports(ast)) {
    if (entries[specifier] !== undefined) continue;
    const abs = resolveImportSource(pageAbsPath, specifier, root);
    if (!abs) continue;
    try {
      entries[specifier] = fs.readFileSync(abs, 'utf8');
    } catch {
      // leave unresolved -- same contract as childSource's own read failure above
    }
  }
  return Object.keys(entries).length ? entries : undefined;
}

/**
 * Scope/binding link graph for one element (#223): thin glue over the core `buildScopeLinks` block --
 * the path-scoped cross-file lookup of the child component's source (bare/package imports and
 * anything outside `root` resolve to null, leaving `childProps` unknown) plus, independently of which
 * element is selected, every reachable Provider hook's own source (#529, `resolveProviderSources`
 * above) so the 'provider' scope kind (#528) is populated for real Cockpit pages.
 * @param {string} source Page file's full source text.
 * @param {string} nodeId Id of the selected node.
 * @param {string} [root] Project root, so child/provider sources can be resolved across files.
 * @param {string} [pageAbsPath] Absolute path of `source`'s own file (paired with `root`).
 * @returns {object} The scope/binding link graph (see buildScopeLinks).
 * @throws {PagesEditorError} 409 when `nodeId` doesn't exist in `source`.
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
  const providerSources = root && pageAbsPath ? resolveProviderSources(source, root, pageAbsPath) : undefined;
  return buildScopeLinks(source, nodeId, { childSource, providerSources });
}

/**
 * #54's write side: apply a batch of accepted auto-map suggestions to one node, wiring each
 * `propName` as the shorthand `{propName}` identifier attribute, one patchNode splice at a time (the
 * content hash is re-taken after each patch so the next splice targets the just-patched text).
 * @param {string} source Page file's full source text.
 * @param {string} nodeId Id of the node to add the props to.
 * @param {string[]} propNames The in-scope names to wire as same-named `{name}` attributes.
 * @returns {string} The patched full page source with every prop applied.
 */
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
 * #532 (Slice 2 of #518's design, docs/design/block-palette.md) -- the import specifier for one
 * Palette entry (#527's buildPalette output), relative to the page it is being inserted into.
 * Own-feature (`entry.via` is null): relative to the unit's own real file, exactly the shape a
 * hand-written same-feature import already takes (e.g. `../hooks/useCartProvider`). Cross-feature
 * (`entry.via` is set): relative to that OTHER feature's public `index.ts` ONLY, never its internals
 * -- reaching into `entry.path` directly would trip SLICE-002 ("Cross-feature imports use public
 * index.ts"), the same rule `checkEnforcement` below would then block the save on anyway.
 */
function paletteImportSpecifier(root, pageAbsPath, entry) {
  const featuresRoot = featuresRootOf(root);
  const targetAbs = entry.via ? path.join(root, featuresRoot, entry.feature, 'index.ts') : path.join(root, entry.path);
  let specifier = path.relative(path.dirname(pageAbsPath), targetAbs).split(path.sep).join('/');
  specifier = specifier.replace(/\.(tsx|ts|jsx|js)$/, '');
  return specifier.startsWith('.') ? specifier : `./${specifier}`;
}

/** A stub value for one required prop, from its describeComponent-reported `type` text (real
 * react-docgen output, not invented): a bare guess by TYPE SHAPE only (never a value pretending to be
 * meaningful project data) so the inserted JSX always parses and type-checks against a `string`,
 * `number`, `boolean`, array, object or function-shaped prop -- anything else stays `undefined`,
 * which is honest about not knowing more. */
function stubAttrText(prop) {
  const t = String(prop.type || '');
  const lower = t.toLowerCase();
  if (/=>/.test(t)) return `${prop.name}={() => {}}`;
  if (lower === 'string') return `${prop.name}=""`;
  if (lower === 'number') return `${prop.name}={0}`;
  if (lower === 'bool' || lower === 'boolean') return `${prop.name}={false}`;
  if (lower.endsWith('[]') || lower.startsWith('array')) return `${prop.name}={[]}`;
  if (t.startsWith('{') || lower === 'object' || lower === 'shape') return `${prop.name}={{}}`;
  return `${prop.name}={undefined}`;
}

/**
 * A self-closing JSX usage for a Component entry, its required props stubbed from `described`
 * (describeComponent's real react-docgen result) -- optional props are left out entirely rather than
 * guessed. `described` may be null/failed (a component that couldn't be documented): the usage then
 * has no props at all, same as any component with none.
 * @param {string} name The component's exported name.
 * @param {object|null} described describeComponent's result for the file it's exported from, or null.
 * @returns {string} A self-closing JSX usage, e.g. `<Foo bar="" />` or `<Foo />`.
 */
export function buildComponentUsageJsx(name, described) {
  const comp = described?.components?.find((c) => c.name === name) || described?.components?.[0];
  const attrs = (comp?.props || []).filter((p) => p.required).map(stubAttrText);
  return attrs.length ? `<${name} ${attrs.join(' ')} />` : `<${name} />`;
}

/**
 * A Provider hook-call statement for a Provider entry. Assigns the WHOLE result to a local variable
 * rather than destructuring named fields: `useProvider()`'s return shape (`Value`) isn't statically
 * known here (no type-checker run for this), so guessing field names would risk inserting code that
 * doesn't compile -- calling the hook and letting the developer destructure by hand is the honest
 * "real, working reference" this slice promises, not a fabricated shape.
 * @param {string} name The Provider hook's exported name (e.g. `useCartProvider`).
 * @returns {string} A statement calling it, e.g. `const cart = useCartProvider();`.
 */
export function buildProviderUsageStatement(name) {
  const base = name.replace(/^use/, '').replace(/Provider$/, '');
  const varName = base ? base[0].toLowerCase() + base.slice(1) : 'value';
  return `const ${varName} = ${name}();`;
}

/**
 * @param {string} patched Candidate new full source, after an import/JSX/statement insertion.
 * @returns {{ok:true, source:string}|{ok:false, error:string}} `patched` itself when it still
 *   parses, or why it doesn't.
 */
function finalizeInsertion(patched) {
  const patchedError = jsxParseError(patched);
  if (patchedError) return { ok: false, error: `Inserting this would leave invalid code: ${patchedError}` };
  return { ok: true, source: patched };
}

/**
 * #532 (Slice 2 of #518's design) -- insert one Palette entry's real usage into a page: the import
 * (skipped if already present; rejected if the name is already imported from somewhere ELSE) plus
 * either a self-closing JSX usage (Component, appended as the last child of the page's own root JSX
 * element/fragment) or a hook-call statement (Provider, inserted as the first statement of that
 * root's enclosing component function). No selection UI needed (block-palette.md section 4's Slice 2
 * note): unlike "Wrap with..." (Slice 3, #517), a brand-new usage doesn't need to target existing
 * JSX -- there is exactly one sensible place to add it. `entry` must be one of `buildPalette`'s own
 * `providers`/`components` entries (the caller re-derives it from a fresh `buildPalette` call rather
 * than trusting whatever the client sent, the same "never resolve a client-named path directly"
 * discipline `componentsApi.mjs`'s `pick()` uses) plus a `kind`.
 * @param {string} root Project root.
 * @param {string} pageAbsPath Absolute path of the page file to insert into.
 * @param {string} source The page file's full current source text.
 * @param {{kind:'component'|'provider', name:string, path?:string, via?:string, feature?:string}} entry
 *   The Palette entry to insert (one of buildPalette's own `components`/`providers` entries).
 * @param {Function} [describe] describeComponent, injectable for tests.
 * @returns {Promise<{ok:true, source:string}|{ok:false, error:string}>} The page source with the
 *   usage inserted, or why it was rejected.
 */
export async function buildPaletteInsertion(root, pageAbsPath, source, entry, describe = describeComponent) {
  if (!entry || (entry.kind !== 'component' && entry.kind !== 'provider')) {
    return { ok: false, error: 'Only Components and Providers can be inserted here (Expressions are Slice 3, "Wrap with...").' };
  }
  const { roots, ast } = parsePageTree(source);
  if (roots.length === 0) return { ok: false, error: 'This page has no JSX to insert into.' };

  const specifier = paletteImportSpecifier(root, pageAbsPath, entry);
  const existingImport = findImportOfName(ast, entry.name);
  if (existingImport && existingImport.source !== specifier) {
    return { ok: false, error: `"${entry.name}" is already imported from "${existingImport.source}" — rename or remove that import first.` };
  }

  let usageText;
  if (entry.kind === 'component') {
    const described = await describe(root, entry.path);
    usageText = buildComponentUsageJsx(entry.name, described.ok !== false ? described : null);
  } else {
    usageText = buildProviderUsageStatement(entry.name);
  }

  const { source: withImport } = insertNamedImport(source, { name: entry.name, specifier });
  const after = parsePageTree(withImport);
  const targetRoot = after.roots[0];

  if (entry.kind === 'component') {
    const added = addChildText(withImport, targetRoot, usageText);
    // Explicit `=== false` (rather than `!added.ok`): see spliceNodeText's note on this tsconfig's
    // narrowing (strictNullChecks off) not applying to truthiness checks on a discriminated union.
    if (added.ok === false) {
      return {
        ok: false,
        error:
          added.reason === 'self-closing'
            ? "This page's own root element is self-closing (`<Tag />`) — convert it to an open/close pair before inserting here."
            : "Could not find where to insert this component in the page's JSX.",
      };
    }
    return finalizeInsertion(added.source);
  }

  const inserted = insertStatementBeforeJsx(withImport, after.ast, targetRoot, usageText);
  if (!inserted.ok) {
    return { ok: false, error: "Could not find this page's own component function to add the Provider hook call to." };
  }
  return finalizeInsertion(inserted.source);
}

// A ConstructError message this specific -- extractExpression.mjs's own wording when a name can't be
// derived from the flagged shape ("pass --name <Name>") -- is the one usage error that means "ask the
// user for a name", not "something is actually wrong"; every other ConstructError from a dry run
// (a rejected generic name, a stale/unmatched range) is a real, show-worthy error instead.
const NAME_REQUIRED_RE = /pass --name/;

/**
 * #533 (Slice 3 of #518's design, docs/design/block-palette.md section 3) -- everything the Palette
 * tab's "Wrap with..." flow needs for one JSX selection: which flagged PAGE-008 conditional/loop (if
 * any) encloses it, every Expression in scope annotated with its structural fit
 * (packages/engine/palette.mjs's buildWrapSuggestions), the name that would be used (derived, or
 * `name` once given), and -- only when `includeFiles` is true -- a real dry-run preview of exactly
 * what `construct refactor extract-expression` (packages/core/extractExpression.mjs, #517) would
 * write. `dryRun: true` throughout: nothing here ever touches disk. `includeFiles` defaults to
 * false so the automatic "you selected something" suggestion (fired the moment a selection lands,
 * per design section 3 step 1-2) never itself renders a diff -- only the explicit "Wrap with..."
 * click (design section 3 step 4) asks for one, keeping "Suggest" and "Confirm" two distinct,
 * separately-observable steps exactly as the design's own step numbering has them.
 *
 * @param {string} root Project root.
 * @param {string} absPath Absolute path of the page/component file the selection is in.
 * @param {string} source That file's full current source text.
 * @param {string} nodeId Id of the selected node.
 * @param {{expressions: object[]}} palette A fresh `buildPalette(...)` result for this feature
 *   (only its `expressions` entries are used here).
 * @param {string} [name] Caller-supplied Expression name override.
 * @param {{includeFiles?: boolean}} [options] `includeFiles` also computes the real dry-run diff preview.
 * @returns {{ok:true, hit:object|null, suggestions:object[], name:string|null, nameRequired:boolean,
 *   nameError:string|null, files:{file:string,name:string|null,before:string,after:string}[]|null}}
 */
export function buildWrapSuggestion(root, absPath, source, nodeId, palette, name, { includeFiles = false } = {}) {
  const { byId } = parsePageTree(source);
  const node = byId.get(nodeId);
  if (!node) throw noSuchNode(nodeId);

  const { hit, suggestions } = buildWrapSuggestions(root, source, [node.start, node.end], palette);
  if (!hit) return { ok: true, hit: null, suggestions: [], name: null, nameRequired: false, nameError: null, files: null };

  try {
    const result = extractExpression(root, absPath, { range: hit.range, name: name || undefined, dryRun: true });
    const files = includeFiles
      ? [
          { file: result.page.file, name: null, before: source, after: result.preview[result.page.file] },
          { file: result.expression.file, name: result.expression.name, before: '', after: result.preview[result.expression.file] },
          ...result.components.map((c) => ({ file: c.file, name: c.name, before: '', after: result.preview[c.file] })),
        ]
      : null;
    return { ok: true, hit, suggestions, name: result.expression.name, nameRequired: false, nameError: null, files };
  } catch (e) {
    if (!(e instanceof ConstructError)) throw e;
    if (!name && NAME_REQUIRED_RE.test(e.message)) {
      return { ok: true, hit, suggestions, name: null, nameRequired: true, nameError: null, files: null };
    }
    return { ok: true, hit, suggestions, name: name || null, nameRequired: false, nameError: e.message, files: null };
  }
}

/**
 * #533 -- the real write, only ever reached from "Approve": re-derives the same flagged hit from
 * `nodeId` (never trusting a client-sent range) and calls the real, non-dry-run
 * `extractExpression()`. Touches multiple files (the page, a new Expression, and optionally one or
 * more new Components) -- the caller (the server route) commits/records all of them as one save.
 * @param {string} root Project root.
 * @param {string} absPath Absolute path of the page/component file being wrapped.
 * @param {string} source That file's full current source text.
 * @param {string} nodeId Id of the selected node the flagged hit is re-derived from.
 * @param {string} [name] Caller-supplied Expression name override.
 * @returns {{page:{file:string}, expression:{file:string,name:string}, component:{file:string,name:string}|null, components:{file:string,name:string}[]}}
 *   The written files, as extractExpression's own non-dry-run result reports them.
 * @throws {PagesEditorError} When nothing is flagged (PAGE-008) at the selection.
 * @throws {ConstructError} Any usage error extractExpression itself throws.
 */
export function applyWrapConfirm(root, absPath, source, nodeId, name) {
  const { byId } = parsePageTree(source);
  const node = byId.get(nodeId);
  if (!node) throw noSuchNode(nodeId);
  const hit = findWrapHit(source, [node.start, node.end]);
  if (!hit) throw new PagesEditorError('Nothing flagged (PAGE-008) at that selection to wrap — reload the Palette tab and try again.');
  const hitInfo = describeWrapHit(source, hit);
  return extractExpression(root, absPath, { range: hitInfo.range, name, dryRun: false });
}

/**
 * #56 — run the existing PAGE-* / COMPONENT-* architecture rules and the
 * separation-of-concerns rules against a prospective file, scoped to just
 * that one file, and surface any *error*-severity violation before it
 * lands (the caller writes `patched` to disk only if this returns
 * `ok: true`, and reverts otherwise — see server route below).
 * @param {string} root Project root.
 * @param {string} relPath The file's path relative to `root` (as classified by the layer graph).
 * @param {string} patchedSource The prospective new content to check, written to disk temporarily
 *   (and restored in a `finally`, whether this returns or throws).
 * @returns {{ok:boolean, violations:object[], errors:object[]}} Every architecture/SoC violation
 *   attributed to this file, `errors` filtered to error-severity ones, and whether any exist.
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
