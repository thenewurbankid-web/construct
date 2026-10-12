// Line Import v2, step 1 (docs/line/import-v2/CONTRACT.md "Read"): a route seeds the import, not a folder.
//
//   listRoutes(appRoot)                 every route the app declares: Next.js app-router page files, or a react-spa
//                                       route table (route-adapters.mjs readRouteTable), as {route, entry}
//   readRouteFamily(appRoot, route)     the route plus its sub-routes (/opportunity/*) and every file they import,
//                                       as ONE RouteClosure (it becomes one feature)
//   familyFeature(route)                the feature name a route family becomes (/opportunity -> opportunity)
//
// The closure is traced with Construct's route resolver (route-resolver.mjs traceRouteFiles), stopping only where the
// project says (architecture.yml `line.traceExcludes`) or the caller says; `external` lists every boundary the trace
// stopped at (excluded files, packages, imports that resolve to no file). Pure read: nothing is written.
//
// Scope (the feature is what only this family uses): a traced file belongs to the feature only when no root outside
// the family reaches it too -- another route's entry, a Next.js layout/template/loading/error/route handler outside the
// family, or the app's middleware and instrumentation -- over the app's import graph (import.mjs importGraph). Files
// other roots reach as well are `shared`: they stay where they are and are referenced, never imported, mapped,
// characterized or fitted.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '@line/construct-core/config';
import { normalizeLineConfig } from '@line/construct-core/profiles/line/contract';
import { listFiles } from '@line/construct-core/profiles/line/checks';
import { readPathAliases, resolveImportSpecifier, traceRouteFiles, traceExcludesFor, findReactSpaRoutesFile } from '@line/construct-core/route-resolver';
import { readRouteTable } from '../../units/route-adapters.mjs';
import { LineOpError } from '../contract.mjs';
import { routeLabel } from './contract.mjs';

export { routeLabel };
import { importGraph } from '../import.mjs';

const posix = path.posix;
const PAGE_FILE = /(?:^|\/)app\/(?:.*\/)?page\.[cm]?[jt]sx?$/;
/** Next.js app-router files that render or answer outside a page: each is a root of the app's own. */
const APP_ROOT_FILE = /(?:^|\/)app\/(?:(.*)\/)?(?:page|layout|template|loading|error|global-error|not-found|default|route)\.[cm]?[jt]sx?$/;
/** App-router files that wrap every route below their folder (not a page or a route handler). */
const WRAPPER_FILE = /(?:^|\/)(?:layout|template|loading|error|global-error|not-found|default)\.[cm]?[jt]sx?$/;
/** Whether `route` sits at or below the app-router folder whose route is `at`. */
const under = (at, route) => at === '/' || route === at || route.startsWith(`${at}/`);
/** App-level entry files every request passes through. */
const APP_LEVEL_FILE = /^(?:src\/)?(?:middleware|instrumentation(?:-client)?)\.[cm]?[jt]sx?$/;
const isTest = (rel) => /\.(test|spec|stories)\.[cm]?[jt]sx?$/.test(rel) || rel.split('/').some((s) => s === '__tests__');
const toRel = (root, abs) => path.relative(root, abs).split(path.sep).join('/');

/**
 * Next.js app-router route of an `app/.../page.tsx` file: route groups and parallel slots dropped, `[x]` as `:x`;
 * null for any other file.
 * @param {string} rel Project-relative path.
 * @returns {string|null}
 */
export function appRoute(rel) {
  const m = rel.match(/(?:^|\/)app\/(.*?)\/?page\.[cm]?[jt]sx?$/) || rel.match(/(?:^|\/)app\/()page\.[cm]?[jt]sx?$/);
  if (!m) return null;
  const segs = m[1].split('/').filter((s) => s && !/^\(.*\)$/.test(s) && !s.startsWith('@')).map((s) => s.replace(/^\[+\.{0,3}(.*?)\]+$/, ':$1'));
  return `/${segs.join('/')}`;
}

/**
 * The module specifier a name in `src` is imported from (default or named import), or null.
 * @param {string} src Source text.
 * @param {string} name The local name.
 * @returns {string|null}
 */
export function bindingSpecifier(src, name) {
  const re = new RegExp(`import\\s+(?:type\\s+)?(?:${name}\\b|[^;]*?\\{[^}]*\\b(?:\\w+\\s+as\\s+)?${name}\\b[^}]*\\})[^;]*?from\\s+(['"])([^'"]+)\\1`);
  const m = src.match(re);
  return m ? m[2] : null;
}

/** The route without leading dynamic segments (/:locale/opportunity -> /opportunity). */
const withoutLeadingParams = (route) => `/${route.split('/').filter(Boolean).reduce((acc, s) => (acc.length || !s.startsWith(':') ? [...acc, s] : acc), /** @type {string[]} */ ([])).join('/')}`;

/**
 * Whether `route` is the family route or one of its sub-routes; a leading locale-like parameter (/:locale) is ignored.
 * @param {string} family The family route, such as /opportunity.
 * @param {string} route A route of the app.
 * @returns {boolean}
 */
export function inFamily(family, route) {
  const fam = family.replace(/\/+$/, '') || '/';
  return [route, withoutLeadingParams(route)].some((r) => r === fam || (fam !== '/' && r.startsWith(`${fam}/`)));
}

/**
 * The feature a route family becomes: its first static segment, kebab-case.
 * @param {string} route Such as /opportunity or /admin/users.
 * @returns {string}
 */
export function familyFeature(route) {
  const seg = String(route).split('/').find((s) => s && !s.startsWith(':')) ?? 'home';
  return seg.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'home';
}

/**
 * Every route the app declares, sorted by route: Next.js app-router page files when the app has any, else the react-spa
 * route table (src/App.tsx), each route's entry resolved to the file its element is imported from.
 * @param {string} appRoot The app (absolute).
 * @returns {{route: string, entry: string}[]} Entries are app-relative.
 */
export function listRoutes(appRoot) {
  const files = listFiles(appRoot);
  const pages = files.filter((f) => PAGE_FILE.test(f) && !isTest(f)).map((f) => ({ route: /** @type {string} */ (appRoute(f)), entry: f }));
  if (pages.length) return pages.sort((a, b) => a.route.localeCompare(b.route) || a.entry.localeCompare(b.entry));
  let tableFile;
  try { tableFile = findReactSpaRoutesFile(appRoot); } catch { return []; }
  const src = fs.readFileSync(tableFile, 'utf8');
  const { aliases } = readPathAliases(appRoot);
  /** @type {{route: string, entry: string}[]} */
  const out = [];
  let table = [];
  try { table = readRouteTable(src); } catch { table = []; }
  for (const { route, tags } of table) {
    for (const tag of tags) {
      const spec = bindingSpecifier(src, tag);
      const abs = spec ? resolveImportSpecifier(tableFile, spec, aliases) : null;
      if (abs) out.push({ route: route.startsWith('/') ? route : `/${route}`, entry: toRel(appRoot, abs) });
    }
  }
  return out.sort((a, b) => a.route.localeCompare(b.route) || a.entry.localeCompare(b.entry));
}

/** The project's `line.traceExcludes` (architecture.yml), or undefined when it has none or cannot be read. */
function configuredExcludes(appRoot) {
  try {
    const config = /** @type {any} */ (loadConfig(appRoot));
    const line = normalizeLineConfig(config?.line);
    return line.traceExcludes.length ? line.traceExcludes : undefined;
  } catch {
    return undefined;
  }
}

/** A bare specifier's package name (@scope/name or name). */
const packageOf = (spec) => (spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]);

/**
 * The route family as one closure: the route and its sub-routes, and every app file they import -- in `files` when
 * only the family reaches it, in `shared` when a root outside the family reaches it too.
 * @param {string} appRoot The app (absolute).
 * @param {string|string[]} route The family route, such as /opportunity, or several routes that make one feature
 *   together though they share no prefix (['/', '/profile/:id']); each brings its sub-routes.
 * @param {{excludes?: string[], feature?: string}} [o] `excludes`: where the trace stops (path substrings); default:
 *   architecture.yml line.traceExcludes, else nowhere. `feature`: the feature's name (the person's); default the first
 *   route's family name (familyFeature).
 * @returns {import('./contract.mjs').RouteClosure}
 * @throws {LineOpError} UNKNOWN_ROUTE when the app has no such route; BAD_FEATURE when the name is not kebab-case.
 */
export function readRouteFamily(appRoot, route, o = {}) {
  const root = path.resolve(appRoot);
  // Next.js writes a dynamic segment as its folder name (/profile/[id], /docs/[...slug]); the route table reads :id.
  const asked = (Array.isArray(route) ? route : [route]).map((r) => `/${String(r ?? '').trim().replace(/^\/+|\/+$/g, '')}`.split('/').map((s) => s.replace(/^\[+\.{0,3}(.*?)\]+$/, ':$1')).join('/'));
  if (!asked.length) throw new LineOpError('Name a route to import, such as /orders.', 'UNKNOWN_ROUTE');
  const bad = asked.find((f) => !/^\/[A-Za-z0-9_:\-./[\]]*$/.test(f));
  if (bad) throw new LineOpError(`"${bad}" is not a route; name one like /orders.`, 'UNKNOWN_ROUTE');
  const feature = o.feature ?? familyFeature(asked[0]);
  if (!/^[a-z][a-z0-9-]*$/.test(feature)) throw new LineOpError(`"${feature}" is not a feature name; use lower-case words joined by -, such as contacts.`, 'BAD_FEATURE');
  const all = listRoutes(root);
  const member = (r) => asked.some((f) => inFamily(f, r));
  for (const family of asked) {
    if (all.some((r) => inFamily(family, r.route))) continue;
    const tops = [...new Set(all.map((r) => withoutLeadingParams(r.route).split('/').slice(0, 2).join('/') || '/'))].slice(0, 6);
    throw new LineOpError(`The app has no route ${family}${tops.length ? `; its routes start with ${tops.join(', ')}` : ', and no routes Line can read'}.`, 'UNKNOWN_ROUTE');
  }
  const routes = all.filter((r) => member(r.route));
  const excludes = traceExcludesFor({ excludes: o.excludes, configured: configuredExcludes(root) });
  const { aliases } = readPathAliases(root);
  const files = new Set();
  const shared = new Set();
  const external = new Set();
  const onStop = (what, why) => {
    if (why === 'package') external.add(packageOf(what));
    else if (why === 'excluded') external.add(toRel(root, what));
    else external.add(`unresolved: ${what}`);
  };
  const traced = new Set();
  for (const r of routes) {
    for (const abs of traceRouteFiles(path.join(root, r.entry), { aliases, excludes, onStop })) {
      const rel = toRel(root, abs);
      if (!rel.startsWith('..')) traced.add(rel);
    }
  }
  const others = reachedOutside(root, member, routes, all, excludes);
  for (const f of traced) (others.has(f) ? shared : files).add(f);
  return { appRoot: root, routes, feature, files: [...files].sort(), shared: [...shared].sort(), external: [...external].sort() };
}

/**
 * Every root of the app outside the family: the other routes' entries, Next.js app-router files (layouts, templates,
 * loading/error states, route handlers) whose route is not in the family, and the app-level middleware and
 * instrumentation files.
 * @param {string[]} appFiles App-relative files.
 * @param {(route: string) => boolean} member Whether a route belongs to the family.
 * @param {{route: string, entry: string}[]} allRoutes
 * @returns {string[]}
 */
function rootsOutside(appFiles, member, allRoutes) {
  const roots = new Set(allRoutes.filter((r) => !member(r.route)).map((r) => r.entry));
  for (const f of appFiles) {
    if (isTest(f)) continue;
    if (APP_LEVEL_FILE.test(f)) { roots.add(f); continue; }
    if (!APP_ROOT_FILE.test(f)) continue;
    const route = appRoute(f.replace(/[^/]+$/, 'page.tsx'));
    if (route === null) continue;
    if (!member(route)) { roots.add(f); continue; }
    // A layout (template, loading, error, not-found, default) wraps every route below its folder: it is the family's
    // own only when all of those routes are in the family; else (the root layout of a '/' family) it is a root outside.
    if (WRAPPER_FILE.test(f) && allRoutes.some((r) => under(route, r.route) && !member(r.route))) roots.add(f);
  }
  return [...roots];
}

/**
 * The files any root outside the family reaches over the app's import graph (an excluded file is a boundary there too).
 * @param {string} root
 * @param {(route: string) => boolean} member
 * @param {{route: string, entry: string}[]} familyRoutes
 * @param {{route: string, entry: string}[]} allRoutes
 * @param {string[]} excludes
 * @returns {Set<string>}
 */
function reachedOutside(root, member, familyRoutes, allRoutes, excludes) {
  const appFiles = listFiles(root);
  const graph = importGraph(root, appFiles);
  const own = new Set(familyRoutes.map((r) => r.entry));
  const excluded = (rel) => excludes.some((ex) => `/${rel}`.includes(ex));
  const seen = new Set();
  const queue = rootsOutside(appFiles, member, allRoutes).filter((f) => !own.has(f));
  while (queue.length) {
    const f = /** @type {string} */ (queue.pop());
    if (seen.has(f) || excluded(f)) continue;
    seen.add(f);
    for (const t of graph.imports.get(f) ?? []) if (!seen.has(t)) queue.push(t);
  }
  return seen;
}

/**
 * The deepest folder holding every file of a closure (posix, app-relative), or '' when they only share the app root.
 * @param {string[]} files App-relative files.
 * @returns {string}
 */
export function commonFolder(files) {
  if (!files.length) return '';
  let common = posix.dirname(files[0]).split('/');
  for (const f of files.slice(1)) {
    const d = posix.dirname(f).split('/');
    let i = 0;
    while (i < common.length && i < d.length && common[i] === d[i]) i += 1;
    common = common.slice(0, i);
  }
  return common.filter((s) => s && s !== '.').join('/');
}
