// AST package: the effects and configuration reads of one Node module for `construct summarize --backend` (#634):
// file-system, child-process, network and timer calls, `process.env` names, and the trivially detectable
// `if (url === '/x')` routes of a plain `http.createServer` handler. Pure reads over a parsed Program; the
// bindings come from `collectBackendFacts`, so `fs.readFileSync` is an fs effect only when `fs` is the imported
// module, and a local variable that happens to be called `fs` is not. No model, no guessing.
import { walk as walkAst } from 'estree-walker';
import { collectSecretEnvReads } from './clientBoundary.mjs';
import { unwrapExpression, memberPath } from './backendFacts.mjs';

const FN_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
const norm = (spec) => spec.replace(/^node:/, '');
const FS = new Set(['fs', 'fs/promises']);
const CP = new Set(['child_process']);
const HTTP = new Set(['http', 'https', 'http2', 'net', 'tls', 'dgram']);
const HTTP_CALLS = new Set(['request', 'get', 'createServer', 'connect', 'createConnection', 'createSecureServer']);
const HTTP_CLIENT_PACKAGES = new Set(['axios', 'got', 'node-fetch', 'undici', 'superagent', 'ky']);
const WS_PACKAGES = new Set(['ws']);
const TIMERS = new Set(['setTimeout', 'setInterval', 'setImmediate']);

/**
 * Every `process.env` variable a module reads, by NAME only (never a value), in source order:
 * `process.env.X`, `process.env['X']`, `process.env?.X` and `const { X } = process.env`. Unlike the
 * client-boundary variant no name is treated as public: a backend read of `NODE_ENV` is a read.
 *
 * @param {object} ast A parsed Program (from `parseToAst`).
 * @param {string} source The source text the AST was parsed from.
 * @returns {{name:string, line:number}[]} Each read with its variable name and 1-based line.
 *
 * @example
 * collectEnvReads(parseToAst('const p = process.env.PORT;'), 'const p = process.env.PORT;'); // => [{ name: 'PORT', line: 1 }]
 */
export function collectEnvReads(ast, source) {
  return collectSecretEnvReads(ast, source, { publicPrefixes: [], publicNames: [] }).map(({ name, line }) => ({ name, line }));
}

/**
 * The effects a module performs, in source order: file system (`fs`, `fs/promises`), child processes
 * (`child_process`), network (global `fetch`, `http`/`https`/`net` requests and servers, `ws`, HTTP client
 * packages, `app.listen`) and timers (`setTimeout`, `setInterval`, `setImmediate`). Only calls whose callee is
 * bound to the real module count.
 *
 * @param {object} ast A parsed Program (from `parseToAst`).
 * @param {{lookup: Function, functions: Map}} facts The result of `collectBackendFacts` for the same source.
 * @returns {{kind:'fs'|'child_process'|'network'|'timer', op:string, line:number}[]} One entry per call, in source order.
 *
 * @example
 * collectEffects(ast, facts); // => [{ kind: 'fs', op: 'readFileSync', line: 4 }]
 */
export function collectEffects(ast, facts) {
  const out = [];
  const chainStack = ['m'];
  const chain = () => chainStack.slice().reverse();
  const push = (kind, op, node) => out.push({ kind, op, line: node.loc.start.line, index: node.range[0] });
  const moduleOf = (name) => {
    const d = facts.lookup(chain(), name);
    return d?.kind === 'import' ? d : null;
  };
  const isNamespace = (d) => d.imported === 'default' || d.imported === '*' || d.imported === 'promises';

  walkAst(ast, {
    enter(node) {
      if (FN_TYPES.has(node.type)) { chainStack.push(`f${node.range[0]}`); return; }
      if (node.type === 'NewExpression') {
        const c = unwrapExpression(node.callee);
        const p = memberPath(c);
        const head = p?.split('.')[0];
        const d = head ? moduleOf(head) : null;
        if (d && WS_PACKAGES.has(d.specifier)) push('network', /Server/.test(p) || d.imported === 'WebSocketServer' ? 'websocket-server' : 'websocket-client', node);
        else if (!d && p === 'WebSocket' && !facts.lookup(chain(), 'WebSocket')) push('network', 'websocket-client', node);
        return;
      }
      if (node.type !== 'CallExpression') return;
      const callee = unwrapExpression(node.callee);
      if (callee.type === 'Identifier') {
        const d = moduleOf(callee.name);
        if (d) {
          const spec = norm(d.specifier);
          if (FS.has(spec) && !isNamespace(d)) push('fs', d.imported, node);
          else if (CP.has(spec) && !isNamespace(d)) push('child_process', d.imported, node);
          else if (HTTP.has(spec) && !isNamespace(d) && HTTP_CALLS.has(d.imported)) push('network', `${spec}.${d.imported}`, node);
          else if (HTTP_CLIENT_PACKAGES.has(spec) && isNamespace(d)) push('network', spec, node);
        } else if (!facts.lookup(chain(), callee.name)) {
          if (callee.name === 'fetch') push('network', 'fetch', node);
          else if (TIMERS.has(callee.name)) push('timer', callee.name, node);
        }
        return;
      }
      if (callee.type !== 'MemberExpression' || callee.computed || callee.property.type !== 'Identifier') return;
      const method = callee.property.name;
      const objPath = memberPath(callee.object);
      if (!objPath) return;
      const parts = objPath.split('.');
      const d = moduleOf(parts[0]);
      if (d) {
        const spec = norm(d.specifier);
        const nsOk = parts.length === 1 ? isNamespace(d) : parts.length === 2 && parts[1] === 'promises' && isNamespace(d);
        if (FS.has(spec) && nsOk) push('fs', method, node);
        else if (CP.has(spec) && nsOk) push('child_process', method, node);
        else if (HTTP.has(spec) && nsOk && HTTP_CALLS.has(method)) push('network', `${spec}.${method}`, node);
        else if (HTTP_CLIENT_PACKAGES.has(spec) && parts.length === 1 && isNamespace(d)) push('network', `${spec}.${method}`, node);
        return;
      }
      if (parts.length === 1) {
        const local = facts.lookup(chain(), parts[0]);
        if (method === 'listen' && (local?.kind === 'app' || local?.kind === 'server' || local?.kind === 'router')) push('network', 'listen', node);
        else if (!local && parts[0] === 'globalThis' && method === 'fetch') push('network', 'fetch', node);
      }
    },
    leave(node) {
      if (FN_TYPES.has(node.type)) chainStack.pop();
    },
  });
  return out.sort((a, b) => a.index - b.index).map(({ kind, op, line }) => ({ kind, op, line }));
}

const PATH_SUBJECT_NAMES = new Set(['url', 'pathname', 'path', 'pathName', 'route', 'reqUrl', 'requestUrl']);
const METHOD_SUBJECT_NAMES = new Set(['method', 'reqMethod']);

/** Whether `node` reads the request path: `req.url`, `request.url`, `x.pathname`, or a bare `url` / `pathname` / `path`. */
function isPathSubject(node) {
  const n = unwrapExpression(node);
  if (n?.type === 'Identifier') return PATH_SUBJECT_NAMES.has(n.name);
  return n?.type === 'MemberExpression' && !n.computed && n.property.type === 'Identifier' && (n.property.name === 'url' || n.property.name === 'pathname');
}
function isMethodSubject(node) {
  const n = unwrapExpression(node);
  if (n?.type === 'Identifier') return METHOD_SUBJECT_NAMES.has(n.name);
  return n?.type === 'MemberExpression' && !n.computed && n.property.type === 'Identifier' && n.property.name === 'method';
}
const stringOf = (n) => { const u = unwrapExpression(n); return u?.type === 'Literal' && typeof u.value === 'string' ? u.value : null; };

/** The `a && b && c` conjuncts of a test, flattened. */
function conjuncts(test) {
  const t = unwrapExpression(test);
  return t?.type === 'LogicalExpression' && t.operator === '&&' ? [...conjuncts(t.left), ...conjuncts(t.right)] : [t];
}

/** `[subject, literal]` when `b` is an equality between a subject (per `isSubject`) and a string literal, else null. */
function equalityWith(b, isSubject) {
  if (b?.type !== 'BinaryExpression' || (b.operator !== '===' && b.operator !== '==')) return null;
  if (isSubject(b.left) && stringOf(b.right) !== null) return stringOf(b.right);
  if (isSubject(b.right) && stringOf(b.left) !== null) return stringOf(b.left);
  return null;
}

/**
 * The routes of a plain Node request handler that are trivially detectable: an `if` whose test is a `&&` of an
 * equality between the request path (`req.url`, `pathname`, ...) and a string literal, optionally with an equality
 * on the method (`req.method === 'POST'`), and the `case '/x':` labels of a `switch (req.url)`. Anything else that
 * branches on the path (`startsWith`, a regular expression, a computed comparison) is counted, never guessed.
 *
 * @param {object} fnNode The handler function node (from `parseToAst`).
 * @returns {{routes: {method:string|null, path:string, line:number}[], otherBranches: number}} The detected routes (method `null` when the condition names none) and how many other path conditions were seen but not read.
 *
 * @example
 * collectHttpRoutes(handlerNode); // => { routes: [{ method: 'GET', path: '/health', line: 5 }], otherBranches: 0 }
 */
export function collectHttpRoutes(fnNode) {
  const routes = [];
  let otherBranches = 0;
  const mentionsPath = (n) => { let hit = false; walkAst(n, { enter(x) { if (isPathSubject(x)) hit = true; } }); return hit; };
  walkAst(fnNode.body, {
    enter(node) {
      if (node.type === 'IfStatement') {
        let path = null;
        let method = null;
        let other = false;
        for (const c of conjuncts(node.test)) {
          const p = equalityWith(c, isPathSubject);
          const m = equalityWith(c, isMethodSubject);
          if (p !== null && p.startsWith('/')) path = p;
          else if (m !== null) method = m.toUpperCase();
          else if (mentionsPath(c)) other = true;
        }
        if (path !== null) routes.push({ method, path, line: node.loc.start.line });
        else if (other) otherBranches += 1;
      } else if (node.type === 'SwitchStatement' && isPathSubject(node.discriminant)) {
        for (const c of node.cases) {
          const s = c.test ? stringOf(c.test) : null;
          if (s !== null && s.startsWith('/')) routes.push({ method: null, path: s, line: c.loc.start.line });
          else if (c.test) otherBranches += 1;
        }
      }
    },
  });
  return { routes: routes.sort((a, b) => a.line - b.line), otherBranches };
}
