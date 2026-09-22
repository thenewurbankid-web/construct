// AST package: traversal. Generic ESTree walking (estree-walker, a well-established library --
// not a hand-rolled recursive walk) plus the "real usage" collectors that rules are built on.
import { walk as walkAst } from 'estree-walker';

export { walkAst };

// Node types/keys that don't represent a real "usage" of an identifier, so the walk
// below (via estree-walker, a well-established generic ESTree traversal library — not
// a hand-rolled recursive walk) skips into them: an import statement's bindings (a name
// merely being imported isn't a use of it), a re-export's specifier list, and a
// non-computed member/object/class-key name (`x.fetch` or `{ fetch: 1 }` isn't a
// reference to the global `fetch`).
const KEY_ONLY_TYPES = new Set(['Property', 'PropertyDefinition', 'MethodDefinition', 'TSPropertySignature', 'TSMethodSignature', 'TSAbstractMethodDefinition', 'TSAbstractPropertyDefinition']);

/**
 * Whether a node sits where an identifier is a name rather than a usage: import declarations, export lists and sources, non-computed member properties and object keys.
 *
 * @param {object} node The node.
 * @param {object} [parent] Its parent.
 * @param {any} [key] The property of `parent` holding `node`.
 * @returns {boolean} `true` when the position is not a usage.
 */
export function isNonUsagePosition(node, parent, key) {
  if (node.type === 'ImportDeclaration' || node.type === 'ExportAllDeclaration') return true;
  if (parent?.type === 'ExportNamedDeclaration' && (key === 'specifiers' || key === 'source')) return true;
  if (parent?.type === 'MemberExpression' && key === 'property' && !parent.computed) return true;
  if (parent && KEY_ONLY_TYPES.has(parent.type) && key === 'key' && !parent.computed) return true;
  return false;
}

/**
 * Shared estree-walker traversal for both collectors below: skips whole subtrees at
 * non-usage positions (see isNonUsagePosition), visits everything else.
 *
 * @param {object} ast A parsed Program.
 * @param {Function} visit `(node, parent, key) => void`, called for each node that is not at a non-usage position.
 */
export function walkForUsage(ast, visit) {
  walkAst(ast, {
    enter(node, parent, key) {
      if (isNonUsagePosition(node, parent, key)) {
        this.skip();
        return;
      }
      visit(node);
    },
  });
}

/**
 * Every real `name(...)` call (callee is a bare identifier in `names`), sorted by position.
 *
 * @param {object} ast A parsed Program.
 * @param {Set<string>} names Callee names to find.
 * @returns {{name:string, index:number}[]} Each call, sorted by offset.
 */
export function collectCalls(ast, names) {
  const hits = [];
  walkForUsage(ast, (node) => {
    if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && names.has(node.callee.name)) {
      hits.push({ name: node.callee.name, index: node.callee.range[0] });
    }
  });
  return hits.sort((a, b) => a.index - b.index);
}

/**
 * Every real reference to a bare identifier in `names` — called or not — sorted by
 * position; skips property/key positions per isNonUsagePosition, so `{ fetch: 1 }` or
 * `obj.fetch` don't count, but `fetch(...)`, `window.x`, or a bare `localStorage` do.
 *
 * @param {object} ast A parsed Program.
 * @param {Set<string>} names Identifier names to find.
 * @returns {{name:string, index:number}[]} Each reference, sorted by offset.
 */
export function collectBareIdentifierUsages(ast, names) {
  const hits = [];
  walkForUsage(ast, (node) => {
    if (node.type === 'Identifier' && names.has(node.name)) {
      hits.push({ name: node.name, index: node.range[0] });
    }
  });
  return hits.sort((a, b) => a.index - b.index);
}

// Ticket 7.4's CONTROLLER-001 deterministic proxy for "business logic": any of these
// node types appearing anywhere in a controller file's AST.
export const CONTROL_FLOW_TYPES = new Set(['IfStatement', 'ForStatement', 'ForInStatement', 'ForOfStatement', 'WhileStatement', 'DoWhileStatement', 'SwitchStatement', 'TryStatement']);

/**
 * Every control-flow node (see CONTROL_FLOW_TYPES) anywhere in `ast`, sorted by position.
 *
 * @param {object} ast A parsed Program.
 * @returns {object[]} The control-flow nodes, sorted by offset.
 */
export function collectControlFlowNodes(ast) {
  const hits = [];
  walkForUsage(ast, (node) => {
    if (CONTROL_FLOW_TYPES.has(node.type)) hits.push(node);
  });
  return hits.sort((a, b) => a.range[0] - b.range[0]);
}
