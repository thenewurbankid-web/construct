// AST package: the JSX element tree with stable node ids (#173).
//
// `parseJsxTree(source)` assigns ids `n0`, `n1`, ... in source (document) order; an id is only valid for
// the exact source text it was computed from. Every record carries the element's `[start, end)` offsets
// in `source`, its 1-based `line`, its props (see `jsxAttributes`) and its children.
import { walkAst } from './walk.mjs';
import { parseJsx } from './jsxParse.mjs';

/** `Foo`, `ui.Item` or `ns:tag` for a JSX name node (`'?'` for anything else). */
export function jsxNameToString(nameNode) {
  if (nameNode.type === 'JSXIdentifier') return nameNode.name;
  if (nameNode.type === 'JSXMemberExpression') return `${jsxNameToString(nameNode.object)}.${jsxNameToString(nameNode.property)}`;
  if (nameNode.type === 'JSXNamespacedName') return `${nameNode.namespace.name}:${nameNode.name.name}`;
  return '?';
}

/**
 * An opening tag's attributes as `{kind, name, value, index}` records (`index` = 0-based position in the
 * attribute list; a spread has `name: null`). kinds: 'string' | 'number' | 'boolean' | 'identifier' |
 * 'expression' (value = raw source text) | 'spread' (value = the spread argument's source text).
 */
export function jsxAttributes(openingElement, source) {
  return openingElement.attributes.map((attr, index) => {
    if (attr.type === 'JSXSpreadAttribute') {
      return { kind: 'spread', name: null, value: source.slice(attr.argument.range[0], attr.argument.range[1]), index };
    }
    const name = jsxNameToString(attr.name);
    if (attr.value == null) return { kind: 'boolean', name, value: true, index };
    if (attr.value.type === 'Literal') return { kind: 'string', name, value: attr.value.value, index };
    if (attr.value.type === 'JSXExpressionContainer') {
      const expr = attr.value.expression;
      if (expr.type === 'Literal' && !expr.regex && !expr.bigint) {
        if (typeof expr.value === 'string') return { kind: 'string', name, value: expr.value, index };
        if (typeof expr.value === 'number') return { kind: 'number', name, value: expr.value, index };
        if (typeof expr.value === 'boolean') return { kind: 'boolean', name, value: expr.value, index };
      }
      if (expr.type === 'Identifier') return { kind: 'identifier', name, value: expr.name, index };
      return { kind: 'expression', name, value: source.slice(expr.range[0], expr.range[1]), index };
    }
    return { kind: 'expression', name, value: source.slice(attr.value.range[0], attr.value.range[1]), index };
  });
}

/**
 * Parse `source` into `{ roots, byId, ast }`. Each record is
 * `{id, tag, isFragment, isCustomComponent, props, start, end, line, children, openingElementNode}`
 * (`openingElementNode` is the raw estree opening element, `null` for a fragment -- internal, for
 * offset-exact attribute edits). Nesting is derived from source ranges, so elements found anywhere in a
 * parent's subtree (inside `{cond && <X/>}` or `.map(...)` callbacks) nest correctly. Throws on a syntax error.
 */
export function parseJsxTree(source) {
  const ast = parseJsx(source);
  const found = [];
  walkAst(ast, {
    enter(node) {
      if (node.type === 'JSXElement' || node.type === 'JSXFragment') found.push(node);
    },
  });
  found.sort((a, b) => a.range[0] - b.range[0]); // document order, whatever key order the walker used

  let counter = 0;
  const byId = new Map();
  const roots = [];
  const stack = [];
  for (const node of found) {
    const isFragment = node.type === 'JSXFragment';
    const openingElement = isFragment ? null : node.openingElement;
    const tag = isFragment ? 'Fragment' : jsxNameToString(openingElement.name);
    const record = {
      id: `n${counter++}`,
      tag,
      isFragment,
      isCustomComponent: !isFragment && /^[A-Z]/.test(tag.split('.')[0]),
      props: isFragment ? [] : jsxAttributes(openingElement, source),
      start: node.range[0],
      end: node.range[1],
      line: node.loc?.start.line ?? null,
      children: [],
      openingElementNode: openingElement,
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

/** The direct parent record of `nodeId` in a parsed tree's `byId`, or `null` for a root. */
export function findParentRecord(byId, nodeId) {
  for (const candidate of byId.values()) {
    if (candidate.children.some((c) => c.id === nodeId)) return candidate;
  }
  return null;
}
