// Step 1 — read the designed page and find its dynamic parts.
// Deterministic: walks the JSX AST, no model calls.
//
// Markers the designer puts in the page:
//   data-dyn="name"      this element's text is data (the text is the example value)
//   data-list="name"     this element's children are a repeated list (first child = template)
//   data-action="verb"   a button/form that does something (create, save, edit, delete, cancel, …)
//
// extract() now reads the page through Construct's AST package (src/import/), so it also handles real
// Subframe TSX. parsePage/attr/textOf/walk below are the Babel helpers that rewrite-page, page-preview and
// the AI context still use to edit and draw JSX; they stay as they were, plus a TypeScript retry.
import { parse } from "@babel/parser";
import { extractParts } from "./import/extract-parts.mjs";

/**
 * Parse a page's source with Babel (JSX, retrying with the TypeScript plugin for TSX). Used only by the Babel
 * helpers below and by `rewrite-page.mjs`/`page-preview.mjs`/the AI context; `extract()` itself now goes through
 * Construct's AST package (see `src/import/`).
 *
 * @param {string} source JSX or TSX module text.
 * @returns {object} A Babel `File` AST node.
 * @throws {Error} The JSX-mode parse error, if the TypeScript-mode retry also fails.
 */
export function parsePage(source) {
  try {
    return parse(source, { sourceType: "module", plugins: ["jsx"] });
  } catch (e) {
    // Real Subframe pages are TSX; plain JSX examples never reach this branch, so their parse is unchanged.
    try { return parse(source, { sourceType: "module", plugins: ["jsx", "typescript"] }); } catch { throw e; }
  }
}

/**
 * A JSX element's attribute value, Babel AST version.
 *
 * @param {object} node A Babel `JSXElement` node.
 * @param {string} name The attribute name.
 * @returns {string|true|null} The string for `name="x"`, `true` for any other form (bare, `{expr}`), `null` when
 *   absent.
 */
export function attr(node, name) {
  const a = node.openingElement.attributes.find(
    (x) => x.type === "JSXAttribute" && x.name.name === name
  );
  if (!a) return null;
  return a.value?.type === "StringLiteral" ? a.value.value : true;
}

/**
 * A JSX element's text content, recursively, normalized (whitespace collapsed and trimmed).
 *
 * @param {object} node A Babel `JSXElement` node.
 * @returns {string} The joined, normalized text.
 */
export function textOf(node) {
  return node.children
    .map((c) => (c.type === "JSXText" ? c.value : c.type === "JSXElement" ? textOf(c) : ""))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

// Walk JSX elements under a node (inclusive), without needing babel scopes.
/**
 * Walk every JSX element under `node` (inclusive), depth-first, without needing Babel scopes.
 *
 * @param {*} node A Babel node (only `JSXElement` nodes and their descendants are visited).
 * @param {(el: object) => void} fn Called once per `JSXElement` found.
 * @returns {void}
 */
export function walk(node, fn) {
  if (node?.type !== "JSXElement") return;
  fn(node);
  node.children.forEach((c) => walk(c, fn));
}

/**
 * Read a designed page and find its dynamic parts (`data-dyn`, `data-list`, `data-action` markers). Deterministic:
 * walks the JSX AST (via Construct's AST package when available, else Babel), no model calls.
 *
 * @param {string} source The page's JSX/TSX source.
 * @returns {{lists: object[], values: object[], actions: object[], forms: object[]}} The extracted parts,
 *   delegated to {@link extractParts}.
 */
export function extract(source) {
  return extractParts(source);
}
