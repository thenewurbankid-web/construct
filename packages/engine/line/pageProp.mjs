// T3 of the Line Cockpit (contract.mjs): set one attribute on one JSX node of a feature page, as a staged
// change, and read a page's node tree for the Pages screen's picker. Built on the Pages editor's spot editing
// (pagesEditor.mjs: resolvePageFile scope guard, parsePageTree node ids, buildAttributeSnippet, patchNode) so
// the node ids are exactly the ones /api/pages/tree serves, and only the edited attribute's bytes change.
// Pure: reads the page, never writes (applyChange does).
import fs from 'node:fs';
import path from 'node:path';
import {
  PagesEditorError, parsePageTree, serializeTree, buildAttributeSnippet, patchNode,
  getNodeProps, hashOf, collectComponentScopeNames,
} from '../pagesEditor.mjs';
import { loadConfig } from '@line/construct-core/config';
import { normalizeLineConfig } from '@line/construct-core/profiles/line/contract';
import { resolveLayout } from '@line/construct-core/profiles/line/checks';
import { jsxParseError } from '@construct/ast';
import { LineOpError } from './contract.mjs';

/** The value kinds planSetProp writes (SetPropRequest.kind). */
export const SETTABLE_KINDS = Object.freeze(['string', 'number', 'boolean', 'expression']);

const ATTR_NAME = /^[A-Za-z_$][\w$-]*(:[A-Za-z_$][\w$-]*)?$/;

/**
 * One prop as written on a node (the Pages editor's own record, from jsxAttributes).
 * @typedef {object} PageNodeProp
 * @property {'string'|'number'|'boolean'|'identifier'|'expression'|'spread'} kind
 * @property {string|null} name   Attribute name; null for a spread.
 * @property {string|number|boolean} value  Literal value, or the source text for identifier/expression/spread.
 * @property {number} index       Position among the tag's attributes.
 */

/**
 * One JSX node of a page: the /api/pages/tree node shape plus `settable`.
 * @typedef {object} PageTreeNode
 * @property {string} id          "n0", "n1", ... in source order: pass it straight to planSetProp's nodeId.
 * @property {string} tag         e.g. "ListPage", "div"; "" for a fragment.
 * @property {boolean} isFragment
 * @property {boolean} isCustomComponent
 * @property {PageNodeProp[]} props  Its current props (the same list getNodeProps returns for this id).
 * @property {boolean} settable   False for a fragment (<>...</>), which has no props to set.
 * @property {number} line        1-based.
 * @property {number} column
 * @property {PageTreeNode[]} children
 */

/**
 * A page's node tree for the Pages screen.
 * @typedef {object} PageTree
 * @property {string} file        Root-relative path, as passed in.
 * @property {string} feature     The feature that owns the page.
 * @property {string} contentHash sha256 of the source the ids were computed from.
 * @property {string[]} scopeNames  Names in scope in the page component (its props and state), for expression values.
 * @property {PageTreeNode[]} roots
 */

const PAGE_EXT = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.mts', '.cts']);

/**
 * Resolve a root-relative feature page path, or refuse with UNKNOWN_ITEM. The features folder is the Line
 * layout's (line.features, else src/features or features), not the Pages editor's features.root, so a Line
 * project that keeps its code under src/ works; the path must stay inside <features>/<feature>/pages/ and
 * its real path inside the project.
 */
function readPage(root, file) {
  const unknown = () => new LineOpError(`There is no page "${file}" in this project.`, 'UNKNOWN_ITEM');
  if (typeof file !== 'string' || !file || path.isAbsolute(file) || file.split(/[\\/]/).includes('..')) throw unknown();
  const { features } = resolveLayout(root, normalizeLineConfig(/** @type {any} */ (loadConfig(root)).line));
  const parts = file.split('/');
  const rootParts = features.split('/');
  const [feature, pagesDir, ...rest] = parts.slice(rootParts.length);
  if (parts.slice(0, rootParts.length).join('/') !== features || !feature || pagesDir !== 'pages' || rest.length === 0) throw unknown();
  if (!PAGE_EXT.has(path.extname(file))) throw unknown();
  const abs = path.join(root, file);
  let real;
  try { real = fs.realpathSync(abs); } catch { throw unknown(); }
  const realRoot = fs.realpathSync(root);
  if (!real.startsWith(realRoot + path.sep) || !fs.statSync(real).isFile()) throw unknown();
  return { feature, source: fs.readFileSync(real, 'utf8') };
}

/** Parse the page, or refuse: a page that does not parse has no nodes to pick. */
function treeOf(source, file) {
  try {
    return parsePageTree(source);
  } catch {
    throw new LineOpError(`The page "${file}" does not parse, so its parts cannot be edited until it is fixed.`, 'UNKNOWN_ITEM');
  }
}

/**
 * A page's node tree with each node's current props, for the Pages screen's picker.
 * @param {string} root Project root.
 * @param {string} file Root-relative page path, e.g. "features/orders/pages/OrdersPage.tsx".
 * @returns {PageTree}
 * @throws {LineOpError} UNKNOWN_ITEM when there is no such page or it does not parse.
 */
export function readPageTree(root, file) {
  const { feature, source } = readPage(root, file);
  const { ast } = treeOf(source, file);
  const { roots, contentHash } = serializeTree(source);
  const withProps = (n) => ({
    ...n,
    props: getNodeProps(source, n.id).props,
    settable: !n.isFragment,
    children: n.children.map(withProps),
  });
  return { file, feature, contentHash, scopeNames: collectComponentScopeNames(ast), roots: roots.map(withProps) };
}

/** The value's source text check per kind; returns the value to render, or throws BAD_VALUE. */
function checkValue(kind, value, prop) {
  const bad = (why) => new LineOpError(`The value for ${prop} ${why}.`, 'BAD_VALUE');
  if (kind === 'string') {
    if (typeof value !== 'string') throw bad('must be text');
    return value;
  }
  if (kind === 'number') {
    const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    if (typeof n !== 'number' || !Number.isFinite(n)) throw bad('must be a finite number');
    return n;
  }
  if (kind === 'boolean') {
    if (typeof value !== 'boolean') throw bad('must be true or false');
    return value;
  }
  // expression: one standalone JavaScript expression, so it cannot close its braces and add attributes.
  if (typeof value !== 'string' || !value.trim()) throw bad('must be a JavaScript expression');
  if (jsxParseError(`(${value}\n);`)) throw bad('is not a single valid JavaScript expression');
  return value.trim();
}

const brief = (kind, value) => {
  const text = kind === 'string' ? `"${value}"` : String(value);
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
};

/**
 * Stage setting one attribute on one node of a feature page. Only that attribute's bytes change; every
 * other byte of the file is kept. Pure: nothing is written.
 * @param {string} root Project root.
 * @param {import('./contract.mjs').SetPropRequest} req
 * @returns {import('./contract.mjs').StagedChange}
 * @throws {LineOpError} UNKNOWN_ITEM (no such page or node), UNKNOWN_PROP (kind or prop not settable), BAD_VALUE.
 */
export function planSetProp(root, { file, nodeId, prop, kind, value } = /** @type {any} */ ({})) {
  const { source } = readPage(root, file);
  const { byId } = treeOf(source, file);
  const node = typeof nodeId === 'string' ? byId.get(nodeId) : undefined;
  if (!node) throw new LineOpError(`The page "${file}" has no part "${nodeId}"; reload the page tree and pick it again.`, 'UNKNOWN_ITEM');
  if (!SETTABLE_KINDS.includes(kind)) {
    throw new LineOpError(`A ${kind || 'missing'} value cannot be set here; use string, number, boolean or expression.`, 'UNKNOWN_PROP');
  }
  if (typeof prop !== 'string' || !ATTR_NAME.test(prop)) {
    throw new LineOpError(`"${prop}" is not a valid prop name.`, 'UNKNOWN_PROP');
  }
  if (node.isFragment) throw new LineOpError('A fragment (<>...</>) has no props to set; pick the element inside it.', 'UNKNOWN_PROP');
  const rendered = checkValue(kind, value, prop);

  let content;
  try {
    const snippet = buildAttributeSnippet(source, nodeId, prop, kind, rendered);
    content = patchNode(source, nodeId, snippet, hashOf(source));
  } catch (e) {
    if (e instanceof PagesEditorError) throw new LineOpError(`Setting ${prop} to that value would leave the page unparseable.`, 'BAD_VALUE');
    throw e;
  }
  const page = path.basename(file).replace(/\.[^.]+$/, '');
  return {
    summary: `Sets ${prop} to ${brief(kind, rendered)} on ${node.tag} in the page ${page}.`,
    files: [{ path: file, content }],
  };
}
