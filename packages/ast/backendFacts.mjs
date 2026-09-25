// AST package: the per-file facts `construct summarize --backend` (#634) is built from -- what one Node/Express
// module declares, imports, exports and registers. Pure reads over a parsed Program: no file system, no module
// resolution across files, no roles (packages/core/backend-summary.mjs does that). Deterministic, no model.
//
// Model. Every function-like node is a scope with an id (`f<offset>`); the module is scope `m`. A declaration is
// recorded per scope (`decls`), so two factories in one file that both declare `const router` stay apart. A
// receiver is something route calls are made on: `const app = express()`, `const router = express.Router()`, or a
// function parameter that is used as `param.get('/x', ...)` (a route registrar such as `mountRoutes(app)`). Each
// receiver keeps an ordered timeline of events: a route, a `use`, or a call that hands the receiver to another
// function. The cross-file walk (mounts, factories, registrars) replays those timelines.
import { walk as walkAst } from 'estree-walker';

/** HTTP methods Express exposes as `receiver.<method>(path, ...handlers)`. */
export const ROUTE_METHODS = Object.freeze(['get', 'post', 'put', 'patch', 'delete', 'all', 'head', 'options']);
const METHOD_SET = new Set(ROUTE_METHODS);
const FN_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
const TS_WRAPPERS = new Set(['TSAsExpression', 'TSNonNullExpression', 'TSSatisfiesExpression', 'TSTypeAssertion', 'ParenthesizedExpression']);

/**
 * Strip type-only wrappers (`x as T`, `x!`, `x satisfies T`) so the expression underneath is what gets read.
 *
 * @param {object} node An ESTree node (or null).
 * @returns {object} The inner expression, or `node` itself.
 */
export function unwrapExpression(node) {
  let n = node;
  while (n && TS_WRAPPERS.has(n.type)) n = n.expression;
  return n;
}

const clip = (s, n = 90) => (s.length > n ? `${s.slice(0, n - 3)}...` : s);

/** A short one-line rendering of a node's source text. */
function textOf(source, node) {
  return clip(source.slice(node.range[0], node.range[1]).replace(/\s+/g, ' ').trim());
}

/**
 * `a.b.c` for a chain of non-computed member accesses on an identifier, else null.
 *
 * @param {object} node An ESTree expression.
 * @returns {string|null} The dotted path, or `null` when the expression is anything else (a call, a computed access).
 *
 * @example
 * memberPath(parseToAst('auth.requireSession').body[0].expression); // => 'auth.requireSession'
 */
export function memberPath(node) {
  const n = unwrapExpression(node);
  if (n?.type === 'Identifier') return n.name;
  if (n?.type === 'MemberExpression' && !n.computed && n.property.type === 'Identifier') {
    const base = memberPath(n.object);
    return base ? `${base}.${n.property.name}` : null;
  }
  return null;
}

/**
 * Collect the facts of one module for the backend summary.
 *
 * @param {object} ast A parsed Program (from `parseToAst`).
 * @param {string} source The source text the AST was parsed from.
 * @returns {object} `{ imports, exports, decls, functions, receivers, httpServers, lookup }`: imports with their bindings, the export table, declarations per scope, function records (with the receivers they return), receivers with their ordered event timelines, `http.createServer` calls, and `lookup(chain, name)`.
 *
 * @example
 * const facts = collectBackendFacts(parseToAst("import express from 'express'; const app = express(); app.get('/a', h);"), src);
 * [...facts.receivers.values()][0].events[0].method; // => 'GET'
 */
export function collectBackendFacts(ast, source) {
  const decls = new Map([['m', new Map()]]);
  const functions = new Map();
  const imports = [];
  const exportsTable = new Map();
  const starExports = [];

  const declare = (scope, name, decl) => {
    if (!decls.has(scope)) decls.set(scope, new Map());
    const m = decls.get(scope);
    if (!m.has(name)) m.set(name, { name, scopeId: scope, ...decl });
  };
  const lookup = (chain, name) => {
    for (const id of chain) {
      const d = decls.get(id)?.get(name);
      if (d) return d;
    }
    return null;
  };

  const requireSpecifier = (init) => {
    const c = unwrapExpression(init);
    if (c?.type === 'CallExpression' && c.callee.type === 'Identifier' && c.callee.name === 'require' && c.arguments[0]?.type === 'Literal' && typeof c.arguments[0].value === 'string') return c.arguments[0].value;
    return null;
  };

  // ---- pass 1: declarations, imports, exports, function records ----
  const stack = ['m'];
  const fnNodes = new Map(); // node -> id
  walkAst(ast, {
    enter(node) {
      if (FN_TYPES.has(node.type)) {
        const id = `f${node.range[0]}`;
        fnNodes.set(node, id);
        const chain = [id, ...stack.slice().reverse()];
        const record = { id, node, name: node.id?.name ?? null, line: node.loc.start.line, params: [], chain, returnNodes: [], parentScope: stack[stack.length - 1] };
        functions.set(id, record);
        if (node.type === 'FunctionDeclaration' && node.id) declare(stack[stack.length - 1], node.id.name, { kind: 'function', fnId: id, line: node.loc.start.line });
        node.params.forEach((p, i) => {
          const target = p.type === 'AssignmentPattern' ? p.left : p;
          if (target.type === 'Identifier') {
            record.params.push(target.name);
            declare(id, target.name, { kind: 'param', fnId: id, index: i });
          } else record.params.push(null);
        });
        if (node.type === 'ArrowFunctionExpression' && node.body.type !== 'BlockStatement') record.returnNodes.push(node.body);
        stack.push(id);
        return;
      }
      const scope = stack[stack.length - 1];
      if (node.type === 'ImportDeclaration') {
        if (node.importKind === 'type') return;
        const bindings = [];
        for (const s of node.specifiers) {
          if (s.importKind === 'type') continue;
          const imported = s.type === 'ImportDefaultSpecifier' ? 'default' : s.type === 'ImportNamespaceSpecifier' ? '*' : (s.imported.name ?? s.imported.value);
          bindings.push({ local: s.local.name, imported });
          declare('m', s.local.name, { kind: 'import', specifier: node.source.value, imported, line: node.loc.start.line });
        }
        imports.push({ specifier: node.source.value, kind: 'import', line: node.loc.start.line, bindings });
      } else if (node.type === 'VariableDeclarator') {
        const init = unwrapExpression(node.init);
        const req = requireSpecifier(init);
        if (node.id.type === 'Identifier') {
          if (req) {
            declare(scope, node.id.name, { kind: 'import', specifier: req, imported: 'default', line: node.loc.start.line });
            imports.push({ specifier: req, kind: 'require', line: node.loc.start.line, bindings: [{ local: node.id.name, imported: 'default' }] });
          } else if (init?.type === 'MemberExpression' && !init.computed && init.property.type === 'Identifier' && requireSpecifier(init.object)) {
            const spec = requireSpecifier(init.object);
            declare(scope, node.id.name, { kind: 'import', specifier: spec, imported: init.property.name, line: node.loc.start.line });
            imports.push({ specifier: spec, kind: 'require', line: node.loc.start.line, bindings: [{ local: node.id.name, imported: init.property.name }] });
          } else if (init && FN_TYPES.has(init.type)) {
            declare(scope, node.id.name, { kind: 'function', fnId: `f${init.range[0]}`, line: node.loc.start.line });
          } else if (init?.type === 'Literal' && typeof init.value === 'string') {
            declare(scope, node.id.name, { kind: 'string', value: init.value });
          } else declare(scope, node.id.name, { kind: 'unknown', init, line: node.loc.start.line });
        } else if (node.id.type === 'ObjectPattern' && req) {
          const bindings = [];
          for (const p of node.id.properties) {
            if (p.type !== 'Property' || p.computed || p.value.type !== 'Identifier') continue;
            const imported = p.key.type === 'Identifier' ? p.key.name : p.key.value;
            bindings.push({ local: p.value.name, imported });
            declare(scope, p.value.name, { kind: 'import', specifier: req, imported, line: node.loc.start.line });
          }
          imports.push({ specifier: req, kind: 'require', line: node.loc.start.line, bindings });
        }
      } else if (node.type === 'ExportNamedDeclaration' && node.exportKind !== 'type') {
        const d = node.declaration;
        if (d?.type === 'FunctionDeclaration' && d.id) exportsTable.set(d.id.name, { local: d.id.name });
        else if (d?.type === 'VariableDeclaration') for (const v of d.declarations) if (v.id.type === 'Identifier') exportsTable.set(v.id.name, { local: v.id.name });
        for (const s of node.specifiers) {
          if (s.exportKind === 'type') continue;
          const exported = s.exported.name ?? s.exported.value;
          exportsTable.set(exported, node.source ? { reexport: { specifier: node.source.value, imported: s.local.name ?? s.local.value } } : { local: s.local.name });
        }
        if (node.source) imports.push({ specifier: node.source.value, kind: 'reexport', line: node.loc.start.line, bindings: [] });
      } else if (node.type === 'ExportAllDeclaration' && node.exportKind !== 'type') {
        starExports.push(node.source.value);
        imports.push({ specifier: node.source.value, kind: 'reexport', line: node.loc.start.line, bindings: [] });
      } else if (node.type === 'ExportDefaultDeclaration') {
        const d = unwrapExpression(node.declaration);
        if (d.type === 'Identifier') exportsTable.set('default', { local: d.name });
        else if (d.type === 'FunctionDeclaration' && d.id) exportsTable.set('default', { local: d.id.name });
        else if (FN_TYPES.has(d.type)) exportsTable.set('default', { fn: `f${d.range[0]}` });
      } else if (node.type === 'ExpressionStatement' && node.expression.type === 'AssignmentExpression' && node.expression.operator === '=') {
        const left = memberPath(node.expression.left);
        const right = unwrapExpression(node.expression.right);
        const setTarget = (name, value) => {
          if (value.type === 'Identifier') exportsTable.set(name, { local: value.name });
          else if (FN_TYPES.has(value.type)) exportsTable.set(name, { fn: `f${value.range[0]}` });
        };
        if (left === 'module.exports') {
          if (right.type === 'ObjectExpression') {
            for (const p of right.properties) if (p.type === 'Property' && !p.computed) setTarget(p.key.type === 'Identifier' ? p.key.name : p.key.value, unwrapExpression(p.value));
          } else setTarget('default', right);
        } else if (left && /^(module\.)?exports\.[A-Za-z_$][\w$]*$/.test(left)) setTarget(left.split('.').pop(), right);
      } else if (node.type === 'ReturnStatement' && node.argument) {
        const owner = functions.get(scope);
        if (owner) owner.returnNodes.push(node.argument);
      } else if (node.type === 'AssignmentExpression' && node.operator === '=' && node.left.type === 'Identifier') {
        // `let auth; ... auth = createAuth(...)`: remember the value, so `auth.mountRoutes(app)` can be followed
        const d = lookup(stack.slice().reverse(), node.left.name);
        if (d && d.kind === 'unknown' && !d.init && !d.assigned) d.assigned = node.right;
      } else if (node.type === 'ImportExpression') {
        const src = node.source;
        if (src?.type === 'Literal' && typeof src.value === 'string') imports.push({ specifier: src.value, kind: 'dynamic', line: node.loc.start.line, bindings: [] });
      } else if (node.type === 'CallExpression' && requireSpecifier(node)) {
        imports.push({ specifier: requireSpecifier(node), kind: 'require', line: node.loc.start.line, bindings: [] });
      }
    },
    leave(node) {
      if (FN_TYPES.has(node.type)) stack.pop();
    },
  });

  // ---- classify variable declarations now that every import is known ----
  const isImportOf = (d, spec, imported) => d?.kind === 'import' && d.specifier === spec && (imported === undefined || d.imported === imported);
  const expressKind = (init, chain) => {
    const c = unwrapExpression(init);
    if (c?.type !== 'CallExpression') return null;
    const callee = unwrapExpression(c.callee);
    if (callee.type === 'Identifier') {
      const d = lookup(chain, callee.name);
      if (isImportOf(d, 'express', 'default')) return 'app';
      if (isImportOf(d, 'express', 'Router')) return 'router';
      return null;
    }
    if (callee.type === 'CallExpression' && requireSpecifier(callee) === 'express') return 'app'; // require('express')()
    if (callee.type === 'MemberExpression' && !callee.computed && callee.property.name === 'Router') {
      const obj = unwrapExpression(callee.object);
      if (obj.type === 'Identifier') {
        const d = lookup(chain, obj.name);
        if (isImportOf(d, 'express', 'default') || isImportOf(d, 'express', '*')) return 'router';
      } else if (requireSpecifier(obj) === 'express') return 'router'; // require('express').Router()
    }
    return null;
  };
  const isCreateServer = (callee, chain) => {
    const c = unwrapExpression(callee);
    if (c.type === 'Identifier') {
      const d = lookup(chain, c.name);
      return d?.kind === 'import' && /^(node:)?https?$/.test(d.specifier) && d.imported === 'createServer';
    }
    if (c.type === 'MemberExpression' && !c.computed && c.object.type === 'Identifier' && c.property.name === 'createServer') {
      const d = lookup(chain, c.object.name);
      return d?.kind === 'import' && /^(node:)?https?$/.test(d.specifier);
    }
    return false;
  };
  for (const [scope, m] of decls) {
    const chain = scope === 'm' ? ['m'] : [...functions.get(scope).chain];
    for (const d of m.values()) {
      if (d.kind !== 'unknown') continue;
      const ek = expressKind(d.init, chain);
      if (ek) d.kind = ek;
      else if (d.init?.type === 'CallExpression' && isCreateServer(d.init.callee, chain)) d.kind = 'server';
      else if (d.init?.type === 'CallExpression' && unwrapExpression(d.init.callee).type === 'MemberExpression' && memberPath(d.init.callee.object) && lookup(chain, memberPath(d.init.callee.object))?.kind === 'app' && d.init.callee.property.name === 'listen') d.kind = 'server';
      else d.kind = 'other';
    }
  }

  // ---- pass 2: receivers and their event timelines ----
  const receivers = new Map();
  const httpServers = [];
  const receiverFor = (decl, name) => {
    const key = `${decl.scopeId}:${name}`;
    if (!receivers.has(key)) receivers.set(key, { key, name, kind: decl.kind, scopeId: decl.scopeId, line: decl.line ?? null, events: [] });
    return receivers.get(key);
  };
  const receiverOf = (objectNode, chain, { strict }) => {
    const n = unwrapExpression(objectNode);
    if (n?.type !== 'Identifier') return null;
    const d = lookup(chain, n.name);
    if (!d) return null;
    if (d.kind === 'app' || d.kind === 'router') return receiverFor(d, n.name);
    if (d.kind === 'param' && strict) return receiverFor(d, n.name);
    return null;
  };

  const constString = (node, chain) => {
    const n = unwrapExpression(node);
    if (n?.type === 'Literal' && typeof n.value === 'string') return n.value;
    if (n?.type === 'TemplateLiteral' && n.expressions.length === 0) return n.quasis[0].value.cooked;
    if (n?.type === 'Identifier') {
      const d = lookup(chain, n.name);
      return d?.kind === 'string' ? d.value : null;
    }
    if (n?.type === 'BinaryExpression' && n.operator === '+') {
      const a = constString(n.left, chain);
      const b = constString(n.right, chain);
      return a !== null && b !== null ? a + b : null;
    }
    return null;
  };
  // A route/mount path argument -> list of { path|null, text, dynamic }.
  const pathsOf = (node, chain) => {
    const n = unwrapExpression(node);
    if (n?.type === 'ArrayExpression') return n.elements.filter(Boolean).flatMap((e) => pathsOf(e, chain));
    const s = constString(n, chain);
    if (s !== null) return [{ path: s, text: s, dynamic: false }];
    if (n?.type === 'TemplateLiteral') return [{ path: null, text: clip(source.slice(n.range[0] + 1, n.range[1] - 1).replace(/\s+/g, ' ')), dynamic: true }];
    return [{ path: null, text: textOf(source, n), dynamic: true }];
  };
  const isPathArg = (node, chain) => {
    const n = unwrapExpression(node);
    if (!n) return false;
    if (n.type === 'ArrayExpression') return n.elements.length > 0 && n.elements.every((e) => e && isPathArg(e, chain));
    if (n.type === 'Literal') return typeof n.value === 'string' || n.regex !== undefined;
    if (n.type === 'TemplateLiteral') return true;
    if (n.type === 'Identifier') return constString(n, chain) !== null;
    if (n.type === 'BinaryExpression') return constString(n, chain) !== null;
    return false;
  };

  // Describe a handler/middleware argument: a name, whether it is inline, and where its binding points.
  const describe = (node, chain) => {
    const n = unwrapExpression(node);
    if (n.type === 'SpreadElement') return [{ text: `...${textOf(source, n.argument)}`, name: `...${textOf(source, n.argument)}`, kind: 'other', inline: false }];
    if (n.type === 'ArrayExpression') return n.elements.filter(Boolean).flatMap((e) => describe(e, chain));
    if (FN_TYPES.has(n.type)) return [{ text: '(inline)', name: n.id?.name ?? null, kind: 'function', inline: true, line: n.loc.start.line, errorHandler: n.params.length === 4 }];
    if (n.type === 'Identifier') {
      const d = lookup(chain, n.name);
      if (d?.kind === 'import') return [{ text: n.name, name: d.imported === 'default' || d.imported === '*' ? n.name : d.imported, kind: 'ident', inline: false, binding: { kind: 'import', specifier: d.specifier, imported: d.imported } }];
      return [{ text: n.name, name: n.name, kind: 'ident', inline: false, binding: { kind: d?.kind === 'function' ? 'local' : 'unknown' } }];
    }
    if (n.type === 'MemberExpression') {
      const p = memberPath(n);
      const head = p?.split('.')[0];
      const d = head ? lookup(chain, head) : null;
      if (p && d?.kind === 'import' && p.split('.').length === 2) return [{ text: p, name: p, kind: 'member', inline: false, binding: { kind: 'import', specifier: d.specifier, imported: n.property.name, viaNamespace: true } }];
      return [{ text: p ?? textOf(source, n), name: p ?? textOf(source, n), kind: 'member', inline: false, binding: { kind: 'unknown' } }];
    }
    if (n.type === 'CallExpression') {
      const callee = memberPath(n.callee) ?? textOf(source, n.callee);
      return [{ text: `${callee}(...)`, name: `${callee}(...)`, kind: 'call', inline: false, wrapper: callee }];
    }
    return [{ text: textOf(source, n), name: textOf(source, n), kind: 'other', inline: false }];
  };

  const chainStack = ['m'];
  const chainNow = () => chainStack.slice().reverse();
  // `router.route('/x')` base of a chain `router.route('/x').get(...).post(...)`, or null.
  const routeChainBase = (call, chain) => {
    let obj = unwrapExpression(call.callee.object);
    while (obj?.type === 'CallExpression' && obj.callee.type === 'MemberExpression' && !obj.callee.computed) {
      const prop = obj.callee.property.name;
      if (prop === 'route') {
        const rcv = receiverOf(obj.callee.object, chain, { strict: false });
        return rcv ? { receiver: rcv, pathNode: obj.arguments[0] } : null;
      }
      if (!METHOD_SET.has(prop)) return null;
      obj = unwrapExpression(obj.callee.object);
    }
    return null;
  };

  walkAst(ast, {
    enter(node) {
      if (FN_TYPES.has(node.type)) { chainStack.push(`f${node.range[0]}`); return; }
      if (node.type !== 'CallExpression') return;
      const chain = chainNow();
      const callee = unwrapExpression(node.callee);
      const line = node.loc.start.line;
      const index = node.range[0];
      if (isCreateServer(callee, chain)) httpServers.push({ line, index, handler: node.arguments[node.arguments.length - 1] ?? null, chain });
      if (callee.type === 'MemberExpression' && !callee.computed && callee.property.type === 'Identifier') {
        const method = callee.property.name;
        if (METHOD_SET.has(method) || method === 'use') {
          const first = node.arguments[0];
          const firstIsRoutePath = first && isPathArg(first, chain) && (() => { const f = unwrapExpression(first); return f.type !== 'Literal' || /^[/*]/.test(String(f.value)); })();
          const rcv = receiverOf(callee.object, chain, { strict: false }) ?? (firstIsRoutePath ? receiverOf(callee.object, chain, { strict: true }) : null);
          if (rcv && method === 'use') {
            const args = node.arguments;
            const hasPath = args.length > 0 && isPathArg(args[0], chain);
            const rest = hasPath ? args.slice(1) : args;
            if (rest.length > 0) rcv.events.push({ type: 'use', paths: hasPath ? pathsOf(args[0], chain) : null, args: rest, described: rest.flatMap((a) => describe(a, chain)), chain, line, index });
          } else if (rcv) {
            const [path, ...rest] = node.arguments;
            if (path && rest.length > 0) {
              const handlers = rest.flatMap((a) => describe(a, chain));
              rcv.events.push({ type: 'route', method: method.toUpperCase(), paths: pathsOf(path, chain), middleware: handlers.slice(0, -1), handler: handlers[handlers.length - 1], line, index });
            }
          } else if (METHOD_SET.has(method)) {
            // chained: receiver.route('/x').get(...).post(...)
            const base = routeChainBase(node, chain);
            const handlers = base ? node.arguments.flatMap((a) => describe(a, chain)) : [];
            if (base && handlers.length > 0) base.receiver.events.push({ type: 'route', method: method.toUpperCase(), paths: base.pathNode ? pathsOf(base.pathNode, chain) : [{ path: null, text: '(unknown)', dynamic: true }], middleware: handlers.slice(0, -1), handler: handlers[handlers.length - 1], line: callee.property.loc.start.line, index: callee.property.range[0], chained: true });
          }
        }
      }
      // a call that hands a receiver to another function: mountRoutes(app), auth.mountRoutes(app)
      const isReceiverMethod = callee.type === 'MemberExpression' && receiverOf(callee.object, chain, { strict: false });
      if (!isReceiverMethod) {
        node.arguments.forEach((a, argIndex) => {
          const an = unwrapExpression(a);
          if (an?.type !== 'Identifier') return;
          const d = lookup(chain, an.name);
          if (d?.kind !== 'app' && d?.kind !== 'router' && d?.kind !== 'param') return;
          receiverFor(d, an.name).events.push({ type: 'call', callee, argIndex, chain, line, index });
        });
      }
    },
    leave(node) {
      if (FN_TYPES.has(node.type)) chainStack.pop();
    },
  });
  for (const r of receivers.values()) r.events.sort((a, b) => a.index - b.index);

  // ---- the receivers each function returns (router factories) ----
  for (const fn of functions.values()) {
    fn.returns = [];
    for (const rn of fn.returnNodes) {
      const n = unwrapExpression(rn);
      if (n?.type !== 'Identifier') continue;
      const d = lookup(fn.chain, n.name);
      if (d?.kind === 'router') fn.returns.push(`${d.scopeId}:${n.name}`);
    }
  }

  // one entry per (specifier, kind, line); the one that carries the bindings wins
  const merged = new Map();
  for (const im of imports) {
    const k = `${im.specifier}\u0000${im.kind}\u0000${im.line}`;
    const prev = merged.get(k);
    if (!prev) merged.set(k, { ...im, bindings: [...im.bindings] });
    else prev.bindings.push(...im.bindings.filter((b) => !prev.bindings.some((x) => x.local === b.local)));
  }
  imports.length = 0;
  imports.push(...merged.values());

  return { imports, exports: exportsTable, starExports, decls, functions, receivers, httpServers, lookup, describe, source };
}

/**
 * The module specifiers a file imports at run time: static imports, re-exports, `require('...')` and literal dynamic `import('...')`,
 * each with its 1-based line. Type-only imports are left out (they are erased).
 *
 * @param {{imports: {specifier: string, kind: string, line: number}[]}} facts The result of `collectBackendFacts`.
 * @returns {{specifier: string, kind: string, line: number}[]} The edges in source order.
 */
export function importEdgesOf(facts) {
  return facts.imports.map(({ specifier, kind, line }) => ({ specifier, kind, line })).sort((a, b) => a.line - b.line || (a.specifier < b.specifier ? -1 : 1));
}
