// Parse a page (JSX or TSX) into a small parser-neutral element tree that extract, suggest and apply share.
// Built on `parseJsx` from construct-ast.mjs (Construct's typescript-estree package when available, else Babel; offsets in `range`). No AST node
// leaks out of this file, so the parser can be swapped without touching the rest of the module.
import { parseJsx, walkAst, jsxNameToString } from "./construct-ast.mjs";

/**
 * @typedef {object} TextNode
 * @property {"text"} kind
 * @property {string} text        decoded text (entities resolved), not trimmed
 * @property {number} start       offset of the first character in the source (for `{"x"}`: the brace)
 * @property {number} end
 * @property {number} line        1-based
 * @property {number} column      1-based
 * @property {boolean} fromExpr   true when written as `{"..."}` / `{'...'}` / a no-expression template literal
 * @property {ElementNode|null} parent
 */
/**
 * @typedef {object} ElementNode
 * @property {"element"|"fragment"} kind
 * @property {string} tag         `div`, `Badge`, `Table.Row`; "" for a fragment
 * @property {{name:string, value:string|true, start:number, end:number}[]} attrs  `value` is the string for a
 *   plain `name="x"`, `true` for anything else (bare, `{expr}`); this mirrors what the extractor always did
 * @property {(ElementNode|TextNode|{kind:"expr", start:number, end:number})[]} children  in source order
 * @property {number} start       offset of `<`
 * @property {number} end
 * @property {number} openEnd     offset just after the opening tag's `>` (or `/>`)
 * @property {boolean} selfClosing
 * @property {number} line        1-based
 * @property {number} column      1-based
 * @property {ElementNode|null} parent  nearest enclosing element/fragment (through props and expressions too)
 */
/**
 * @typedef {object} Page
 * @property {string} source
 * @property {ElementNode[]} elements  every element and fragment in document order
 * @property {ElementNode|null} root   the first element (not fragment) in document order
 */

// typescript-estree says `Literal`, Babel says `StringLiteral`; the fallback parser is Babel.
const isStringLiteral = (n) => (n?.type === "Literal" || n?.type === "StringLiteral") && typeof n.value === "string" && !n.regex;

/**
 * Parse `source` (JSX or TSX module text) into the neutral element tree.
 * Throws the parser's error (with an offset) on invalid syntax.
 *
 * @param {string} source JSX or TSX module text.
 * @returns {Page} The page: every element in document order, plus the root.
 * @throws {Error} On a syntax error; the message comes from the parser.
 *
 * @example
 * parsePage('export default () => <Table.Row data-dyn="a">{"x"}</Table.Row>;').root.tag; // => "Table.Row"
 */
export function parsePage(source) {
  const program = parseJsx(source);
  const byNode = new Map();
  const stack = [];
  const make = (node) => {
    const fragment = node.type === "JSXFragment";
    const open = fragment ? node.openingFragment : node.openingElement;
    const rec = {
      kind: fragment ? "fragment" : "element",
      tag: fragment ? "" : jsxNameToString(open.name),
      attrs: fragment ? [] : open.attributes.filter((a) => a.type === "JSXAttribute").map((a) => ({
        name: jsxNameToString(a.name),
        // Only a plain string literal counts as a value; `{"x"}` is an expression (as the Babel version had it).
        value: isStringLiteral(a.value) ? a.value.value : true,
        start: a.range[0],
        end: a.range[1],
      })),
      children: [],
      start: node.range[0],
      end: node.range[1],
      openEnd: open.range[1],
      selfClosing: fragment ? false : !!open.selfClosing,
      line: node.loc.start.line,
      column: node.loc.start.column + 1,
      parent: stack[stack.length - 1] ?? null,
    };
    byNode.set(node, rec);
    return rec;
  };
  // Phase 1: a record per element, parent = nearest enclosing element (props and `{...}` included).
  walkAst(program, {
    enter(node) {
      if (node.type === "JSXElement" || node.type === "JSXFragment") stack.push(make(node));
    },
    leave(node) {
      if (node.type === "JSXElement" || node.type === "JSXFragment") stack.pop();
    },
  });
  // Phase 2: children in source order, with `{"literal"}` and plain template literals read as text.
  for (const [node, rec] of byNode) {
    for (const c of node.children) {
      if (c.type === "JSXText") rec.children.push(textNode(c.value, c, rec, false));
      else if (c.type === "JSXElement" || c.type === "JSXFragment") rec.children.push(byNode.get(c));
      else if (c.type === "JSXExpressionContainer") {
        const e = c.expression;
        if (isStringLiteral(e)) rec.children.push(textNode(e.value, c, rec, true));
        else if (e.type === "TemplateLiteral" && e.expressions.length === 0) {
          rec.children.push(textNode(e.quasis[0].value.cooked ?? "", c, rec, true));
        } else rec.children.push({ kind: "expr", start: c.range[0], end: c.range[1] });
      }
    }
  }
  const elements = [...byNode.values()].sort((a, b) => a.start - b.start);
  return { source, elements, root: elements.find((e) => e.kind === "element") ?? null };
}

function textNode(text, node, parent, fromExpr) {
  return { kind: "text", text, start: node.range[0], end: node.range[1], line: node.loc.start.line, column: node.loc.start.column + 1, fromExpr, parent };
}

/**
 * An attribute's value as the extractor reads it.
 *
 * @param {ElementNode} el The element.
 * @param {string} name Attribute name, e.g. `data-dyn`.
 * @returns {string|true|null} The string for `name="x"`, `true` for any other form (bare, `{expr}`), `null` when absent.
 */
export function attrOf(el, name) {
  const a = el.attrs.find((x) => x.name === name);
  return a ? a.value : null;
}
