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
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '@line/construct-core/config';
import { normalizeLineConfig } from '@line/construct-core/profiles/line/contract';
import { listFiles } from '@line/construct-core/profiles/line/checks';
import { readPathAliases, resolveImportSpecifier, traceRouteFiles, traceExcludesFor, findReactSpaRoutesFile } from '@line/construct-core/route-resolver';
import { readRouteTable } from '../../units/route-adapters.mjs';
import { LineOpError } from '../contract.mjs';

const posix = path.posix;
const PAGE_FILE = /(?:^|\/)app\/(?:.*\/)?page\.[cm]?[jt]sx?$/;
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
 * The route family as one closure: the route and its sub-routes, and every app file they import.
 * @param {string} appRoot The app (absolute).
 * @param {string} route The family route, such as /opportunity.
 * @param {{excludes?: string[]}} [o] Where the trace stops (path substrings); default: architecture.yml line.traceExcludes, else nowhere.
 * @returns {import('./shapes.mjs').RouteClosure}
 * @throws {LineOpError} UNKNOWN_ROUTE when the app has no such route.
 */
export function readRouteFamily(appRoot, route, o = {}) {
  const root = path.resolve(appRoot);
  const family = `/${String(route ?? '').trim().replace(/^\/+|\/+$/g, '')}`;
  if (!/^\/[A-Za-z0-9_:\-./[\]]*$/.test(family)) throw new LineOpError(`"${route}" is not a route; name one like /orders.`, 'UNKNOWN_ROUTE');
  const all = listRoutes(root);
  const routes = all.filter((r) => inFamily(family, r.route));
  if (!routes.length) {
    const tops = [...new Set(all.map((r) => withoutLeadingParams(r.route).split('/').slice(0, 2).join('/') || '/'))].slice(0, 6);
    throw new LineOpError(`The app has no route ${family}${tops.length ? `; its routes start with ${tops.join(', ')}` : ', and no routes Line can read'}.`, 'UNKNOWN_ROUTE');
  }
  const excludes = traceExcludesFor({ excludes: o.excludes, configured: configuredExcludes(root) });
  const { aliases } = readPathAliases(root);
  const files = new Set();
  const external = new Set();
  const onStop = (what, why) => {
    if (why === 'package') external.add(packageOf(what));
    else if (why === 'excluded') external.add(toRel(root, what));
    else external.add(`unresolved: ${what}`);
  };
  for (const r of routes) {
    for (const abs of traceRouteFiles(path.join(root, r.entry), { aliases, excludes, onStop })) {
      const rel = toRel(root, abs);
      if (!rel.startsWith('..')) files.add(rel);
    }
  }
  return { appRoot: root, routes, files: [...files].sort(), external: [...external].sort() };
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
