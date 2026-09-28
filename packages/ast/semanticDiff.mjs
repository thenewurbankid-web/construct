// AST package: behaviour-preserving verdict for a staged edit (#747, part of epic #461's "Change check").
// Deterministic, no LLM: parses before/after with the same typescript-estree stack as the rest of this
// package, strips formatting/positions, alpha-renames identifiers by first-occurrence order, and compares
// the two canonical trees. Reordering is only accepted for statements with no observable side effect on
// evaluation order (function/class/type declarations, and `const`/`let` whose initializer can't run code).
import { parseToAst } from './parse.mjs';
import { isNonUsagePosition } from './walk.mjs';

/** The closed set of verdicts `semanticDiff` returns. */
export const SEMANTIC_DIFF_VERDICTS = Object.freeze(['same-behaviour', 'changed', 'cant-tell']);

/** The closed set of AST-level operation ids `semanticDiff` reports. */
export const SEMANTIC_DIFF_OPERATIONS = Object.freeze(['renamed', 'reordered', 'reformatted', 'changed']);

const META_KEYS = new Set(['range', 'loc', 'comments', 'parent', 'tokens', 'start', 'end']);

// Declaration kinds whose position among their siblings never changes what running the program does,
// because nothing about their own evaluation can be observed by another top-level statement (Ticket #747).
const REORDER_SAFE_DECLARATIONS = new Set(['FunctionDeclaration', 'ClassDeclaration', 'TSInterfaceDeclaration', 'TSTypeAliasDeclaration', 'TSEnumDeclaration']);

function isSideEffectFreeExpression(node) {
  if (node == null) return true;
  switch (node.type) {
    case 'Literal':
    case 'Identifier':
    case 'ArrowFunctionExpression':
    case 'FunctionExpression':
      return true;
    case 'TemplateLiteral':
      return node.expressions.length === 0;
    case 'UnaryExpression':
      return isSideEffectFreeExpression(node.argument);
    case 'ObjectExpression':
      return node.properties.every((p) => p.type === 'Property' && !p.computed && isSideEffectFreeExpression(p.value));
    case 'ArrayExpression':
      return node.elements.every((el) => el === null || isSideEffectFreeExpression(el));
    default:
      return false;
  }
}

/**
 * Whether `stmt` may safely change position relative to its siblings without changing behaviour: a
 * function/class/interface/type/enum declaration, or a `var`/`let`/`const` whose initializers cannot run
 * code (so nothing depends on when, relative to its siblings, the binding is created).
 *
 * @param {object} stmt A (canonicalized) statement node.
 * @returns {boolean} `true` when reordering this statement is behaviour-preserving on its own.
 */
function isReorderSafeStatement(stmt) {
  if (!stmt || typeof stmt !== 'object') return false;
  if (REORDER_SAFE_DECLARATIONS.has(stmt.type)) return true;
  if (stmt.type === 'VariableDeclaration') return stmt.declarations.every((d) => isSideEffectFreeExpression(d.init));
  if (stmt.type === 'ExportNamedDeclaration' && stmt.declaration) return isReorderSafeStatement(stmt.declaration);
  if (stmt.type === 'ExportDefaultDeclaration') return isReorderSafeStatement(stmt.declaration);
  return false;
}

/**
 * Strip positions/comments and alpha-rename every identifier at a usage position (packages/ast's own
 * `isNonUsagePosition`, so property keys, non-computed member names and import/export specifier lists keep
 * their literal names) to a placeholder assigned by first-occurrence order *within this one subtree*. Two
 * structurally identical subtrees that only differ in local naming canonicalize to the same tree.
 *
 * @param {object} node Any AST node (a whole Program, or a single top-level statement).
 * @returns {{ tree: object, orderedNames: string[] }} The canonical tree, plus the original names in the
 *   order their placeholders were assigned (for detecting an actual rename once trees compare equal).
 */
function canonicalizeNode(node) {
  const nameMap = new Map();
  const orderedNames = [];
  const alphaName = (name) => {
    if (!nameMap.has(name)) {
      nameMap.set(name, `#${nameMap.size}`);
      orderedNames.push(name);
    }
    return nameMap.get(name);
  };
  const visit = (n, parent, key, protect) => {
    if (n == null || typeof n !== 'object') return n;
    if (Array.isArray(n)) return n.map((child) => visit(child, parent, key, protect));
    const skip = protect || isNonUsagePosition(n, parent, key);
    const out = {};
    for (const k of Object.keys(n)) {
      if (META_KEYS.has(k)) continue;
      out[k] = visit(n[k], n, k, skip);
    }
    if (n.type === 'Identifier' && !skip) out.name = alphaName(n.name);
    return out;
  };
  return { tree: visit(node, null, null, false), orderedNames };
}

/**
 * `canonicalizeNode`, but with a fresh, independent alpha-naming scope per top-level statement rather than
 * one counter for the whole file. Without this, reordering two top-level declarations shifts which one is
 * *encountered* first, which would reassign different placeholder names to the very same declaration and
 * make a pure reorder look like a rename-plus-changed edit (Ticket #747: this is exactly what the
 * reorder-safe multiset match in `compareTopLevel` needs, to compare each moved statement against its own
 * former self, not against a position-dependent numbering).
 *
 * @param {object} ast A parsed Program (see `parseToAst`).
 * @returns {{ tree: object, orderedNames: string[] }[]} One canonicalization per top-level statement.
 */
function canonicalize(ast) {
  return ast.body.map((stmt) => canonicalizeNode(stmt));
}

/**
 * Structural equality of two canonicalized trees (already alpha-renamed, so no identifier names are
 * compared here). Arrays that fail a sequential compare are retried as a reorder-safe multiset match when
 * every element on both sides is `isReorderSafeStatement`; a successful match that way records `'reordered'`
 * in `ops`.
 *
 * @param {any} a Canonical value (before).
 * @param {any} b Canonical value (after).
 * @param {Set<string>} ops Operation ids discovered so far; mutated in place.
 * @returns {boolean} `true` when `a` and `b` are behaviour-equivalent under this comparison.
 */
function structurallyEqual(a, b, ops) {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    if (a.every((item, i) => structurallyEqual(item, b[i], ops))) return true;
    if (a.every(isReorderSafeStatement) && b.every(isReorderSafeStatement)) {
      const remaining = [...b];
      for (const itemA of a) {
        const idx = remaining.findIndex((itemB) => structurallyEqual(itemA, itemB, new Set()));
        if (idx === -1) return false;
        remaining.splice(idx, 1);
      }
      ops.add('reordered');
      return true;
    }
    return false;
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === b;
  const keysA = Object.keys(a).sort();
  const keysB = Object.keys(b).sort();
  if (keysA.length !== keysB.length || keysA.some((k, i) => k !== keysB[i])) return false;
  return keysA.every((k) => structurallyEqual(a[k], b[k], ops));
}

/**
 * Whether two canonicalized top-level items (`{ tree, orderedNames }`) have the same shape, and whether
 * their own local names differ (recorded into `ops` as `'renamed'` when they do -- comparing each matched
 * item's *own* name list, never a flat whole-file list, so a reorder is never mistaken for a rename).
 *
 * @param {{ tree: object, orderedNames: string[] }} itemA
 * @param {{ tree: object, orderedNames: string[] }} itemB
 * @param {Set<string>} ops Mutated in place with any operations found.
 * @returns {boolean} `true` when the two items are behaviour-equivalent.
 */
function itemsEqual(itemA, itemB, ops) {
  if (!structurallyEqual(itemA.tree, itemB.tree, ops)) return false;
  if (itemA.orderedNames.length === itemB.orderedNames.length
    && itemA.orderedNames.some((name, i) => name !== itemB.orderedNames[i])) {
    ops.add('renamed');
  }
  return true;
}

/**
 * Compares the whole program: each before/after top-level statement pair via `itemsEqual`, first
 * sequentially, then (only when every item on both sides is `isReorderSafeStatement`) as a reorder-safe
 * multiset match.
 *
 * @param {{ tree: object, orderedNames: string[] }[]} beforeItems
 * @param {{ tree: object, orderedNames: string[] }[]} afterItems
 * @param {Set<string>} ops Mutated in place with any operations found.
 * @returns {boolean} `true` when the programs are behaviour-equivalent under this comparison.
 */
function compareTopLevel(beforeItems, afterItems, ops) {
  if (beforeItems.length !== afterItems.length) return false;
  if (beforeItems.every((item, i) => itemsEqual(item, afterItems[i], ops))) return true;
  const beforeTrees = beforeItems.map((i) => i.tree);
  const afterTrees = afterItems.map((i) => i.tree);
  if (!beforeTrees.every(isReorderSafeStatement) || !afterTrees.every(isReorderSafeStatement)) return false;
  const remaining = [...afterItems];
  for (const itemA of beforeItems) {
    const idx = remaining.findIndex((itemB) => itemsEqual(itemA, itemB, new Set()));
    if (idx === -1) return false;
    itemsEqual(itemA, remaining[idx], ops); // re-run with the real ops set, to record any rename on the matched pair
    remaining.splice(idx, 1);
  }
  ops.add('reordered');
  return true;
}

/**
 * A deterministic, LLM-free verdict on whether `afterSource` changed the behaviour of `beforeSource`: same
 * source (or same ignoring formatting/renaming/reorder-safe declaration order) is `'same-behaviour'`; a real
 * structural difference is `'changed'`; a parse failure on either side is `'cant-tell'`. Ticket #747, part of
 * epic #461's "Change check" (a static logic indicator shown before saving, not a CI-time check).
 *
 * @param {string} beforeSource The source before the edit.
 * @param {string} afterSource The source after the edit.
 * @returns {{ verdict: 'same-behaviour'|'changed'|'cant-tell', operations: string[], reason?: string }}
 *   `operations` is a subset of `SEMANTIC_DIFF_OPERATIONS`, in a stable order (`renamed`, `reordered`,
 *   `reformatted`), or `['changed']` when the verdict is `'changed'`.
 *
 * @example
 * semanticDiff('function add(a, b) { return a + b; }', 'function sum(x, y) { return x + y; }');
 * // => { verdict: 'same-behaviour', operations: ['renamed'] }
 */
export function semanticDiff(beforeSource, afterSource) {
  if (beforeSource === afterSource) return { verdict: 'same-behaviour', operations: [] };

  let beforeAst;
  let afterAst;
  try {
    beforeAst = parseToAst(beforeSource);
    afterAst = parseToAst(afterSource);
  } catch (e) {
    return { verdict: 'cant-tell', operations: [], reason: `parse error: ${e?.message ?? e}` };
  }

  const before = canonicalize(beforeAst);
  const after = canonicalize(afterAst);
  const ops = new Set();
  const equal = compareTopLevel(before, after, ops);
  if (!equal) return { verdict: 'changed', operations: ['changed'] };

  if (ops.size === 0) ops.add('reformatted');

  // Stable, documented order regardless of discovery order above.
  const operations = SEMANTIC_DIFF_OPERATIONS.filter((op) => ops.has(op) && op !== 'changed');
  return { verdict: 'same-behaviour', operations };
}
