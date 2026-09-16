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
    json = JSON.parse(stripJsonComments(fs.readFileSync(configPath, 'utf8')));
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

/** The combining tool: given either a route folder path or a URL (starting
 * with "/", requiring `appDir` to resolve), find its page entry file and
 * trace every file it depends on. Returns `{ folder, entryFile, files }`. */
export function resolveRoute(routeArg, { appDir, excludes } = {}) {
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
