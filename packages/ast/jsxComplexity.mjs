// AST package: JSX shape/complexity detection (#508). Generic, syntactic
// detection of "inline conditional/loop logic in JSX" and a component's
// overall JSX complexity -- used by COMPONENT-005/006
// (packages/core/architecture-enforcer.mjs), and written so a future
// PAGE-008/009 (#505, not yet built) can reuse it verbatim instead of
// reinventing the same shape detector. Deliberately independent of the
// `expressions` layer's own types (#503, also not yet built): this is a
// shape detector over the real AST (typescript-estree, the same parser
// parseToAst/parseJsx already use throughout this package), not a
// semantic/type-aware analysis keyed off an `@expression`-tagged unit's
// declared type -- it works today and keeps working unchanged once #503
// lands and gives a name to the units this rule pushes code towards.
import { walkAst } from './walk.mjs';

/** True when `node` is -- or, for a conditional/logical node, resolves
 * through at least one branch to -- something that actually produces JSX: a
 * `JSXElement`/`JSXFragment` literal, a `ConditionalExpression` whose
 * consequent/alternate does, or a `LogicalExpression` (`&&`/`||`) whose
 * right-hand operand does. This is what lets the detector below tell
 * `cond ? <A/> : <B/>` (a JSX-producing conditional -- the pattern this rule
 * exists for) apart from `cond ? 'a' : 'b'` (an ordinary string computation
 * that happens to sit inside a component/page, already governed by
 * COMPONENT-001/PAGE-001's "presentation-only") without needing type
 * information. */
function producesJsx(node) {
  if (!node) return false;
  if (node.type === 'JSXElement' || node.type === 'JSXFragment') return true;
  if (node.type === 'ConditionalExpression') return producesJsx(node.consequent) || producesJsx(node.alternate);
  if (node.type === 'LogicalExpression' && (node.operator === '&&' || node.operator === '||')) return producesJsx(node.right);
  return false;
}

/** Array methods whose callback commonly renders a list of JSX elements
 * (`items.map(i => <Item key={i.id}/>)`) -- the "loop" half of "no inline
 * conditional/loop logic in JSX". A `.filter(...).map(...)` chain is still
 * caught: the outer call is the `.map(...)`, which is what gets inspected. */
const LOOP_RENDER_METHODS = new Set(['map', 'flatMap']);

/** Whether `fn` (an Arrow/FunctionExpression passed as a callback) itself
 * renders JSX -- a concise arrow body that produces JSX, or any `return`
 * inside a block body that does. */
function callbackProducesJsx(fn) {
  if (!fn || (fn.type !== 'ArrowFunctionExpression' && fn.type !== 'FunctionExpression')) return false;
  if (fn.body.type !== 'BlockStatement') return producesJsx(fn.body);
  let found = false;
  walkAst(fn.body, {
    enter(node) {
      if (node.type === 'ReturnStatement' && producesJsx(node.argument)) found = true;
    },
  });
  return found;
}

function isLoopRenderCall(node) {
  return (
    node.type === 'CallExpression' &&
    node.callee.type === 'MemberExpression' &&
    !node.callee.computed &&
    node.callee.property.type === 'Identifier' &&
    LOOP_RENDER_METHODS.has(node.callee.property.name) &&
    callbackProducesJsx(node.arguments[node.arguments.length - 1])
  );
}

/**
 * Every inline conditional-rendering or loop-rendering node in `ast`:
 * `cond ? <A/> : <B/>`, `cond && <A/>`, `items.map(i => <Item/>)` (and
 * `.flatMap`) -- the shape COMPONENT-005 (and, mirrored, a future PAGE-008)
 * exist to push out of a component/page's own JSX and into a named,
 * separately-testable `@expression` unit instead. Sorted by position; each
 * entry is `{kind: 'conditional'|'loop', node}`.
 *
 * @param {object} ast A parsed Program (parseToAst/parseJsx).
 * @returns {{kind: 'conditional'|'loop', node: object}[]}
 *
 * @example
 * collectInlineJsxLogic(parseToAst('const C = (p) => p.ok ? <A/> : <B/>;'));
 * // => [{ kind: 'conditional', node: <the ConditionalExpression node> }]
 */
export function collectInlineJsxLogic(ast) {
  const hits = [];
  walkAst(ast, {
    enter(node) {
      const isConditionalLike =
        node.type === 'ConditionalExpression' ||
        (node.type === 'LogicalExpression' && (node.operator === '&&' || node.operator === '||'));
      if (isConditionalLike && producesJsx(node)) {
        hits.push({ kind: 'conditional', node });
      } else if (isLoopRenderCall(node)) {
        hits.push({ kind: 'loop', node });
      }
    },
  });
  return hits.sort((a, b) => a.node.range[0] - b.node.range[0]);
}

/**
 * A component/page's overall JSX complexity: the deepest `JSXElement`/
 * `JSXFragment` nesting (`maxDepth`) and the number of inline
 * conditional/loop-rendering points `collectInlineJsxLogic` finds
 * (`branchCount`) -- COMPONENT-006's budget (and a future PAGE-009's),
 * deliberately separate from any one Expression's own EXPR-002 cap: this
 * measures the composing unit's own JSX, not any one piece extracted out of
 * it.
 *
 * @param {object} ast A parsed Program.
 * @returns {{maxDepth: number, branchCount: number}}
 *
 * @example
 * computeJsxComplexity(parseToAst('const C = () => <div><span/></div>;'));
 * // => { maxDepth: 2, branchCount: 0 }
 */
export function computeJsxComplexity(ast) {
  let depth = 0;
  let maxDepth = 0;
  walkAst(ast, {
    enter(node) {
      if (node.type === 'JSXElement' || node.type === 'JSXFragment') {
        depth += 1;
        if (depth > maxDepth) maxDepth = depth;
      }
    },
    leave(node) {
      if (node.type === 'JSXElement' || node.type === 'JSXFragment') depth -= 1;
    },
  });
  return { maxDepth, branchCount: collectInlineJsxLogic(ast).length };
}
