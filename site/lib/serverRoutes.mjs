// REST reference for the Cockpit server (#466/#463), read from the real Express route table rather than
// hand-copied prose: `ui/server/src/index.mjs`'s own `app.<method>(...)` calls, plus every
// `app.use('/mount', createXRouter(...))` sub-router it imports from a `*Api.mjs` file, walked the same way
// (`router.<method>(...)`). Regex-based, like the rest of this generator (apiDocs.mjs); deterministic, no LLM,
// and it reads only source text — nothing here imports or runs the server.
import fs from 'node:fs';
import path from 'node:path';

const METHODS = ['get', 'post', 'put', 'delete', 'patch'];
const ROUTE_RE = new RegExp(`\\b(?:app|router)\\.(${METHODS.join('|')})\\(\\s*'([^']+)'`, 'g');

// Route comments are pulled verbatim from source, and this codebase's own comments name their ticket in-line
// ("#292: the Processes drawer...") — the site's own convention (site/lib/markdown.mjs's stripTicketRefs) is
// that a reader-facing page never carries an internal ticket number, so those are scrubbed here too.
const clean = (s) =>
  s
    .replace(/\(?#\d+(?:\/#\d+)*\)?[.:,]?\s*[-–—]{0,2}\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** The `//` or JSDoc-style block comment ending directly above `lines[idx]` (blank lines above it are skipped),
 * as one line of plain text. '' when there is none. */
function leadingComment(lines, idx) {
  let i = idx - 1;
  while (i >= 0 && /^\s*$/.test(lines[i])) i--;
  if (i >= 0 && /\*\/\s*$/.test(lines[i])) {
    const block = [];
    while (i >= 0 && !/\/\*\*?/.test(lines[i])) {
      block.unshift(lines[i]);
      i--;
    }
    if (i >= 0) block.unshift(lines[i]);
    return clean(block.map((l) => l.replace(/^\s*\/\*+\s?|\*+\/\s*$|^\s*\*\s?/g, '')).join(' '));
  }
  const out = [];
  while (i >= 0 && /^\s*\/\//.test(lines[i])) {
    out.unshift(lines[i].replace(/^\s*\/\/\s?/, ''));
    i--;
  }
  return clean(out.join(' '));
}

/** Path `:params`, plus `req.query.x` / `req.body.x` (incl. `const { a, b } = req.body`, and one hop through a
 * `const body = req.body...` convenience local, which several handlers use) read from a bounded text window
 * starting at the route registration. Not full type inference — a light, deterministic surface. */
function paramsFrom(routePath, windowText) {
  const pathParams = [...routePath.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1]);
  const query = new Set();
  for (const m of windowText.matchAll(/req\.query(?:\.([A-Za-z0-9_]+)|\[['"]([A-Za-z0-9_]+)['"]\])/g)) query.add(m[1] || m[2]);
  const body = new Set();
  // One local alias for req.body is common ("const body = req.body && ... ? req.body : {};"); once seen, treat
  // bare `body.x` / `= body` the same as `req.body.x` / `= req.body` for the rest of this window.
  const bodyAlias = /\bconst\s+body\s*=\s*req\.body\b/.test(windowText) ? 'body' : 'req\\.body';
  const accessRe = new RegExp(`(?:req\\.body|${bodyAlias})(?:\\.([A-Za-z0-9_]+)|\\[['"]([A-Za-z0-9_]+)['"]\\])`, 'g');
  for (const m of windowText.matchAll(accessRe)) body.add(m[1] || m[2]);
  const destructureRe = new RegExp(`const\\s*\\{\\s*([^}]+)\\}\\s*=\\s*(?:req\\.body|${bodyAlias})\\b`, 'g');
  for (const d of windowText.matchAll(destructureRe)) for (const n of d[1].split(',')) { const name = n.split(':')[0].trim(); if (name) body.add(name); }
  return { path: pathParams, query: [...query], body: [...body] };
}

/** Every `app.<method>(...)`/`router.<method>(...)` registration in `text` (already scoped to one router/one
 * file), with its comment and a light request-shape guess, path-joined onto `mountPath`. */
function extractRoutes(text, mountPath, source) {
  const lines = text.split('\n');
  const offsets = [];
  { let n = 0; for (const l of lines) { offsets.push(n); n += l.length + 1; } }
  const matches = [...text.matchAll(ROUTE_RE)];
  const routes = matches.map((m) => {
    const method = m[1].toUpperCase();
    const sub = m[2];
    const routePath = `${mountPath.replace(/\/$/, '')}${sub === '/' ? '' : sub}` || '/';
    const lineIdx = offsets.filter((o) => o <= m.index).length - 1;
    return { method, path: routePath, desc: leadingComment(lines, lineIdx), matchIndex: m.index, source };
  });
  for (let i = 0; i < routes.length; i++) {
    const start = routes[i].matchIndex;
    const end = i + 1 < routes.length ? routes[i + 1].matchIndex : text.length;
    const window = text.slice(start, Math.min(end, start + 4000));
    const { path: p, query, body } = paramsFrom(routes[i].path, window);
    routes[i].params = p;
    routes[i].query = query;
    routes[i].body = body;
    delete routes[i].matchIndex;
  }
  return routes;
}

/** Text of one `export function createXRouter(...) { ... }` — from its declaration to the next top-level
 * `export ` (or EOF) — an approximation that only needs to be right about which `router.<method>` calls belong
 * to which factory, which is exact as long as two factories never interleave (they don't in this codebase: each
 * `export` starts a fresh top-level declaration). */
function factoryBody(src, factoryName) {
  const start = src.search(new RegExp(`export\\s+(?:async\\s+)?function\\s+${factoryName}\\s*\\(`));
  if (start < 0) return '';
  const rest = src.slice(start + factoryName.length);
  const nextExport = rest.search(/^export /m);
  return nextExport < 0 ? src.slice(start) : src.slice(start, start + factoryName.length + nextExport);
}

/** factory function name ("createXRouter") -> the `./file.mjs` it is imported from in `indexSrc`, repo-relative. */
function importMapOf(indexSrc) {
  const map = new Map();
  for (const m of indexSrc.matchAll(/import\s*\{([^}]+)\}\s*from\s*'(\.[^']+)'/g)) {
    const file = `ui/server/src/${m[2].replace(/^\.\//, '')}${m[2].endsWith('.mjs') ? '' : '.mjs'}`;
    for (const raw of m[1].split(',')) {
      const name = raw.trim().split(/\s+as\s+/)[0].trim();
      if (name) map.set(name, file);
    }
  }
  return map;
}

/**
 * The Cockpit server's REST route table, grouped by the first `/api/<group>` path segment: every direct
 * `app.<method>` in `ui/server/src/index.mjs` and every sub-router it mounts with `app.use('/mount',
 * createXRouter(...))`, resolved to that router's own source file and walked the same way.
 *
 * @param {string} repoRoot Repository root.
 * @returns {{groups: {group: string, routes: object[]}[], total: number}}
 */
export function collectServerRoutes(repoRoot) {
  const indexFile = path.join(repoRoot, 'ui/server/src/index.mjs');
  const indexSrc = fs.readFileSync(indexFile, 'utf8');
  const importMap = importMapOf(indexSrc);

  // Direct routes: every app.<method> in index.mjs itself, minus anything inside a mounted router's own
  // factory call (there are none — index.mjs's app.<method> calls are all top-level, never inside a
  // createXRouter(...) argument), so the whole file is one window.
  const routes = extractRoutes(indexSrc, '', 'ui/server/src/index.mjs');

  for (const m of indexSrc.matchAll(/app\.use\(\s*'([^']+)'\s*,\s*(create[A-Za-z0-9]+Router)\(/g)) {
    const mountPath = m[1];
    const factory = m[2];
    const file = importMap.get(factory);
    if (!file) continue;
    const abs = path.join(repoRoot, file);
    if (!fs.existsSync(abs)) continue;
    const body = factoryBody(fs.readFileSync(abs, 'utf8'), factory);
    routes.push(...extractRoutes(body, mountPath, file));
  }

  const byGroup = new Map();
  for (const r of routes) {
    const group = r.path.split('/').filter(Boolean)[1] || 'root'; // '/api/<group>/...'
    if (!byGroup.has(group)) byGroup.set(group, []);
    byGroup.get(group).push(r);
  }
  const groups = [...byGroup.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([group, rs]) => ({ group, routes: rs.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method)) }));
  return { groups, total: routes.length };
}

/** One route group's markdown page: a heading per route with method, path, params and description. `blobUrl`
 * turns a repo-relative path into a GitHub link (same helper build.mjs already uses for API pages). */
export function renderRouteGroupMarkdown({ group, routes }, blobUrl) {
  const lines = [`All routes sit below the Cockpit server's session gate (\`app.use('/api', auth.requireSession)\`) except \`/api/health\`. Generated from the real route table in \`ui/server/src\`.`, ''];
  for (const r of routes) {
    lines.push(`## \`${r.method} ${r.path}\``, '');
    if (r.desc) lines.push(r.desc, '');
    const rows = [];
    for (const p of r.params) rows.push(`| \`${p}\` | path | — |`);
    for (const q of r.query) rows.push(`| \`${q}\` | query | — |`);
    for (const b of r.body) rows.push(`| \`${b}\` | body | — |`);
    if (rows.length) lines.push('| Parameter | In | Type |', '|---|---|---|', ...rows, '');
    lines.push(`*Source: [\`${r.source}\`](${blobUrl(r.source)}).*`, '');
  }
  return lines.join('\n');
}
