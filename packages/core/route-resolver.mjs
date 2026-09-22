// Route resolution — a set of small, atomic, deterministic tools for going
// from "a Next.js route" to "the files that actually power it," so import's
// analysis gets a real dependency graph instead of a hand-picked directory.
// Each piece here does one mechanical job and nothing else; none of them
// call an LLM. Where a static resolver's best effort is wrong or
// incomplete (an unusual routing setup, an import shape it doesn't
// recognize), the analysis LLM downstream sees whatever file set this
// produces and can still make a sensible call — these tools are not trying
// to be a perfect, general-purpose bundler resolver, just a reasonable
// first pass.
import fs from 'node:fs';
import path from 'node:path';
import { ConstructError, EXIT_CODES } from './diagnostics.mjs';
import { walk } from './fs.mjs';
import { parseToAst, walkAst } from '../../packages/ast/index.mjs';

const PAGE_FILENAMES = ['page.tsx', 'page.ts', 'page.jsx', 'page.js'];

function isRouteGroup(name) {
  return /^\(.+\)$/.test(name);
}

function isDynamicSegment(name) {
  return /^\[.+\]$/.test(name);
}

function safeReaddir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function hasPageFile(dir) {
  return PAGE_FILENAMES.some((f) => fs.existsSync(path.join(dir, f)));
}

/** Map a URL path (e.g. "/v2/home") to the folder under `appDir` that
 * contains its page.tsx, transparently skipping route groups
 * ("(with-sidebar)") and matching dynamic segments ("[locale]") against
 * any URL segment. Throws if no folder matches, or if more than one does
 * (an ambiguous route the static resolver can't disambiguate — a human or
 * the folder-path form of --route is the fallback). */
export function resolveUrlToFolder(appDir, urlPath) {
  const segments = urlPath.split('/').filter(Boolean);
  const matches = new Set();

  function search(dir, segIndex) {
    if (segIndex === segments.length) {
      if (hasPageFile(dir)) matches.add(dir);
      for (const entry of safeReaddir(dir)) {
        if (entry.isDirectory() && isRouteGroup(entry.name)) search(path.join(dir, entry.name), segIndex);
      }
      return;
    }
    const wanted = segments[segIndex];
    for (const entry of safeReaddir(dir)) {
      if (!entry.isDirectory()) continue;
      if (isRouteGroup(entry.name)) {
        search(path.join(dir, entry.name), segIndex);
      } else if (isDynamicSegment(entry.name)) {
        // Ambiguous by nature: a dynamic segment either captures the
        // current URL segment (the common case) or, for something like an
        // optional/defaulted locale, has no explicit value in the URL at
        // all. Try both rather than guess — whichever leads to a real
        // page.tsx wins; this is exactly the kind of best-effort call this
        // resolver doesn't need to get perfectly right on its own.
        search(path.join(dir, entry.name), segIndex + 1);
        search(path.join(dir, entry.name), segIndex);
      } else if (entry.name === wanted) {
        search(path.join(dir, entry.name), segIndex + 1);
      }
    }
  }
  search(path.resolve(appDir), 0);

  if (matches.size === 0) {
    throw new ConstructError(`No route folder found for "${urlPath}" under ${appDir}`, { exitCode: EXIT_CODES.USAGE_ERROR });
  }
  if (matches.size > 1) {
    throw new ConstructError(
      `"${urlPath}" matched more than one folder under ${appDir}: ${[...matches].join(', ')} — use the folder-path form of --route instead to disambiguate.`,
      { exitCode: EXIT_CODES.USAGE_ERROR },
    );
  }
  return [...matches][0];
}

/** Find the page entry file in a resolved route folder. */
export function findRouteEntryFile(routeFolder) {
  for (const f of PAGE_FILENAMES) {
    const p = path.join(routeFolder, f);
    if (fs.existsSync(p)) return p;
  }
  throw new ConstructError(
    `No page file (${PAGE_FILENAMES.join(', ')}) found in ${routeFolder}`,
    { exitCode: EXIT_CODES.USAGE_ERROR },
  );
}

function stripJsonComments(raw) {
  return raw.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Read `@/*`-style path aliases from the nearest tsconfig.json/jsconfig.json
 * walking up from `startDir` — the same upward-search shape Construct
 * already uses for architecture.yml. Only handles the common single-
 * wildcard shape (`"prefix/*": ["target/*"]`); anything else is skipped
 * rather than guessed at. Returns `{ aliases, configDir }`, `aliases: []`
 * if no config file is found. */
export function readPathAliases(startDir) {
  let dir = path.resolve(startDir);
  while (true) {
    for (const name of ['tsconfig.json', 'jsconfig.json']) {
      const configPath = path.join(dir, name);
      if (fs.existsSync(configPath)) return parseAliases(configPath, dir);
    }
    const parent = path.dirname(dir);
    if (parent === dir) return { aliases: [], configDir: null };
    dir = parent;
  }
}

function parseAliases(configPath, configDir) {
  let json;
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    // Plain JSON first: the naive comment stripper corrupts globs like "**/*.ts" (they contain `/*`).
    try { json = JSON.parse(raw); } catch { json = JSON.parse(stripJsonComments(raw)); }
  } catch {
    return { aliases: [], configDir };
  }
  const paths = json?.compilerOptions?.paths || {};
  const baseUrl = json?.compilerOptions?.baseUrl || '.';
  const aliases = [];
  for (const [pattern, targets] of Object.entries(paths)) {
    const target = Array.isArray(targets) ? targets[0] : undefined;
    if (!pattern.endsWith('/*') || !target?.endsWith('/*')) continue;
    aliases.push({
      prefix: pattern.slice(0, -1),
      target: path.resolve(configDir, baseUrl, target.slice(0, -1)),
    });
  }
  return { aliases, configDir };
}

/** Resolve one import specifier from `fromAbsFile` to an absolute file —
 * relative (`./x`) via normal resolution, aliased (`@/x`) via `aliases`
 * (from readPathAliases), anything else (a bare package name) returns
 * null: it's external by construction, never something this can resolve
 * to a file, and never something worth trying to. */
export function resolveImportSpecifier(fromAbsFile, specifier, aliases = []) {
  let base;
  if (specifier.startsWith('.')) {
    base = path.resolve(path.dirname(fromAbsFile), specifier);
  } else {
    const hit = aliases.find((a) => specifier.startsWith(a.prefix));
    if (!hit) return null;
    base = path.join(hit.target, specifier.slice(hit.prefix.length));
  }
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')];
  return candidates.find((c) => fs.existsSync(c) && fs.statSync(c).isFile()) || null;
}

// Sensible defaults for "this is shared app infrastructure, not part of the
// feature being imported" — a Subframe-synced UI library, the RTK Query API
// layer, analytics, and generic cross-app context/components. Matches by
// substring against the normalized (forward-slash) absolute path, so it's
// robust to exactly where the project root happens to be. Callers can pass
// their own list; this is a starting point, not a hardcoded law.
export const DEFAULT_TRACE_EXCLUDES = ['/ui-v2/', '/ui/', '/libs/store/', '/libs/matomo', '/components/PortalLoader', '/libs/context/'];

function isExcluded(absPath, excludes) {
  const normalized = absPath.split(path.sep).join('/');
  return excludes.some((ex) => normalized.includes(ex));
}

const IMPORT_RE = /(?:import\s+(?:type\s+)?[\s\S]*?from\s*|import\s*\()(['"])(.*?)\1/g;

/** Breadth-first trace of every file transitively reachable from
 * `entryAbsFile` via relative/aliased imports, stopping at anything
 * matching `excludes` (not included in the result, and not followed
 * further) or unresolvable (bare package imports). Returns the file list
 * including the entry file itself, in discovery order. */
export function traceRouteFiles(entryAbsFile, { aliases = [], excludes = DEFAULT_TRACE_EXCLUDES } = {}) {
  const visited = new Set();
  const queue = [path.resolve(entryAbsFile)];
  while (queue.length) {
    const file = queue.shift();
    if (visited.has(file) || isExcluded(file, excludes)) continue;
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
    visited.add(file);
    const source = fs.readFileSync(file, 'utf8');
    for (const m of source.matchAll(IMPORT_RE)) {
      const resolved = resolveImportSpecifier(file, m[2], aliases);
      if (resolved && !visited.has(resolved) && !isExcluded(resolved, excludes)) queue.push(resolved);
    }
  }
  return [...visited];
}

/** The combining tool for the Next.js App Router convention: given either a
 * route folder path or a URL (starting with "/", requiring `appDir` to
 * resolve), find its page entry file and trace every file it depends on.
 * Returns `{ folder, entryFile, files }`. This is the resolveRoute()
 * behavior every existing caller/test already relies on — kept as its own
 * named function so `resolveRoute` can dispatch to it (the default, for
 * back-compat) or to `resolveReactSpaRoute` per `opts.framework`. */
function resolveNextjsRoute(routeArg, { appDir, excludes } = {}) {
  // A folder path can also start with "/" (any absolute path does), so
  // "is this actually a directory on disk" decides the form — not the
  // leading slash. Only once that's ruled out is routeArg treated as a URL.
  const asFolder = path.resolve(routeArg);
  let folder;
  if (fs.existsSync(asFolder) && fs.statSync(asFolder).isDirectory()) {
    folder = asFolder;
  } else if (routeArg.startsWith('/')) {
    if (!appDir) {
      throw new ConstructError(
        `"${routeArg}" isn't an existing folder, so it's being treated as a URL route — but resolving that needs to know where your app/ directory is (appDir).`,
        { exitCode: EXIT_CODES.USAGE_ERROR },
      );
    }
    folder = resolveUrlToFolder(appDir, routeArg);
  } else {
    throw new ConstructError(`Route folder not found: ${routeArg}`, { exitCode: EXIT_CODES.USAGE_ERROR });
  }
  const entryFile = findRouteEntryFile(folder);
  const { aliases } = readPathAliases(folder);
  const files = traceRouteFiles(entryFile, { aliases, excludes });
  return { folder, entryFile, files };
}

// --- react-spa: a real, different, but equally concrete convention -------
//
// There's no per-route file in a client-routed SPA the way Next.js App
// Router has one page.tsx per folder. Routing instead lives in one
// centralized file — by convention `src/App.tsx` (see config.mjs's
// REACT_SPA_LAYERS — this is literally the "route" layer's pattern), whose
// shape mirrors what ui/client/src/App.jsx actually does today: a
// react-router `<Routes>` table mapping a URL path straight to a controller
// element, e.g. `<Route path="/dashboard" element={<DashboardController />} />`.
// Resolving a URL route for this framework means: find that table, find the
// controller name registered for the requested path, then locate that
// controller's real file under `features/*/controllers/` — from there,
// tracing its dependency graph is identical to the Next.js path (import
// tracing was never Next.js-specific to begin with).

const REACT_SPA_ROUTES_FILE_CANDIDATES = ['src/App.tsx', 'src/App.jsx'];

/** Locate the centralized react-router table file for a react-spa project. */
export function findReactSpaRoutesFile(root) {
  for (const rel of REACT_SPA_ROUTES_FILE_CANDIDATES) {
    const p = path.join(root, rel);
    if (fs.existsSync(p)) return p;
  }
  throw new ConstructError(
    `No react-spa routes file (${REACT_SPA_ROUTES_FILE_CANDIDATES.join(', ')}) found under ${root}`,
    { exitCode: EXIT_CODES.USAGE_ERROR },
  );
}

/** The tag name of a JSXElement's opening tag (e.g. `X` for `<X .../>`), or
 * null for anything other than a plain identifier tag (a member-expression
 * tag like `<Foo.Bar/>` isn't a route/component reference this resolves). */
function jsxTagName(jsxElement) {
  const name = jsxElement?.openingElement?.name;
  return name?.type === 'JSXIdentifier' ? name.name : null;
}

/** Parse `<Route path="..." element={<XController .../>} />` entries out of
 * a react-spa routes file's source, in document order — real JSX/AST parsing
 * (via parseToAst from parser.mjs), not a regex over the tag's raw text.
 * Attribute order (`path` before/after `element`) doesn't matter; a `<Route>`
 * missing either attribute, or whose `element` isn't a single JSX element
 * with a plain identifier tag, is skipped (same "a reasonable first pass"
 * philosophy as the rest of this module — just backed by a real parser now,
 * so it's not fooled by nested braces/quotes/comments the way the old
 * regex-per-attribute approach could be). Traversal is via estree-walker (a
 * well-established generic ESTree traversal library), not a hand-rolled recursive walk. */
export function parseReactSpaRoutes(source) {
  const ast = parseToAst(source);
  const routes = [];
  walkAst(ast, {
    enter(node) {
      if (node.type !== 'JSXElement' || jsxTagName(node) !== 'Route') return;
      let routePath;
      let component;
      for (const attr of node.openingElement.attributes || []) {
        if (attr.type !== 'JSXAttribute' || attr.name?.type !== 'JSXIdentifier') continue;
        if (attr.name.name === 'path' && attr.value?.type === 'Literal' && typeof attr.value.value === 'string') {
          routePath = attr.value.value;
        } else if (attr.name.name === 'element' && attr.value?.type === 'JSXExpressionContainer') {
          component = jsxTagName(attr.value.expression);
        }
      }
      if (routePath && component) routes.push({ path: routePath, component });
    },
  });
  return routes;
}

/** Find the one controller file named `componentName` under
 * `<root>/<featuresRoot>/*\/controllers/`. Throws if none or more than one
 * matches — same disambiguation stance as resolveUrlToFolder. */
export function findControllerFile(root, componentName, featuresRoot = 'features') {
  const base = path.join(root, featuresRoot);
  const matches = walk(base).filter((p) => {
    const parsed = path.parse(p);
    return path.basename(path.dirname(p)) === 'controllers' && parsed.name === componentName;
  });
  if (matches.length === 0) {
    throw new ConstructError(
      `No controller file named "${componentName}" found under ${path.relative(root, base)}/*/controllers/`,
      { exitCode: EXIT_CODES.USAGE_ERROR },
    );
  }
  if (matches.length > 1) {
    throw new ConstructError(
      `"${componentName}" matched more than one controller file: ${matches.join(', ')}`,
      { exitCode: EXIT_CODES.USAGE_ERROR },
    );
  }
  return matches[0];
}

/** The react-spa equivalent of resolveNextjsRoute: given either an existing
 * controller file path or a URL route (resolved through the project's
 * routes file), find the controller entry file and trace everything it
 * depends on. Returns the same `{ folder, entryFile, files }` shape as the
 * Next.js path, plus `component` (the controller name the router actually
 * registered for this route). */
function resolveReactSpaRoute(routeArg, { root, routesFile, featuresRoot = 'features', excludes } = {}) {
  const asFile = path.resolve(routeArg);
  let entryFile;
  let component;
  if (fs.existsSync(asFile) && fs.statSync(asFile).isFile()) {
    entryFile = asFile;
  } else if (routeArg.startsWith('/')) {
    if (!root) {
      throw new ConstructError(
        `"${routeArg}" isn't an existing file, so it's being treated as a URL route — but resolving that needs to know the project root (root) to find its routes file.`,
        { exitCode: EXIT_CODES.USAGE_ERROR },
      );
    }
    const resolvedRoutesFile = routesFile || findReactSpaRoutesFile(root);
    const routes = parseReactSpaRoutes(fs.readFileSync(resolvedRoutesFile, 'utf8'));
    const match = routes.find((r) => r.path === routeArg);
    if (!match) {
      throw new ConstructError(
        `No <Route path="${routeArg}" ...> entry found in ${path.relative(root, resolvedRoutesFile)}`,
        { exitCode: EXIT_CODES.USAGE_ERROR },
      );
    }
    component = match.component;
    entryFile = findControllerFile(root, component, featuresRoot);
  } else {
    throw new ConstructError(`Controller file not found: ${routeArg}`, { exitCode: EXIT_CODES.USAGE_ERROR });
  }
  const folder = path.dirname(entryFile);
  const { aliases } = readPathAliases(folder);
  const files = traceRouteFiles(entryFile, { aliases, excludes });
  return { folder, entryFile, files, component };
}

/**
 * The combining tool: given either a route folder path or a URL (starting
 * with "/", requiring `appDir` to resolve), find its page entry file and
 * trace every file it depends on. Returns `{ folder, entryFile, files }`.
 * Dispatches on `opts.framework` ('nextjs', the default, or 'react-spa') —
 * see resolveNextjsRoute/resolveReactSpaRoute above for what each framework
 * actually needs to resolve a route.
 *
 * @param {string} routeArg A route folder path, or a URL starting with `/` (needs `opts.appDir`).
 * @param {object} [opts] `framework` (`'nextjs'` by default, or `'react-spa'`) and `appDir`.
 * @returns {{folder:string, entryFile:string, files:string[]}} The route folder, its entry file and every file it depends on.
 */
export function resolveRoute(routeArg, opts = {}) {
  const { framework = 'nextjs' } = opts;
  if (framework === 'react-spa') return resolveReactSpaRoute(routeArg, opts);
  return resolveNextjsRoute(routeArg, opts);
}
