// feature-grouper's own `parseJsxTree` on @babel/parser (jsx + typescript plugins), used only when Construct's
// packages/ast is not available (see ./construct.mjs). It returns the same record shape as Construct's
// `parseJsxTree` for the fields this tool reads: {id, tag, isFragment, isCustomComponent, props, start, end, line,
// children}, ids n0, n1, ... in document order, nesting derived from source ranges.
import { parse } from "@babel/parser";

const SKIP = new Set(["loc", "extra", "leadingComments", "trailingComments", "innerComments", "comments", "tokens"]);

function nameToString(n) {
  if (n.type === "JSXIdentifier") return n.name;
  if (n.type === "JSXMemberExpression") return `${nameToString(n.object)}.${nameToString(n.property)}`;
  if (n.type === "JSXNamespacedName") return `${n.namespace.name}:${n.name.name}`;
  return "?";
}

function attributes(opening, source) {
  return opening.attributes.map((attr, index) => {
    if (attr.type === "JSXSpreadAttribute") return { kind: "spread", name: null, value: source.slice(attr.argument.start, attr.argument.end), index };
    const name = nameToString(attr.name);
    const v = attr.value;
    if (v == null) return { kind: "boolean", name, value: true, index };
    if (v.type === "StringLiteral") return { kind: "string", name, value: v.value, index };
    if (v.type === "JSXExpressionContainer") {
      const e = v.expression;
      if (e.type === "StringLiteral") return { kind: "string", name, value: e.value, index };
      if (e.type === "NumericLiteral") return { kind: "number", name, value: e.value, index };
      if (e.type === "BooleanLiteral") return { kind: "boolean", name, value: e.value, index };
      if (e.type === "Identifier") return { kind: "identifier", name, value: e.name, index };
      return { kind: "expression", name, value: source.slice(e.start, e.end), index };
    }
    return { kind: "expression", name, value: source.slice(v.start, v.end), index };
  });
}

/**
 * Parse `source` into `{ roots, byId, ast }` like Construct's `parseJsxTree` (`ast` is the Babel `Program`).
 *
 * @param {string} source JSX or TSX module text.
 * @returns {{roots:object[], byId:Map<string, object>, ast:object}} The element tree.
 * @throws {Error} With Babel's message on a syntax error.
 */
export function parseJsxTree(source) {
  const ast = parse(source, { sourceType: "module", plugins: ["jsx", "typescript"], ranges: true }).program;
  const found = [];
  const visit = (node) => {
    if (node.type === "JSXElement" || node.type === "JSXFragment") found.push(node);
    for (const [key, v] of Object.entries(node)) {
      if (SKIP.has(key) || !v || typeof v !== "object") continue;
      if (Array.isArray(v)) v.forEach((c) => c && typeof c.type === "string" && visit(c));
      else if (typeof v.type === "string") visit(v);
    }
  };
  visit(ast);
  found.sort((a, b) => a.start - b.start);

  const byId = new Map();
  const roots = [];
  const stack = [];
  let counter = 0;
  for (const node of found) {
    const isFragment = node.type === "JSXFragment";
    const opening = isFragment ? null : node.openingElement;
    const tag = isFragment ? "Fragment" : nameToString(opening.name);
    const record = {
      id: `n${counter++}`,
      tag,
      isFragment,
      isCustomComponent: !isFragment && /^[A-Z]/.test(tag.split(".")[0]),
      props: isFragment ? [] : attributes(opening, source),
      start: node.start,
      end: node.end,
      line: node.loc?.start.line ?? null,
      column: node.loc ? node.loc.start.column + 1 : null,
      children: [],
    };
    byId.set(record.id, record);
    while (stack.length && stack[stack.length - 1].end <= record.start) stack.pop();
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(record);
    else roots.push(record);
    stack.push(record);
  }
  return { roots, byId, ast };
}
