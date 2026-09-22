// AST package: deterministic text edits on JSX nodes located by parseJsxTree (#173).
//
// Every edit is an exact-offset textual splice of the ORIGINAL source (never a whole-file reprint), so
// every byte outside the edited range is preserved. Functions take a node record from `parseJsxTree`
// (`{start, end, isFragment, tag, openingElementNode}`) and the source it was parsed from. Pure: no
// I/O, no validation of the *result* (callers re-parse with `jsxParseError`).
import { jsxNameToString } from './jsxTree.mjs';

/**
 * Splice `newText` over `node`'s range.
 *
 * @param {string} source Full source text.
 * @param {{start:number, end:number}} node A record with source offsets.
 * @param {string} newText Replacement text.
 * @returns {string} The source with `newText` in place of the node.
 */
export function spliceNode(source, node, newText) {
  return source.slice(0, node.start) + newText + source.slice(node.end);
}

/**
 * Source text of one attribute value: `` for a bare `true`, else `="..."` / `={...}`.
 *
 * @param {'string'|'number'|'boolean'|'identifier'|'expression'} kind How the value is written.
 * @param {string|number|boolean} value The value (raw expression text for `expression`).
 * @returns {string} The attribute's value text, including the leading `=` (empty for a bare `true`).
 *
 * @example
 * renderAttrValue('string', 'hi'); // => '="hi"'
 */
export function renderAttrValue(kind, value) {
  if (kind === 'boolean' && value === true) return '';
  if (kind === 'boolean') return `={${value ? 'true' : 'false'}}`;
  if (kind === 'string') return `="${String(value).replaceAll('"', '&quot;')}"`;
  if (kind === 'number') return `={${Number(value)}}`;
  if (kind === 'identifier') return `={${value}}`;
  return `={${value}}`; // 'expression' -- value is raw source text of the expression
}

const namedAttribute = (opening, propName) =>
  opening.attributes.find((a) => a.type === 'JSXAttribute' && jsxNameToString(a.name) === propName);

/**
 * The whole node's new text after setting one named attribute: replaced in place if it exists,
 * otherwise appended at the end of the attribute list (right before the opening tag's `>` / `/>`).
 *
 * @param {string} source Full source text.
 * @param {object} node An element record from `parseJsxTree`.
 * @param {string} propName Attribute name.
 * @param {'string'|'number'|'boolean'|'identifier'|'expression'} kind How the value is written.
 * @param {string|number|boolean} value The value.
 * @returns {string} The element's new source text.
 */
export function setAttributeText(source, node, propName, kind, value) {
  const opening = node.openingElementNode;
  const rendered = renderAttrValue(kind, value);
  const existing = namedAttribute(opening, propName);
  if (existing) {
    return source.slice(node.start, existing.range[0]) + propName + rendered + source.slice(existing.range[1], node.end);
  }
  const openingEnd = opening.range[1];
  const insertAt = opening.selfClosing ? openingEnd - 2 : openingEnd - 1;
  const needsSpace = !/\s$/.test(source.slice(insertAt - 1, insertAt));
  return source.slice(node.start, insertAt) + (needsSpace ? ' ' : '') + propName + rendered + source.slice(insertAt, node.end);
}

/**
 * The whole node's new text after replacing the spread attribute at `index` with `{...value}`, or
 * `null` if there is no spread attribute at that position.
 *
 * @param {string} source Full source text.
 * @param {object} node An element record from `parseJsxTree`.
 * @param {number} index Position of the spread in the attribute list.
 * @param {string} value Source text of the new spread argument.
 * @returns {string|null} The element's new source text, or `null` when there is no spread at `index`.
 */
export function setSpreadText(source, node, index, value) {
  const candidate = typeof index === 'number' ? node.openingElementNode.attributes[index] : undefined;
  if (!candidate || candidate.type !== 'JSXSpreadAttribute') return null;
  return source.slice(node.start, candidate.range[0]) + `{...${value}}` + source.slice(candidate.range[1], node.end);
}

/**
 * The whole node's new text with one named attribute deleted (plus the whitespace run before it), or
 * `null` if the node has no such attribute.
 *
 * @param {string} source Full source text.
 * @param {object} node An element record from `parseJsxTree`.
 * @param {string} propName Attribute to delete.
 * @returns {string|null} The element's new source text, or `null` when the attribute does not exist.
 */
export function removeAttributeText(source, node, propName) {
  const existing = namedAttribute(node.openingElementNode, propName);
  if (!existing) return null;
  let start = existing.range[0];
  while (start > node.start && /\s/.test(source[start - 1])) start--;
  return source.slice(node.start, start) + source.slice(existing.range[1], node.end);
}

/**
 * The full source with `node` (and its subtree) deleted, plus its leading indentation and one trailing newline.
 *
 * @param {string} source Full source text.
 * @param {{start:number, end:number}} node The element to delete.
 * @returns {string} The full source without the element.
 */
export function removeNodeText(source, node) {
  let start = node.start;
  while (start > 0 && /[ \t]/.test(source[start - 1])) start--;
  let end = node.end;
  if (source.slice(end, end + 2) === '\r\n') end += 2;
  else if (source[end] === '\n') end += 1;
  return source.slice(0, start) + source.slice(end);
}

/**
 * The full source with two sibling nodes' texts swapped (`a` must precede `b`); text between them stays put.
 *
 * @param {string} source Full source text.
 * @param {{start:number, end:number}} a The first sibling.
 * @param {{start:number, end:number}} b The second sibling; must come after `a`.
 * @returns {string} The full source with the two elements exchanged.
 */
export function swapNodesText(source, a, b) {
  const between = source.slice(a.end, b.start);
  return source.slice(0, a.start) + source.slice(b.start, b.end) + between + source.slice(a.start, a.end) + source.slice(b.end);
}

/** The deliberately minimal child that `addChildText` appends. */
export const NEW_CHILD_SNIPPET = '<div />';

/**
 * The full source with a new child appended right before `parent`'s closing tag. Returns
 * `{ok: true, source}`, or `{ok: false, reason: 'self-closing' | 'no-position'}` when the element is
 * `<Tag />` (not silently converted to an open/close pair) or the insertion point can't be determined.
 *
 * @param {string} source Full source text.
 * @param {object} parent Element record of the new child's parent.
 * @param {string} [childSnippet] Source of the child (defaults to `NEW_CHILD_SNIPPET`).
 * @returns {{ok:true, source:string}|{ok:false, reason:'self-closing'|'no-position'}} The new full source, or why it could not be added.
 */
export function addChildText(source, parent, childSnippet = NEW_CHILD_SNIPPET) {
  if (!parent.isFragment && parent.openingElementNode.selfClosing) return { ok: false, reason: 'self-closing' };
  const closingLength = parent.isFragment ? 3 /* </> */ : parent.tag.length + 3; /* </Tag> */
  const insertAt = parent.end - closingLength;
  if (insertAt < parent.start) return { ok: false, reason: 'no-position' };
  return { ok: true, source: source.slice(0, insertAt) + childSnippet + source.slice(insertAt) };
}
