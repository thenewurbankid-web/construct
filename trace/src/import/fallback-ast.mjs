// Trace's own implementation of the five AST functions the import block needs, on @babel/parser
// (already a dependency; `jsx` + `typescript` plugins). Used when Construct's package is not available
// (see src/construct.mjs). Same names and behaviour as packages/ast, so the rest of src/import/ does not
// know which one it runs on; the tests assert equal results in both modes.
import { parse } from "@babel/parser";

// Babel puts these on nodes but they are not children.
const SKIP = new Set(["loc", "extra", "leadingComments", "trailingComments", "innerComments", "comments", "tokens"]);

/**
 * Parse a JSX/TSX module. Positions are in `range`, like typescript-estree. Throws on a syntax error.
 *
 * @param {string} source JSX or TSX module text.
 * @returns {object} The `Program` node.
 * @throws {Error} With Babel's message on a syntax error.
 */
export function parseJsx(source) {
  return parse(source, { sourceType: "module", plugins: ["jsx", "typescript"], ranges: true }).program;
}

/**
 * Depth-first walk with `enter(node)` / `leave(node)` (children in key order), like estree-walker's `walk`.
 *
 * @param {object} ast Root node.
 * @param {{enter?:Function, leave?:Function}} visitors Callbacks.
 * @returns {void}
 */
export function walkAst(ast, { enter, leave }) {
  const visit = (node) => {
    enter?.(node);
    for (const [key, v] of Object.entries(node)) {
      if (SKIP.has(key) || !v || typeof v !== "object") continue;
      if (Array.isArray(v)) v.forEach((c) => c && typeof c.type === "string" && visit(c));
      else if (typeof v.type === "string") visit(v);
    }
    leave?.(node);
  };
  visit(ast);
}

/**
 * `Foo`, `ui.Item` or `ns:tag` for a JSX name node.
 *
 * @param {object} n A JSX name node.
 * @returns {string} The name as written; `"?"` for an unknown node type.
 */
export function jsxNameToString(n) {
  if (n.type === "JSXIdentifier") return n.name;
  if (n.type === "JSXMemberExpression") return `${jsxNameToString(n.object)}.${jsxNameToString(n.property)}`;
  if (n.type === "JSXNamespacedName") return `${n.namespace.name}:${n.name.name}`;
  return "?";
}

/**
 * Replace `[node.start, node.end)` of `source` with `newText`.
 *
 * @param {string} source Full source text.
 * @param {{start:number, end:number}} node Offsets.
 * @param {string} newText Replacement.
 * @returns {string} The new source.
 */
export function spliceNode(source, node, newText) {
  return source.slice(0, node.start) + newText + source.slice(node.end);
}

/**
 * Source text of a JSX attribute value: `="..."` for a string, `={...}` otherwise, empty for bare `true`.
 *
 * @param {"string"|"number"|"boolean"|"identifier"|"expression"} kind How the value is written.
 * @param {string|number|boolean} value The value.
 * @returns {string} The text including the leading `=`.
 */
export function renderAttrValue(kind, value) {
  if (kind === "boolean" && value === true) return "";
  if (kind === "boolean") return `={${value ? "true" : "false"}}`;
  if (kind === "string") return `="${String(value).replaceAll('"', "&quot;")}"`;
  if (kind === "number") return `={${Number(value)}}`;
  return `={${value}}`;
}
