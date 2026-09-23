// AST package: supersede-and-abort detection (#577/#594) -- the shape SERVICE-003 flags in a
// service file: a network call that is not cancellable by its caller. The invariant (see
// docs/staleness-by-layer.md, "Service") is that a response arriving after its request was
// superseded changes nothing; the guard is an `AbortSignal` the CALLER owns (XState's `fromPromise`
// hands the invoked function one, aborted when the invoking state exits; a hook owns one
// AbortController per request slot) and the service merely forwards to `fetch`.
//
// Two shapes are reported, each deterministic on the AST alone (no data flow, no type checker):
//   - `signature`: a service function that makes a network call but takes no `signal` from its
//     caller -- its first parameter is destructured without `signal`, or is typed with an object
//     type (inline, or a same-file interface/alias, or `defineService`'s first type argument) that
//     has no `signal` member, or the function has no parameters at all. Reported once, at the
//     function, and its calls are then NOT reported separately (one violation per problem).
//   - `call`: a `fetch(url, init)` / `axios(...)` / `axios.<method>(...)` whose init/config
//     argument is missing, or is an object literal with no `signal` property, inside a function
//     that does take a signal (or whose signature cannot be read) -- the signal exists but was not
//     forwarded.
//
// Deliberately conservative: an init that is not an object literal (`fetch(url, init)`), an object
// literal with a spread (`{ ...init }`), a parameter whose type is imported, or a `...rest`
// destructuring are all "cannot tell" and never reported. A file with no network call reports
// nothing at all.
import { walkAst } from './walk.mjs';

/** `axios.<method>(...)` members that take a config object. */
const AXIOS_METHODS = new Set(['get', 'delete', 'head', 'options', 'post', 'put', 'patch', 'request']);
/** For `axios.<method>(url, [data,] config)`: which argument is the config. */
const AXIOS_CONFIG_INDEX = { get: 1, delete: 1, head: 1, options: 1, post: 2, put: 2, patch: 2, request: 0 };
const FUNCTION_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

const keyName = (key) => (key?.type === 'Identifier' ? key.name : key?.type === 'Literal' ? String(key.value) : null);
const unwrapDefault = (p) => (p?.type === 'AssignmentPattern' ? p.left : p);

/**
 * Whether `node` is a network call this rule reads, and which of its arguments carries the
 * request init/config.
 *
 * @param {object} node Any AST node.
 * @returns {{callee: string, configIndex: number} | null} The callee text and config-argument position, or `null`.
 */
function networkCallShape(node) {
  if (node.type !== 'CallExpression') return null;
  const c = node.callee;
  if (c.type === 'Identifier' && c.name === 'fetch') return { callee: 'fetch', configIndex: 1 };
  if (c.type === 'Identifier' && c.name === 'axios') return { callee: 'axios', configIndex: 0 };
  if (c.type === 'MemberExpression' && !c.computed && c.object.type === 'Identifier' && c.object.name === 'axios'
    && c.property.type === 'Identifier' && AXIOS_METHODS.has(c.property.name)) {
    return { callee: `axios.${c.property.name}`, configIndex: AXIOS_CONFIG_INDEX[c.property.name] };
  }
  return null;
}

/**
 * Whether a call's init/config argument carries a `signal`.
 *
 * @param {object} call The CallExpression.
 * @param {number} configIndex Position of the init/config argument.
 * @returns {boolean | null} `true` when a `signal` property is present, `false` when the argument is missing or is an object literal without one, `null` when it cannot be read (an identifier, a spread).
 */
function callHasSignal(call, configIndex) {
  const arg = call.arguments[configIndex];
  if (!arg) return false;
  if (arg.type !== 'ObjectExpression') return null;
  if (arg.properties.some((p) => p.type === 'Property' && keyName(p.key) === 'signal')) return true;
  return arg.properties.some((p) => p.type === 'SpreadElement') ? null : false;
}

/**
 * Whether an object type has a `signal` member, resolving same-file interfaces and aliases.
 *
 * @param {object | undefined} t A TS type node.
 * @param {Map<string, object>} typeIndex Same-file `interface`/`type` declarations by name.
 * @param {Set<string>} [seen] Names already followed (guards recursive aliases).
 * @returns {boolean | null} `true`/`false` when readable, `null` when it cannot be resolved.
 */
function typeHasSignal(t, typeIndex, seen = new Set()) {
  if (!t) return null;
  if (t.type === 'TSTypeLiteral') return t.members.some((m) => m.type === 'TSPropertySignature' && keyName(m.key) === 'signal');
  if (t.type === 'TSInterfaceBody') return t.body.some((m) => m.type === 'TSPropertySignature' && keyName(m.key) === 'signal');
  if (t.type === 'TSIntersectionType') {
    const parts = t.types.map((x) => typeHasSignal(x, typeIndex, seen));
    return parts.includes(true) ? true : parts.includes(null) ? null : false;
  }
  if (t.type === 'TSTypeReference' && t.typeName.type === 'Identifier') {
    const name = t.typeName.name;
    if (seen.has(name)) return null;
    seen.add(name);
    const decl = typeIndex.get(name);
    if (!decl) return null;
    if (decl.type === 'TSInterfaceDeclaration') {
      const own = typeHasSignal(decl.body, typeIndex, seen);
      if (own === true) return true;
      const inherited = (decl.extends ?? []).map((h) => typeHasSignal({ type: 'TSTypeReference', typeName: h.expression }, typeIndex, seen));
      return inherited.includes(true) ? true : inherited.includes(null) || own === null ? null : false;
    }
    return typeHasSignal(decl.typeAnnotation, typeIndex, seen);
  }
  return null;
}

/**
 * Whether a service function takes a `signal` from its caller.
 *
 * @param {object} fn The function node.
 * @param {object | null} defineCall The `defineService(...)` call whose `fn` argument this is, if any (its first type argument types the props).
 * @param {Map<string, object>} typeIndex Same-file `interface`/`type` declarations by name.
 * @returns {boolean | null} `true`/`false` when readable, `null` when it cannot be told.
 */
function signatureTakesSignal(fn, defineCall, typeIndex) {
  const params = fn.params.map(unwrapDefault);
  if (params.some((p) => p.type === 'Identifier' && p.name === 'signal')) return true;
  const first = params[0];
  if (!first) return false;
  if (first.type === 'ObjectPattern') {
    if (first.properties.some((p) => p.type === 'Property' && keyName(p.key) === 'signal')) return true;
    return first.properties.some((p) => p.type === 'RestElement') ? null : false;
  }
  if (first.type !== 'Identifier') return null;
  const annotated = first.typeAnnotation?.typeAnnotation ?? defineCall?.typeArguments?.params?.[0];
  return typeHasSignal(annotated, typeIndex);
}

/**
 * The name a violation can call a service function by.
 *
 * @param {object} fn The function node.
 * @param {object | null} parent Its parent node.
 * @param {object | null} defineCall The `defineService(...)` call it is passed to, if any.
 * @returns {string} The function's name, the unit name, or `'(anonymous)'`.
 */
function functionName(fn, parent, defineCall) {
  if (fn.id?.name) return fn.id.name;
  if (defineCall?.arguments[0]?.type === 'Literal') return String(defineCall.arguments[0].value);
  if (parent?.type === 'VariableDeclarator' && parent.id.type === 'Identifier') return parent.id.name;
  return '(anonymous)';
}

/**
 * A one-line rendering of a call for a message: callee plus its first argument, truncated.
 *
 * @param {object} call The CallExpression.
 * @param {string} callee The callee text.
 * @param {string} source The file's source text.
 * @returns {string} e.g. `fetch('/api/orders')`.
 */
function callSnippet(call, callee, source) {
  const first = call.arguments[0];
  const arg = first ? source.slice(first.range[0], first.range[1]).replace(/\s+/g, ' ') : '';
  const shown = arg.length > 60 ? `${arg.slice(0, 57)}...` : arg;
  return `${callee}(${shown}${call.arguments.length > 1 ? ', ...' : ''})`;
}

/**
 * Every place a service file's network call escapes the caller's `AbortSignal` (see the file
 * comment for the two shapes and what is deliberately never reported).
 *
 * @param {object} ast A parsed Program (typescript-estree, with ranges).
 * @param {string} source The file's source text, for the call snippets.
 * @returns {{kind: 'signature' | 'call', index: number, name: string, callee: string, calls: string[]}[]}
 *   Sorted by offset. `signature`: `index` is the function's, `calls` every network call inside it;
 *   `call`: `index` is the call's, `calls` is that one call.
 */
export function collectUnsignalledNetworkCalls(ast, source) {
  const typeIndex = new Map();
  for (const stmt of ast.body) {
    const decl = stmt.type === 'ExportNamedDeclaration' ? stmt.declaration : stmt;
    if (decl && (decl.type === 'TSInterfaceDeclaration' || decl.type === 'TSTypeAliasDeclaration')) typeIndex.set(decl.id.name, decl);
  }
  /** @type {Map<object, {fn: object, parent: object|null, defineCall: object|null, calls: object[]}>} */
  const byFunction = new Map();
  const topLevelCalls = [];
  const defineCallByFn = new Map();
  const defineCallByName = new Map();
  const stack = [];
  walkAst(ast, {
    enter(node, parent) {
      if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'defineService') {
        const fnArg = node.arguments[1];
        if (fnArg?.type === 'Identifier') defineCallByName.set(fnArg.name, node);
        else if (fnArg) defineCallByFn.set(fnArg, node);
      }
      if (FUNCTION_TYPES.has(node.type)) {
        stack.push(node);
        if (stack.length === 1) byFunction.set(node, { fn: node, parent, defineCall: null, calls: [] });
        return;
      }
      const shape = networkCallShape(node);
      if (!shape) return;
      const entry = { node, ...shape, hasSignal: callHasSignal(node, shape.configIndex) };
      if (stack.length) byFunction.get(stack[0]).calls.push(entry);
      else topLevelCalls.push(entry);
    },
    leave(node) {
      if (FUNCTION_TYPES.has(node.type)) stack.pop();
    },
  });

  const out = [];
  const pushCall = (c) => out.push({ kind: 'call', index: c.node.range[0], name: c.callee, callee: c.callee, calls: [callSnippet(c.node, c.callee, source)] });
  for (const { fn, parent, calls } of byFunction.values()) {
    if (!calls.length) continue;
    const defineCall = defineCallByFn.get(fn) ?? (fn.id ? defineCallByName.get(fn.id.name) : null) ?? null;
    if (signatureTakesSignal(fn, defineCall, typeIndex) === false) {
      out.push({
        kind: 'signature', index: fn.range[0], name: functionName(fn, parent, defineCall), callee: calls[0].callee,
        calls: calls.map((c) => callSnippet(c.node, c.callee, source)),
      });
      continue;
    }
    for (const c of calls) if (c.hasSignal === false) pushCall(c);
  }
  for (const c of topLevelCalls) if (c.hasSignal === false) pushCall(c);
  return out.sort((a, b) => a.index - b.index);
}
