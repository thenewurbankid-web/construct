// Route discovery as a per-framework adapter (#334). `architecture.yml`'s `project.framework`
// selects the adapter; a framework with no adapter yields NO routes, never a guess.
//
//   nextjs    file-system routes: every `app/**/page.tsx` (route groups dropped). Unchanged behaviour.
//   react-spa the route table lives in the route-layer file (REACT_SPA_LAYERS: `src/App.tsx`):
//             react-router `<Route path element>` trees and `createBrowserRouter`-style object tables
//             (`{ path, element, children }`), read from the AST. Each `element` is resolved, through the
//             file's own imports (and feature `index.ts` barrels), to the controller(s) it renders.
//
// Every adapter answers with the same record so the flow view (flow.mjs) is framework-agnostic:
//   { route, file, entries: [{ file, feature, tag?, order }] }
// `entries` are the feature controllers the route renders, in the route file's IMPORT ORDER (`order`).
// Deterministic, AST-based, no LLM. src/route-resolver.mjs (the resolveRoute callers) is untouched.
import fs from 'node:fs';
import path from 'node:path';
import { parseToAst, walkAst } from '../../../packages/ast/index.mjs';
import { resolveImportSpecifier } from '../../../src/route-resolver.mjs';

const isTest = (p) => /\.(test|spec)\./.test(p);
const CODE_EXT = '(?:ts|tsx|js|jsx|mjs)';
/** `types.ts` and `index.ts` are structure, not behaviour: the flow view leaves them out. */
export const isStructuralFile = (p) => new RegExp(`(^|/)(types|index)\\.${CODE_EXT}$`).test(p);
const isBarrel = (ctx, p) => new RegExp(`^${ctx.featuresRoot()}/[^/]+/index\\.${CODE_EXT}$`).test(p);

// ---- import bindings (memoised per context) ---------------------------------------------------

const bindingCache = new WeakMap();

/** A file's import bindings in SOURCE (import) order:
 * `[{ local, imported, spec, resolved, order }]`. `imported` is the exported name ('default' / '*' / a
 * name). Static imports plus `const X = lazy(() => import('...'))`. `resolved` is project-relative or null. */
export function importBindings(ctx, relPath) {
  let perCtx = bindingCache.get(ctx);
  if (!perCtx) bindingCache.set(ctx, (perCtx = new Map()));
  if (perCtx.has(relPath)) return perCtx.get(relPath);
  const out = [];
  try {
    const abs = path.join(ctx.root, relPath);
    const ast = parseToAst(fs.readFileSync(abs, 'utf8'));
    const resolve = (spec) => {
      const hit = resolveImportSpecifier(abs, spec, ctx.aliases());
      return hit ? path.relative(ctx.root, hit).split(path.sep).join('/') : null;
    };
    const raw = [];
    for (const node of ast.body) {
      if (node.type !== 'ImportDeclaration') continue;
      for (const s of node.specifiers) {
        raw.push({
          local: s.local.name, spec: node.source.value, at: node.range[0],
          imported: s.type === 'ImportDefaultSpecifier' ? 'default' : s.type === 'ImportNamespaceSpecifier' ? '*' : (s.imported.name ?? s.imported.value),
        });
      }
    }
    walkAst(ast, {
      enter(n) {
        if (n.type !== 'VariableDeclarator' || n.id?.type !== 'Identifier' || n.init?.type !== 'CallExpression') return;
        const callee = n.init.callee;
        if (!(callee.name === 'lazy' || (callee.type === 'MemberExpression' && callee.property?.name === 'lazy'))) return;
        walkAst(n.init, {
          enter(m) {
            if (m.type === 'ImportExpression' && m.source?.type === 'Literal') raw.push({ local: n.id.name, spec: m.source.value, at: n.range[0], imported: 'default' });
          },
        });
      },
    });
    raw.sort((a, b) => a.at - b.at);
    raw.forEach((r, order) => out.push({ local: r.local, imported: r.imported, spec: r.spec, resolved: resolve(r.spec), order }));
  } catch { /* unreadable or unparsable file: no bindings */ }
  perCtx.set(relPath, out);
  return out;
}

/** A feature `index.ts` barrel is not a place code lives: follow it to the file(s) that define what was
 * imported. Match by the imported names against the barrel targets' own exports; if none match (renamed
 * re-exports, `import *`), fall back to all of the barrel's targets. Non-barrels pass straight through. */
export function throughBarrel(ctx, file, names = ['*'], depth = 0) {
  if (!isBarrel(ctx, file) || depth > 4) return [file];
  const targets = ctx.facts(file).resolvedImports.filter((t) => t !== file && !isTest(t));
  const wanted = names.includes('*') ? null : new Set(names);
  const hit = wanted ? targets.filter((t) => ctx.facts(t).exports.some((e) => wanted.has(e.name))) : targets;
  return (hit.length ? hit : targets).flatMap((t) => throughBarrel(ctx, t, names, depth + 1));
}

const featureOf = (ctx, p) => {
  const fr = ctx.featuresRoot() + '/';
  return p.startsWith(fr) ? p.slice(fr.length).split('/')[0] : null;
};

/** The controller file(s) a binding named `local` in `routeFile` refers to. */
function controllersOfBinding(ctx, routeFile, local) {
  const b = importBindings(ctx, routeFile).find((x) => x.local === local);
  if (!b?.resolved) return [];
  return throughBarrel(ctx, b.resolved, [b.imported]).filter((f) => ctx.layerOf(f) === 'controller').map((file) => ({ file, order: b.order }));
}

// ---- react-spa --------------------------------------------------------------------------------

const joinPath = (parent, own) => {
  if (own === undefined || own === '') return parent || '/';
  const joined = own.startsWith('/') ? own : `${parent === '/' || !parent ? '' : parent}/${own}`;
  const clean = ('/' + joined).replace(/\/{2,}/g, '/');
  return clean.length > 1 ? clean.replace(/\/$/, '') : clean;
};

const jsxTag = (n) => {
  const name = n?.openingElement?.name;
  if (name?.type === 'JSXIdentifier') return name.name;
  if (name?.type === 'JSXMemberExpression') { let o = name; while (o.object) o = o.object; return o.name; }
  return null;
};

/** Every component tag used inside an `element` expression, in document order (`<Guard><UserController/></Guard>` -> Guard, UserController). */
function tagsIn(node) {
  const tags = [];
  walkAst(node, { enter(n) { if (n.type === 'JSXElement') { const t = jsxTag(n); if (t) tags.push(t); } } });
  return tags;
}

const attrOf = (el, name) => (el.openingElement.attributes || []).find((a) => a.type === 'JSXAttribute' && a.name?.name === name);
const strAttr = (a) => (a?.value?.type === 'Literal' && typeof a.value.value === 'string' ? a.value.value : a?.value?.type === 'JSXExpressionContainer' && a.value.expression?.type === 'Literal' ? String(a.value.expression.value) : undefined);
const propOf = (obj, name) => obj.properties.find((p) => p.type === 'Property' && !p.computed && (p.key.name ?? p.key.value) === name);

/** Read a react-spa route table out of one route file's source: `[{ route, tags: [componentName] }]`. */
export function readRouteTable(source) {
  const ast = parseToAst(source);
  const out = [];
  const seen = new WeakSet();
  const isRouteEl = (n) => n.type === 'JSXElement' && jsxTag(n) === 'Route';

  const fromJsx = (el, parent) => {
    seen.add(el);
    const idx = attrOf(el, 'index');
    const own = strAttr(attrOf(el, 'path'));
    const here = idx ? parent : joinPath(parent, own);
    const elementAttr = attrOf(el, 'element');
    const compAttr = attrOf(el, 'Component');
    const tags = [];
    if (elementAttr?.value?.type === 'JSXExpressionContainer') tags.push(...tagsIn(elementAttr.value.expression));
    if (compAttr?.value?.type === 'JSXExpressionContainer' && compAttr.value.expression?.type === 'Identifier') tags.push(compAttr.value.expression.name);
    if (tags.length && (own !== undefined || idx || parent)) out.push({ route: here, tags });
    for (const c of el.children || []) if (isRouteEl(c)) fromJsx(c, here);
  };

  const fromObj = (obj, parent) => {
    seen.add(obj);
    const idx = propOf(obj, 'index')?.value?.value === true;
    const p = propOf(obj, 'path')?.value;
    const own = p?.type === 'Literal' && typeof p.value === 'string' ? p.value : undefined;
    const here = idx ? parent : joinPath(parent, own);
    const el = propOf(obj, 'element')?.value;
    const comp = propOf(obj, 'Component')?.value;
    const tags = [];
    if (el?.type === 'JSXElement' || el?.type === 'JSXFragment') tags.push(...tagsIn(el));
    if (comp?.type === 'Identifier') tags.push(comp.name);
    if (tags.length) out.push({ route: here, tags });
    const kids = propOf(obj, 'children')?.value;
    if (kids?.type === 'ArrayExpression') for (const k of kids.elements) if (k?.type === 'ObjectExpression') fromObj(k, here);
  };

  walkAst(ast, {
    enter(n) {
      if (seen.has(n)) return;
      if (isRouteEl(n)) fromJsx(n, '');
      else if (n.type === 'ObjectExpression' && (propOf(n, 'element') || propOf(n, 'Component')) && (propOf(n, 'path') || propOf(n, 'index'))) fromObj(n, '');
      else if (n.type === 'ObjectExpression' && propOf(n, 'path') && propOf(n, 'children')?.value?.type === 'ArrayExpression') fromObj(n, '');
    },
  });
  return out;
}

const dedupeEntries = (entries) => {
  const seen = new Set();
  return entries.sort((a, b) => a.order - b.order || a.file.localeCompare(b.file)).filter((e) => (seen.has(e.file) ? false : (seen.add(e.file), true)));
};

const reactSpaAdapter = {
  framework: 'react-spa',
  routes(ctx) {
    const routeFiles = ctx.sourceFiles().filter((p) => !isTest(p) && ctx.layerOf(p) === 'route');
    const merged = new Map();
    for (const file of routeFiles) {
      let table;
      try { table = readRouteTable(fs.readFileSync(path.join(ctx.root, file), 'utf8')); } catch { continue; }
      for (const r of table) {
        const entries = dedupeEntries(r.tags.flatMap((t) => controllersOfBinding(ctx, file, t)).map((c) => ({ ...c, feature: featureOf(ctx, c.file) })));
        if (!entries.length) continue;
        const key = `${r.route}\0${file}`;
        const prev = merged.get(key);
        merged.set(key, prev ? { ...prev, entries: dedupeEntries([...prev.entries, ...entries]) } : { route: r.route, file, entries });
      }
    }
    return [...merged.values()].sort((a, b) => a.route.localeCompare(b.route) || a.file.localeCompare(b.file));
  },
  featureRoutes(ctx, name) {
    return this.routes(ctx).filter((r) => r.entries.some((e) => e.feature === name)).map((r) => ({ route: r.route, file: r.file }));
  },
};

// ---- nextjs -----------------------------------------------------------------------------------

const PAGE_RE = /(?:^|\/)app\/(.*?)\/?page\.[jt]sx?$/;
const nextRoute = (m) => '/' + m[1].split('/').filter((s) => !/^\(.*\)$/.test(s)).join('/');

const nextjsAdapter = {
  framework: 'nextjs',
  routes(ctx) {
    const out = [];
    for (const file of ctx.sourceFiles()) {
      const m = !isTest(file) && file.match(PAGE_RE);
      if (!m) continue;
      const entries = dedupeEntries(importBindings(ctx, file).flatMap((b) => (b.resolved ? throughBarrel(ctx, b.resolved, [b.imported]).filter((f) => ctx.layerOf(f) === 'controller').map((f) => ({ file: f, order: b.order, feature: featureOf(ctx, f) })) : [])));
      if (entries.length) out.push({ route: nextRoute(m), file, entries });
    }
    return out.sort((a, b) => a.route.localeCompare(b.route) || a.file.localeCompare(b.file));
  },
  /** Byte-for-byte the pre-#334 behaviour: any page that imports into the feature is one of its routes. */
  featureRoutes(ctx, name) {
    const dir = `${ctx.featuresRoot()}/${name}/`;
    const routes = [];
    for (const p of ctx.sourceFiles()) {
      if (p.startsWith(dir) || isTest(p)) continue;
      if (!ctx.facts(p).resolvedImports.some((t) => t.startsWith(dir))) continue;
      const m = p.match(PAGE_RE);
      if (m) routes.push({ route: nextRoute(m), file: p });
    }
    return routes;
  },
};

export const ROUTE_ADAPTERS = { nextjs: nextjsAdapter, 'react-spa': reactSpaAdapter };

export const frameworkOf = (ctx) => ctx.config().project?.framework || 'nextjs';

/** The adapter for this project's framework, or `null` (=> no routes, never a guess). */
export function routeAdapterFor(ctx, adapters = ROUTE_ADAPTERS) {
  return adapters[frameworkOf(ctx)] || null;
}

/** All routes of the project, `[{ route, file, entries }]`; `[]` when the framework has no adapter. */
export const discoverRoutes = (ctx, adapters) => routeAdapterFor(ctx, adapters)?.routes(ctx) ?? [];

/** The `{ route, file }` list a feature reports as `contracts.routes`; `[]` when there is no adapter. */
export const featureRoutes = (ctx, name, adapters) => routeAdapterFor(ctx, adapters)?.featureRoutes(ctx, name) ?? [];
