// The route map of `construct summarize --backend` (#634): replays each Express app's event timeline across files,
// resolving `app.use('/prefix', createRouter(...))`, imported routers, router factories and route registrars
// (`mountRoutes(app)`), so every route carries its full path, handler, middleware and `file:line`. Deterministic,
// no model. What it cannot see statically is reported as "not detected", never guessed: a router whose
// factory does not return an `express.Router()` variable, a computed path, a mount through a function argument.
import { unwrapExpression } from '../../packages/ast/backendFacts.mjs';
import { collectHttpRoutes } from '../../packages/ast/backendEffects.mjs';

const MAX_DEPTH = 40;
const ROUTERISH = /router|routes|route|api/i;

/** Join a mount prefix and a route path the way Express does: `('/api', '/')` is `/api`, `('/api', '/:id')` is `/api/:id`. */
function joinPath(prefix, p) {
  const a = prefix === '/' ? '' : prefix;
  if (p === '' || p === '/') return a === '' ? '/' : a;
  const b = p.startsWith('/') ? p : `/${p}`;
  return `${a}${b}`.replace(/\/{2,}/g, '/');
}

/** Whether a middleware mounted at `pref` runs for a route at `full` (segment prefix; `:param` and `*` match any segment). */
function prefixMatches(pref, full) {
  const a = pref.split('/').filter(Boolean);
  const b = full.split('/').filter(Boolean);
  if (a.length > b.length) return false;
  return a.every((seg, i) => seg === b[i] || seg.startsWith(':') || b[i].startsWith(':') || seg === '*');
}

/**
 * Build the route map for a set of parsed backend files.
 *
 * @param {{files: Map<string, {facts: object}>, resolveImport: (fromRel: string, specifier: string) => string|null}} input `files` maps a project-relative path to its `collectBackendFacts` result (test files are left out by the caller); `resolveImport` maps a relative specifier to another scanned file, or `null`.
 * @returns {{routes: object[], mounts: object[], middleware: object[], unmounted: object[], unresolvedMounts: object[], httpServers: object[], apps: object[], framework: 'express'|'node-http'|'express+node-http'|'none'}} The route map: every route with full path, method, handler, own and inherited middleware, and source position; the mounts and `use` middleware in the order a request meets them; routers no app mounts; mounts that could not be read; plain `http.createServer` handlers with the routes that are trivially detectable.
 *
 * @example
 * const { routes } = mapRoutes({ files, resolveImport });
 * routes[0]; // => { method: 'GET', path: '/api/notes/:id', handler: { file: 'notesApi.mjs', name: null, inline: true }, ... }
 */
export function mapRoutes({ files, resolveImport }) {
  const factsOf = (file) => files.get(file)?.facts;
  const chainOfScope = (facts, scopeId) => (scopeId === 'm' ? ['m'] : [...facts.functions.get(scopeId).chain]);
  const importTarget = (file, specifier) => (specifier.startsWith('.') ? resolveImport(file, specifier) : null);

  // ---- resolving what a name, an export or an expression points at ----
  const fnReturns = (file, fnId, depth) => {
    const facts = factsOf(file);
    const fn = facts.functions.get(fnId);
    const out = fn.returns.map((key) => ({ file, key }));
    for (const rn of fn.returnNodes) {
      const n = unwrapExpression(rn);
      if (n?.type === 'CallExpression') out.push(...(routerFromExpr(file, fn.chain, n, depth + 1).routers ?? []));
    }
    return out;
  };
  const exportedRouter = (file, name, isCall, depth, seen = new Set()) => {
    const facts = factsOf(file);
    if (!facts || depth > MAX_DEPTH || seen.has(`${file}#${name}`)) return [];
    seen.add(`${file}#${name}`);
    const entry = facts.exports.get(name);
    if (!entry) {
      if (name === 'default') return [];
      return facts.starExports.flatMap((spec) => { const t = importTarget(file, spec); return t ? exportedRouter(t, name, isCall, depth + 1, seen) : []; });
    }
    if (entry.reexport) {
      const t = importTarget(file, entry.reexport.specifier);
      return t ? exportedRouter(t, entry.reexport.imported, isCall, depth + 1, seen) : [];
    }
    if (entry.fn) return isCall ? fnReturns(file, entry.fn, depth) : [];
    const d = facts.lookup(['m'], entry.local);
    if (!d) return [];
    if (d.kind === 'router') return isCall ? [] : [{ file, key: `${d.scopeId}:${d.name}` }];
    if (d.kind === 'function') return isCall ? fnReturns(file, d.fnId, depth) : [];
    if (d.kind === 'import') {
      const t = importTarget(file, d.specifier);
      return t ? exportedRouter(t, d.imported, isCall, depth + 1, seen) : [];
    }
    if (d.kind === 'unknown' && !isCall && d.init) return routerFromExpr(file, ['m'], d.init, depth + 1).routers ?? [];
    return [];
  };
  /** The routers an expression evaluates to: `{ routers }` (possibly empty when it is plainly middleware), or `{ external }` for a package. */
  function routerFromExpr(file, chain, node, depth = 0) {
    const facts = factsOf(file);
    const n = unwrapExpression(node);
    if (!n || depth > MAX_DEPTH) return { routers: [] };
    if (n.type === 'Identifier') {
      const d = facts.lookup(chain, n.name);
      if (!d) return { routers: [] };
      if (d.kind === 'router') return { routers: [{ file, key: `${d.scopeId}:${d.name}` }] };
      if (d.kind === 'import') {
        const t = importTarget(file, d.specifier);
        return t ? { routers: exportedRouter(t, d.imported, false, depth + 1) } : { routers: [], external: d.specifier };
      }
      if (d.kind === 'unknown' && d.init) return routerFromExpr(file, chainOfScope(facts, d.scopeId), d.init, depth + 1);
      return { routers: [] };
    }
    if (n.type === 'MemberExpression' && !n.computed && n.object.type === 'Identifier' && n.property.type === 'Identifier') {
      const d = facts.lookup(chain, n.object.name);
      if (d?.kind === 'import') {
        const t = importTarget(file, d.specifier);
        return t ? { routers: exportedRouter(t, n.property.name, false, depth + 1) } : { routers: [], external: d.specifier };
      }
      return { routers: [] };
    }
    if (n.type === 'CallExpression') {
      const callee = unwrapExpression(n.callee);
      if (callee.type === 'Identifier' && callee.name === 'require' && n.arguments[0]?.type === 'Literal' && typeof n.arguments[0].value === 'string') {
        const t = importTarget(file, n.arguments[0].value);
        return t ? { routers: exportedRouter(t, 'default', false, depth + 1) } : { routers: [], external: n.arguments[0].value };
      }
      if (callee.type === 'Identifier') {
        const d = facts.lookup(chain, callee.name);
        if (d?.kind === 'function') return { routers: fnReturns(file, d.fnId, depth) };
        if (d?.kind === 'import') {
          const t = importTarget(file, d.specifier);
          return t ? { routers: exportedRouter(t, d.imported, true, depth + 1) } : { routers: [], external: d.specifier };
        }
        return { routers: [] };
      }
      if (callee.type === 'MemberExpression' && !callee.computed && callee.object.type === 'Identifier' && callee.property.type === 'Identifier') {
        const d = facts.lookup(chain, callee.object.name);
        if (d?.kind === 'import') {
          const t = importTarget(file, d.specifier);
          return t ? { routers: exportedRouter(t, callee.property.name, true, depth + 1) } : { routers: [], external: d.specifier };
        }
      }
    }
    return { routers: [] };
  }
  const exportedFn = (file, name, depth = 0, seen = new Set()) => {
    const facts = factsOf(file);
    if (!facts || depth > MAX_DEPTH || seen.has(`${file}#${name}`)) return null;
    seen.add(`${file}#${name}`);
    const entry = facts.exports.get(name);
    if (!entry) {
      for (const spec of facts.starExports) { const t = importTarget(file, spec); const r = t && exportedFn(t, name, depth + 1, seen); if (r) return r; }
      return null;
    }
    if (entry.reexport) { const t = importTarget(file, entry.reexport.specifier); return t ? exportedFn(t, entry.reexport.imported, depth + 1, seen) : null; }
    if (entry.fn) return { file, fnId: entry.fn };
    const d = facts.lookup(['m'], entry.local);
    if (d?.kind === 'function') return { file, fnId: d.fnId };
    if (d?.kind === 'import') { const t = importTarget(file, d.specifier); return t ? exportedFn(t, d.imported, depth + 1, seen) : null; }
    return null;
  };
  // `const auth = createAuth(...)` then `auth.mountRoutes(app)`: the member is a function the factory returns in an object literal.
  const factoryMember = (file, decl, prop, depth) => {
    const facts = factsOf(file);
    const init = unwrapExpression(decl.init ?? decl.assigned);
    if (init?.type !== 'CallExpression' || depth > MAX_DEPTH) return null;
    const factory = resolveCallee(file, chainOfScope(facts, decl.scopeId), init.callee, depth + 1);
    if (!factory) return null;
    const ff = factsOf(factory.file);
    const fn = ff.functions.get(factory.fnId);
    for (const rn of fn.returnNodes) {
      const obj = unwrapExpression(rn);
      if (obj?.type !== 'ObjectExpression') continue;
      const p = obj.properties.find((x) => x.type === 'Property' && !x.computed && (x.key.name ?? x.key.value) === prop);
      const v = p && unwrapExpression(p.value);
      if (v?.type === 'Identifier') { const d = ff.lookup(fn.chain, v.name); if (d?.kind === 'function') return { file: factory.file, fnId: d.fnId }; }
      else if (v && ['FunctionExpression', 'ArrowFunctionExpression'].includes(v.type)) return { file: factory.file, fnId: `f${v.range[0]}` };
    }
    return null;
  };
  function resolveCallee(file, chain, calleeNode, depth = 0) {
    const facts = factsOf(file);
    const c = unwrapExpression(calleeNode);
    if (c.type === 'Identifier') {
      const d = facts.lookup(chain, c.name);
      if (d?.kind === 'function') return { file, fnId: d.fnId };
      if (d?.kind === 'import') { const t = importTarget(file, d.specifier); return t ? exportedFn(t, d.imported) : null; }
    } else if (c.type === 'MemberExpression' && !c.computed && c.object.type === 'Identifier' && c.property.type === 'Identifier') {
      const d = facts.lookup(chain, c.object.name);
      if (d?.kind === 'import') { const t = importTarget(file, d.specifier); return t ? exportedFn(t, c.property.name) : null; }
      if (d?.kind === 'other' || d?.kind === 'server') return factoryMember(file, d, c.property.name, depth);
    }
    return null;
  }

  // ---- describing a handler or middleware for the output ----
  const describeHandler = (file, desc) => {
    if (!desc) return { name: null, inline: true };
    if (desc.kind === 'function') return { name: desc.name, inline: true };
    if (desc.kind === 'call') return { name: null, inline: true, wrapper: desc.wrapper };
    if (desc.binding?.kind === 'import') {
      const t = importTarget(file, desc.binding.specifier);
      return { file: t, name: desc.name.includes('.') ? desc.name.split('.').pop() : desc.name, inline: false, ...(t ? {} : { package: desc.binding.specifier }) };
    }
    if (desc.binding?.kind === 'local') {
      const d = factsOf(file).lookup(['m'], desc.name);
      const line = d?.kind === 'function' ? factsOf(file).functions.get(d.fnId)?.line : undefined;
      return { file, name: desc.name, inline: false, ...(line ? { line } : {}) };
    }
    return { file, name: desc.name, inline: false };
  };
  const mwName = (desc) => (desc.kind === 'function' ? (desc.errorHandler ? '(error handler)' : desc.name ? `${desc.name} (inline)` : '(inline)') : desc.name);

  // ---- expansion ----
  const routes = [];
  const mounts = [];
  const middleware = [];
  const unresolvedMounts = [];
  const reached = new Set();
  const mwByKey = new Map();
  const mwId = (file, line, fullPath, names, errorHandler = false) => {
    const k = `${file}:${line}:${fullPath}:${names.join(',')}`;
    if (!mwByKey.has(k)) {
      const entry = { id: `m${mwByKey.size + 1}`, path: fullPath, names, file, line, ...(errorHandler ? { errorHandler: true } : {}) };
      mwByKey.set(k, entry);
      middleware.push(entry);
    }
    return mwByKey.get(k).id;
  };

  function expand(file, key, ctx, stack) {
    const id = `${file}#${key}`;
    if (stack.includes(id) || stack.length > MAX_DEPTH) return;
    reached.add(id);
    const facts = factsOf(file);
    const rcv = facts.receivers.get(key);
    if (!rcv) return;
    const mwStack = [...ctx.mw];
    for (const ev of rcv.events) {
      if (ev.type === 'route') {
        for (const p of ev.paths) {
          const full = p.dynamic ? (ctx.prefix === '' ? p.text : joinPath(ctx.prefix, p.text)) : joinPath(ctx.prefix, p.path);
          const inherited = mwStack.filter((m) => prefixMatches(m.path, full)).map((m) => m.id);
          routes.push({
            method: ev.method,
            path: full,
            ...(p.dynamic || ctx.dynamic ? { dynamicPath: true } : {}),
            handler: describeHandler(file, ev.handler),
            middleware: ev.middleware.map(mwName),
            inherited,
            file, line: ev.line,
            app: ctx.app, mounted: true,
          });
        }
      } else if (ev.type === 'use') {
        const paths = ev.paths ?? [{ path: '', text: '', dynamic: false }];
        for (const p of paths) {
          const base = joinPath(ctx.prefix, p.dynamic ? p.text : p.path);
          const dyn = Boolean(ctx.dynamic || p.dynamic);
          ev.args.forEach((argNode, i) => {
            const desc = ev.described[i];
            const r = routerFromExpr(file, ev.chain, argNode);
            if (r.routers.length > 0) {
              for (const target of r.routers) {
                mounts.push({ path: base, target: { file: target.file, name: factsOf(target.file).receivers.get(target.key)?.name ?? null }, from: { file, line: ev.line }, ...(dyn ? { dynamicPath: true } : {}), app: ctx.app });
                expand(target.file, target.key, { prefix: base, mw: [...mwStack], app: ctx.app, dynamic: dyn }, [...stack, id]);
              }
              return;
            }
            const dn = desc ?? { kind: 'other', name: '(unknown)' };
            const looksLikeRouter = !r.external && dn.kind !== 'function' && (dn.kind === 'ident' || dn.kind === 'call' || dn.kind === 'member') && ROUTERISH.test(dn.text ?? dn.name ?? '');
            if (looksLikeRouter && ev.paths) {
              unresolvedMounts.push({ path: base, expression: dn.text ?? dn.name, file, line: ev.line, reason: 'not statically resolvable to an express.Router()' });
              return;
            }
            const names = [mwName(dn)];
            const mid = mwId(file, ev.line, base, names, Boolean(dn.errorHandler));
            if (!dn.errorHandler) mwStack.push({ id: mid, path: base }); // an error handler (4 parameters) runs only after an error
          });
        }
      } else if (ev.type === 'call') {
        const target = resolveCallee(file, ev.chain, ev.callee);
        if (!target) continue;
        const fn = factsOf(target.file).functions.get(target.fnId);
        const pname = fn.params[ev.argIndex];
        if (!pname) continue;
        expand(target.file, `${target.fnId}:${pname}`, { prefix: ctx.prefix, mw: [...mwStack], app: ctx.app, dynamic: ctx.dynamic }, [...stack, id]);
      }
    }
  }

  const apps = [];
  const appRoots = [];
  for (const file of [...files.keys()].sort()) {
    for (const rcv of [...factsOf(file).receivers.values()].sort((a, b) => a.line - b.line)) {
      if (rcv.kind === 'app') appRoots.push({ file, rcv });
    }
    for (const d of factsOf(file).decls.get('m')?.values() ?? []) {
      if (d.kind === 'app' && !factsOf(file).receivers.has(`m:${d.name}`)) appRoots.push({ file, rcv: { key: `m:${d.name}`, name: d.name, line: d.line } });
    }
  }
  appRoots.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.rcv.line - b.rcv.line));
  for (const { file, rcv } of appRoots) {
    apps.push({ file, line: rcv.line, name: rcv.name });
    expand(file, rcv.key, { prefix: '', mw: [], app: file, dynamic: false }, []);
  }

  // routers that no app mounts: their routes have local paths and no known prefix
  const unmounted = [];
  for (const file of [...files.keys()].sort()) {
    for (const rcv of [...factsOf(file).receivers.values()].sort((a, b) => a.line - b.line)) {
      if (rcv.kind === 'app' || reached.has(`${file}#${rcv.key}`)) continue;
      const rs = rcv.events.filter((e) => e.type === 'route');
      if (rs.length === 0) continue;
      const before = routes.length;
      expand(file, rcv.key, { prefix: '', mw: [], app: null, dynamic: false }, []);
      for (const r of routes.splice(before)) unmounted.push({ ...r, mounted: false, app: null });
    }
  }

  // plain http.createServer handlers
  const httpServers = [];
  for (const file of [...files.keys()].sort()) {
    const facts = factsOf(file);
    for (const s of facts.httpServers) {
      let handlerNode = null;
      let handlerName = null;
      const h = s.handler ? unwrapExpression(s.handler) : null;
      let handlerFile = file;
      if (h && ['ArrowFunctionExpression', 'FunctionExpression'].includes(h.type)) handlerNode = h;
      else if (h?.type === 'Identifier') {
        const d = facts.lookup(s.chain, h.name);
        if (d?.kind === 'app' || d?.kind === 'router') continue; // http.createServer(app): the express app is the handler
        handlerName = h.name;
        if (d?.kind === 'function') handlerNode = facts.functions.get(d.fnId).node;
        else if (d?.kind === 'import') {
          const t = importTarget(file, d.specifier);
          const fnRef = t ? exportedFn(t, d.imported) : null;
          if (fnRef) { handlerNode = factsOf(fnRef.file).functions.get(fnRef.fnId).node; handlerFile = fnRef.file; }
        }
      } else if (h === null) continue;
      if (!handlerNode) { httpServers.push({ file, line: s.line, handler: { file: handlerFile, name: handlerName }, routes: [], otherBranches: 0, detected: false, note: 'request handler is not statically visible' }); continue; }
      const { routes: found, otherBranches } = collectHttpRoutes(handlerNode);
      httpServers.push({
        file, line: s.line, handler: { file: handlerFile, name: handlerName },
        routes: found.map((r) => ({ method: r.method ?? 'ANY', path: r.path, file: handlerFile, line: r.line })),
        otherBranches, detected: found.length > 0,
        ...(found.length === 0 ? { note: 'not detected: no `url === \'/x\'` conditions in the handler' } : otherBranches > 0 ? { note: `${otherBranches} other path condition${otherBranches === 1 ? '' : 's'} (startsWith, regular expression, computed) not detected` } : {}),
      });
    }
  }

  const framework = apps.length + unmounted.length > 0 ? (httpServers.length > 0 ? 'express+node-http' : 'express') : httpServers.length > 0 ? 'node-http' : 'none';
  return { routes, mounts, middleware, unmounted, unresolvedMounts, httpServers, apps, framework };
}
