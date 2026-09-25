// AST package: the three "stale input" shapes of story #577 (docs/staleness-by-layer.md), one
// collector each, all deterministic and narrow (a heuristic, not a data-flow analysis):
//   - CONTROLLER-003 (#667): `collectControllerStateCalls` -- a controller that calls a
//     state/effect/memo hook (`useState`, `useRef`, ...) holds a copy of what the hook returned.
//   - HOOK-003 (#668): `collectUncleanedSubscriptions` -- a `useEffect`/`useLayoutEffect` whose
//     callback starts something that outlives it (listener, timer, subscription, controller,
//     socket) and returns nothing.
//   - ROUTE-003 (#669): `collectParamsReads` -- a route that reads `params`/`searchParams`
//     (member access, destructuring, `useParams()` destructuring) instead of forwarding them.
// Each returns `{ ..., index }` hits sorted by character offset; the enforcer turns them into
// violations (file:line via lineOf, message, why, suggestedFix).
import { walkAst } from './walk.mjs';

const isFunction = (n) => n?.type === 'ArrowFunctionExpression' || n?.type === 'FunctionExpression' || n?.type === 'FunctionDeclaration';

/** The hook name a call invokes: `useX(...)` or `React.useX(...)`, else null. */
function hookCallName(call) {
  const c = call.callee;
  if (c.type === 'Identifier') return c.name;
  if (c.type === 'MemberExpression' && !c.computed && c.object.type === 'Identifier' && c.object.name === 'React' && c.property.type === 'Identifier') return c.property.name;
  return null;
}

/** Hooks a controller may not call: each stores or derives a value that can outlive the render it was made in. */
export const CONTROLLER_STATE_HOOKS = new Set(['useState', 'useReducer', 'useRef', 'useEffect', 'useLayoutEffect', 'useMemo', 'useCallback']);

/**
 * Every call to a state, ref, effect or memo hook in a controller file.
 *
 * @param {object} ast A parsed Program.
 * @returns {{name: string, index: number}[]} Each call, sorted by offset.
 */
export function collectControllerStateCalls(ast) {
  const hits = [];
  walkAst(ast, {
    enter(node) {
      if (node.type !== 'CallExpression') return;
      const name = hookCallName(node);
      if (name && CONTROLLER_STATE_HOOKS.has(name)) hits.push({ name, index: node.range[0] });
    },
  });
  return hits.sort((a, b) => a.index - b.index);
}

const EFFECT_HOOKS = new Set(['useEffect', 'useLayoutEffect']);
/** Calls (bare or `obj.name(...)`) that start something needing an explicit stop. */
const SUBSCRIBE_CALLS = new Set(['addEventListener', 'setInterval', 'setTimeout', 'subscribe', 'on']);
/** `new X(...)` that starts something needing an explicit stop. */
const SUBSCRIBE_NEW = new Set(['AbortController', 'WebSocket', 'EventSource', 'MutationObserver', 'ResizeObserver', 'IntersectionObserver']);

function calleeName(call) {
  const c = call.callee;
  if (c.type === 'Identifier') return c.name;
  if (c.type === 'MemberExpression' && !c.computed && c.property.type === 'Identifier') return c.property.name;
  return null;
}

/** The first subscribe-shaped call or construction in the effect callback, not descending into a `return` (a returned cleanup body never counts as starting anything). */
function firstSubscription(fn) {
  let hit = null;
  walkAst(fn.body, {
    enter(node) {
      if (hit || node.type === 'ReturnStatement') { this.skip(); return; }
      let api = null;
      if (node.type === 'CallExpression') {
        const n = calleeName(node);
        if (n && SUBSCRIBE_CALLS.has(n)) api = n;
      } else if (node.type === 'NewExpression' && node.callee.type === 'Identifier' && SUBSCRIBE_NEW.has(node.callee.name)) {
        api = `new ${node.callee.name}`;
      }
      if (api) hit = { api, index: node.range[0] };
    },
  });
  return hit;
}

/** Whether the effect callback hands React something to run on cleanup: a `return <value>` in its own body (not in a nested function), or an expression body that is a value rather than a bare subscribe call. */
function returnsCleanup(fn) {
  if (fn.body.type !== 'BlockStatement') {
    const e = fn.body;
    if (isFunction(e) || e.type === 'Identifier') return true;
    return e.type === 'CallExpression' && ['subscribe', 'on'].includes(calleeName(e)); // `() => store.subscribe(cb)` returns the unsubscribe
  }
  let found = false;
  walkAst(fn.body, {
    enter(node) {
      if (found || isFunction(node)) { this.skip(); return; }
      if (node.type === 'ReturnStatement' && node.argument && !(node.argument.type === 'Identifier' && node.argument.name === 'undefined')) found = true;
    },
  });
  return found;
}

/**
 * Every `useEffect`/`useLayoutEffect` whose callback starts a subscribe-shaped thing and hands
 * React no cleanup. An effect with no subscribe-shaped call is never reported.
 *
 * @param {object} ast A parsed Program.
 * @returns {{effect: string, api: string, index: number}[]} Each effect, sorted by offset (index = the subscribe call).
 */
export function collectUncleanedSubscriptions(ast) {
  const hits = [];
  walkAst(ast, {
    enter(node) {
      if (node.type !== 'CallExpression') return;
      const name = hookCallName(node);
      if (!name || !EFFECT_HOOKS.has(name)) return;
      const fn = node.arguments[0];
      if (!isFunction(fn)) return;
      const sub = firstSubscription(fn);
      if (sub && !returnsCleanup(fn)) hits.push({ effect: name, api: sub.api, index: sub.index });
    },
  });
  return hits.sort((a, b) => a.index - b.index);
}

const PARAM_NAMES = new Set(['params', 'searchParams']);
const PARAM_HOOKS = new Set(['useParams', 'useSearchParams']);
const unwrapAwait = (n) => (n?.type === 'AwaitExpression' ? n.argument : n);

/**
 * Every place a route reads into its URL params instead of forwarding them: `params.id`,
 * `params['id']`, `searchParams.get(...)`, `(await params).id`, `const { id } = params` /
 * `= await params` / `= useParams()`, and `function Page({ params: { id } })`. Passing `params`
 * on whole (`<C params={params} />`) is never reported.
 *
 * @param {object} ast A parsed Program.
 * @returns {{name: string, index: number}[]} Each read, sorted by offset (name = the param source).
 */
export function collectParamsReads(ast) {
  const hits = [];
  const paramsRef = (n) => {
    const u = unwrapAwait(n);
    return u?.type === 'Identifier' && PARAM_NAMES.has(u.name) ? u.name : null;
  };
  const paramsHookCall = (n) => {
    const u = unwrapAwait(n);
    return u?.type === 'CallExpression' && u.callee.type === 'Identifier' && PARAM_HOOKS.has(u.callee.name) ? `${u.callee.name}()` : null;
  };
  walkAst(ast, {
    enter(node) {
      if (node.type === 'MemberExpression') {
        const name = paramsRef(node.object) || paramsHookCall(node.object);
        if (name) hits.push({ name, index: node.range[0] });
      } else if (node.type === 'VariableDeclarator' && node.id.type === 'ObjectPattern' && node.init) {
        const name = paramsRef(node.init) || paramsHookCall(node.init);
        if (name) hits.push({ name, index: node.range[0] });
      } else if (node.type === 'Property' && node.key.type === 'Identifier' && PARAM_NAMES.has(node.key.name) && node.value?.type === 'ObjectPattern') {
        hits.push({ name: node.key.name, index: node.range[0] }); // `{ params: { id } }` in a parameter list
      }
    },
  });
  return hits.sort((a, b) => a.index - b.index);
}
