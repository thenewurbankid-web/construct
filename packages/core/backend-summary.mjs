// `construct summarize --backend <dir>` (#634): an on-demand, read-only summary of a Node.js / Express backend: the route
// map, each file's role, the import graph with its cycles, environment reads (names only) and effects (fs, child_process,
// network, timers). Deterministic, no model, no rules, no restructuring of the target project; it writes nothing.
//
// The AST facts come from packages/ast (backendFacts.mjs, backendEffects.mjs); the cross-file route walk is
// backend-routes.mjs, the role classifier backend-roles.mjs. This module scans, assembles the `backend-summary.v1`
// document (schemas/backend-summary.v1.json) and renders the compact human view. Express and plain Node servers only.
import fs from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';
import { parseToAst } from '../../packages/ast/parse.mjs';
import { collectBackendFacts } from '../../packages/ast/backendFacts.mjs';
import { collectEffects, collectEnvReads } from '../../packages/ast/backendEffects.mjs';
import { findProjectRoot } from './config.mjs';
import { ConstructError, EXIT_CODES } from './diagnostics.mjs';
import { mapRoutes } from './backend-routes.mjs';
import { BACKEND_ROLES, classifyBackendFile, isBackendTestPath, readBackendConfig } from './backend-roles.mjs';

/** The schema id of the document `summarizeBackend` returns (`schemas/backend-summary.v1.json`). */
export const BACKEND_SUMMARY_SCHEMA = 'backend-summary.v1';

/**
 * The bounds of the JSON document: most scanned files, source size, and how many entries of each list are kept (the `counts` always
 * hold the true totals, and `truncated` says what was cut).
 *
 * @type {Readonly<Record<string, number>>}
 */
export const BACKEND_LIMITS = Object.freeze({
  scanFiles: 3000, fileBytes: 1_000_000, routes: 600, mounts: 200, middleware: 200, files: 1000, edges: 3000, cycles: 50, env: 300, envReads: 20, effects: 600, unmounted: 100,
});

const SOURCE_EXT = ['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts'];
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'coverage', 'out', '.turbo', '.cache']);
const FS_WRITE_OP = /^(write|append|mkdir|mkdtemp|rm|unlink|rename|copy|cp|truncate|chmod|chown|symlink|link|utimes|createWriteStream|open$)/i;
const BUILTINS = new Set(builtinModules.map((m) => m.replace(/^node:/, '')));

/** All source files under `dir`, sorted, symbolic links never followed. */
function scanFiles(dir) {
  const out = [];
  const visit = (d) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      if (e.isSymbolicLink()) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) visit(p); } else if (e.isFile() && SOURCE_EXT.includes(path.extname(e.name)) && !e.name.endsWith('.d.ts')) out.push(p);
    }
  };
  visit(dir);
  return out;
}

const relTo = (root, abs) => path.relative(root, abs).split(path.sep).join('/');
const packageName = (spec) => { const s = spec.replace(/^node:/, ''); return s.startsWith('@') ? s.split('/').slice(0, 2).join('/') : s.split('/')[0]; };

/** Tarjan's strongly connected components over `edges` (a Map of node to sorted targets); returns the components with a cycle. */
function cyclesOf(nodes, edges) {
  let counter = 0;
  const index = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  const found = [];
  const strong = (v) => {
    index.set(v, counter); low.set(v, counter); counter += 1; stack.push(v); onStack.add(v);
    for (const w of edges.get(v) ?? []) {
      if (!index.has(w)) { strong(w); low.set(v, Math.min(low.get(v), low.get(w))); } else if (onStack.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
    }
    if (low.get(v) === index.get(v)) {
      const comp = [];
      let w;
      do { w = stack.pop(); onStack.delete(w); comp.push(w); } while (w !== v);
      if (comp.length > 1 || (edges.get(v) ?? []).includes(v)) found.push(comp.sort());
    }
  };
  for (const n of nodes) if (!index.has(n)) strong(n);
  return found.sort((a, b) => (a[0] < b[0] ? -1 : 1)).map((files) => {
    // the shortest cycle through the first file, so the report names a concrete loop
    const start = files[0];
    const inComp = new Set(files);
    const prev = new Map();
    const queue = [start];
    let closing = null;
    while (queue.length && !closing) {
      const v = queue.shift();
      for (const w of edges.get(v) ?? []) {
        if (!inComp.has(w)) continue;
        if (w === start) { closing = v; break; }
        if (!prev.has(w)) { prev.set(w, v); queue.push(w); }
      }
    }
    const loop = [];
    for (let v = closing; v !== undefined; v = v === start ? undefined : prev.get(v)) loop.unshift(v);
    return { files, path: [...loop, start] };
  });
}

/**
 * The directory `summarize --backend` reads when none is given: `backend.dir` from architecture.yml (project-relative), else the
 * project root. The configured directory must stay inside the project root.
 *
 * @param {string} root Project root.
 * @returns {string} An absolute directory path.
 * @throws {Error} A usage error when `backend.dir` leaves the project root, or the `backend:` section is invalid.
 *
 * @example
 * resolveBackendDir('/work/app'); // => '/work/app/server/src' when architecture.yml says `backend: { dir: server/src }`
 */
export function resolveBackendDir(root) {
  const configured = readBackendConfig(root).dir;
  if (!configured) return path.resolve(root);
  const abs = path.resolve(root, configured);
  const inside = path.relative(path.resolve(root), abs);
  if (inside.startsWith('..') || path.isAbsolute(inside)) throw new ConstructError(`Invalid 'backend' section in architecture.yml: dir '${configured}' leaves the project root.`, { exitCode: EXIT_CODES.USAGE_ERROR });
  return abs;
}

/**
 * Summarize a Node.js / Express backend directory. Read-only: it reads sources and `architecture.yml`, writes nothing.
 * Every path in the result is relative to the project root (the nearest ancestor with an `architecture.yml`, else the
 * directory itself), never absolute.
 *
 * @param {string} dir The backend directory (absolute, or relative to the current directory).
 * @param {{root?: string}} [opts] `root`: the project root that paths are relative to and that `architecture.yml` is read from (default: found from `dir`).
 * @returns {object} A `backend-summary.v1` document: `counts`, `detection` (framework, what was not detected), `routes`, `mounts`, `middleware`, `unmounted`, `httpServers`, `files` (role and reason), `imports` (edges, cycles, packages), `env`, `effects` and `truncated`.
 * @throws {Error} A usage error when `dir` is not a directory inside the project root, or the `backend:` section of `architecture.yml` is invalid.
 *
 * @example
 * const s = summarizeBackend('ui/server/src');
 * s.routes[0]; // => { method: 'GET', path: '/api/health', handler: { file: 'ui/server/src/index.mjs', name: null, inline: true }, ... }
 */
export function summarizeBackend(dir, { root } = {}) {
  const dirAbs = path.resolve(dir);
  let stat = null;
  try { stat = fs.statSync(dirAbs); } catch { /* reported below */ }
  if (!stat?.isDirectory()) throw new ConstructError(`Backend directory not found: ${dir}`, { exitCode: EXIT_CODES.USAGE_ERROR });
  const rootAbs = path.resolve(root ?? findProjectRoot(dirAbs) ?? dirAbs);
  const inside = path.relative(rootAbs, dirAbs);
  if (inside.startsWith('..') || path.isAbsolute(inside)) throw new ConstructError(`Backend directory ${dir} is outside the project root.`, { exitCode: EXIT_CODES.USAGE_ERROR });
  const config = readBackendConfig(rootAbs);

  const notes = [];
  let abs = scanFiles(dirAbs);
  if (abs.length > BACKEND_LIMITS.scanFiles) { notes.push(`Scanned the first ${BACKEND_LIMITS.scanFiles} of ${abs.length} source files.`); abs = abs.slice(0, BACKEND_LIMITS.scanFiles); }
  const rels = abs.map((a) => relTo(rootAbs, a));
  const relSet = new Set(rels);
  const dirRel = relTo(rootAbs, dirAbs);

  // ---- parse every non-test file ----
  const parsed = new Map(); // rel -> { source, ast, facts, envReads, effects, loc }
  const unparsed = [];
  const info = new Map();
  abs.forEach((a, i) => {
    const rel = rels[i];
    const toDir = dirRel ? rel.slice(dirRel.length + 1) : rel;
    const isTest = isBackendTestPath(toDir);
    let source = '';
    try {
      if (fs.statSync(a).size > BACKEND_LIMITS.fileBytes) { unparsed.push({ file: rel, reason: 'larger than 1 MB, not read' }); info.set(rel, { toDir, isTest, loc: 0 }); return; }
      source = fs.readFileSync(a, 'utf8');
    } catch { unparsed.push({ file: rel, reason: 'unreadable' }); info.set(rel, { toDir, isTest, loc: 0 }); return; }
    const loc = source.length === 0 ? 0 : source.split('\n').length - (source.endsWith('\n') ? 1 : 0);
    info.set(rel, { toDir, isTest, loc });
    if (isTest) return;
    try {
      const ast = parseToAst(source);
      const facts = collectBackendFacts(ast, source);
      parsed.set(rel, { facts, effects: collectEffects(ast, facts), envReads: collectEnvReads(ast, source) });
    } catch (e) {
      unparsed.push({ file: rel, reason: `parse error: ${String(e.message ?? e).split('\n')[0].slice(0, 100)}` });
    }
  });

  // ---- import resolution ----
  const EXTS = ['', '.mjs', '.js', '.cjs', '.ts', '.mts', '.cts', '.jsx', '.tsx'];
  const resolveRel = (fromRel, specifier) => {
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), specifier));
    const twins = /\.m?js$|\.cjs$/.test(base) ? [base.replace(/\.js$/, '.ts').replace(/\.mjs$/, '.mts').replace(/\.cjs$/, '.cts')] : [];
    const candidates = [...EXTS.map((e) => base + e), ...twins, ...EXTS.slice(1).map((e) => `${base}/index${e}`)];
    for (const c of candidates) if (relSet.has(c)) return { kind: 'local', rel: c };
    for (const c of candidates) {
      const p = path.join(rootAbs, c);
      try { if (!c.startsWith('..') && fs.statSync(p).isFile()) return { kind: 'outside', rel: c }; } catch { /* next */ }
    }
    return { kind: 'unresolved' };
  };
  const resolveLocal = (fromRel, spec) => { const r = resolveRel(fromRel, spec); return r.kind === 'local' ? r.rel : null; };

  // ---- route map ----
  const routeMap = mapRoutes({ files: new Map([...parsed].map(([rel, p]) => [rel, { facts: p.facts }])), resolveImport: resolveLocal });

  // ---- import graph, packages, env, effects ----
  const edges = [];
  const outside = [];
  const unresolved = [];
  const pkgFiles = new Map();
  const perFile = new Map();
  for (const rel of [...parsed.keys()].sort()) {
    const { facts } = parsed.get(rel);
    const seenEdge = new Set();
    const pkgs = new Set();
    for (const im of facts.imports) {
      if (im.specifier.startsWith('.')) {
        const r = resolveRel(rel, im.specifier);
        if (r.kind === 'local') { const k = `${r.rel}`; if (!seenEdge.has(k)) { seenEdge.add(k); edges.push({ from: rel, to: r.rel, line: im.line, kind: im.kind }); } } else if (r.kind === 'outside') outside.push({ from: rel, to: r.rel, line: im.line });
        else unresolved.push({ from: rel, specifier: im.specifier, line: im.line });
      } else if (!im.specifier.startsWith('/')) pkgs.add(packageName(im.specifier));
    }
    for (const p of pkgs) { if (!pkgFiles.has(p)) pkgFiles.set(p, new Set()); pkgFiles.get(p).add(rel); }
    perFile.set(rel, pkgs);
  }
  edges.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : a.line - b.line || (a.to < b.to ? -1 : 1)));
  const graph = new Map();
  for (const rel of parsed.keys()) graph.set(rel, []);
  for (const e of edges) if (graph.has(e.to)) graph.get(e.from).push(e.to);
  for (const list of graph.values()) list.sort();
  const cycles = cyclesOf([...parsed.keys()].sort(), graph);

  const envByName = new Map();
  const effects = [];
  for (const rel of [...parsed.keys()].sort()) {
    const p = parsed.get(rel);
    for (const r of p.envReads) {
      if (!envByName.has(r.name)) envByName.set(r.name, []);
      const list = envByName.get(r.name);
      if (!list.some((x) => x.file === rel && x.line === r.line)) list.push({ file: rel, line: r.line });
    }
    for (const e of p.effects) effects.push({ file: rel, kind: e.kind, op: e.op, line: e.line });
  }

  // ---- roles ----
  const routesByFile = new Map();
  for (const r of [...routeMap.routes, ...routeMap.unmounted]) routesByFile.set(r.file, (routesByFile.get(r.file) ?? 0) + 1);
  const isAppFile = new Set(routeMap.apps.map((a) => a.file));
  const files = rels.map((rel) => {
    const i = info.get(rel);
    const p = parsed.get(rel);
    const counts = {};
    for (const e of p?.effects ?? []) counts[e.kind] = (counts[e.kind] ?? 0) + 1;
    const exportsRouter = Boolean(p && [...p.facts.functions.values()].some((f) => f.returns.length > 0 && [...p.facts.exports.values()].some((x) => x.fn === f.id || (x.local && p.facts.lookup(['m'], x.local)?.fnId === f.id))));
    const routerExported = Boolean(p && [...p.facts.exports.values()].some((x) => x.local && p.facts.lookup(['m'], x.local)?.kind === 'router'));
    const verdict = classifyBackendFile({
      rel, dirRel: i.toDir, isTest: i.isTest,
      routing: { routes: routesByFile.get(rel) ?? 0, isApp: isAppFile.has(rel), exportsRouter: exportsRouter || routerExported },
      effects: counts, envReads: p?.envReads.length ?? 0, exportCount: p ? p.facts.exports.size : 0,
      signals: {
        fsWrites: (p?.effects ?? []).filter((e) => e.kind === 'fs' && FS_WRITE_OP.test(e.op)).length,
        wsServer: (p?.effects ?? []).some((e) => e.op === 'websocket-server'),
      },
    }, config.roles);
    return { path: rel, role: verdict.role, reason: verdict.reason, source: verdict.source, loc: i.loc, ...(Object.keys(counts).length ? { effects: counts } : {}), ...(p?.envReads.length ? { env: p.envReads.length } : {}) };
  });
  const roleCounts = Object.fromEntries(BACKEND_ROLES.map((r) => [r, files.filter((f) => f.role === r).length]));

  // ---- assemble, bounded ----
  const cap = (list, n) => list.slice(0, n);
  const envList = [...envByName.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([name, reads]) => ({ name, readCount: reads.length, reads: cap(reads, BACKEND_LIMITS.envReads) }));
  const packages = [...pkgFiles.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([name, set]) => ({ name, files: set.size, builtin: BUILTINS.has(name) }));
  const effectCounts = {};
  for (const e of effects) effectCounts[e.kind] = (effectCounts[e.kind] ?? 0) + 1;
  const manyApps = routeMap.apps.length > 1;
  const strip = (r) => { const { mounted, app, ...rest } = r; return { ...rest, ...(manyApps && app ? { app } : {}), ...(mounted === false ? { mounted: false } : {}) }; };
  const routeRows = routeMap.routes.map(strip);
  const notDetected = [
    ...routeMap.unresolvedMounts.map((m) => ({ what: 'mount', file: m.file, line: m.line, detail: `${m.path} <- ${m.expression}: ${m.reason}` })),
    ...routeMap.httpServers.filter((s) => s.note).map((s) => ({ what: 'http-server', file: s.file, line: s.line, detail: s.note })),
    ...routeMap.routes.filter((r) => r.dynamicPath).map((r) => ({ what: 'route-path', file: r.file, line: r.line, detail: `computed path ${r.path}` })),
    ...unparsed.map((u) => ({ what: 'file', file: u.file, line: 0, detail: u.reason })),
  ];
  const truncated = {};
  const keep = (name, list, n) => { if (list.length > n) truncated[name] = list.length - n; return cap(list, n); };

  const summary = {
    schema: BACKEND_SUMMARY_SCHEMA,
    dir: dirRel || '.',
    counts: {
      files: files.length, testFiles: roleCounts.test, routes: routeRows.length, mounts: routeMap.mounts.length, middleware: routeMap.middleware.length,
      unmountedRoutes: routeMap.unmounted.length, edges: edges.length, cycles: cycles.length, envVars: envList.length, effects: effects.length, notDetected: notDetected.length,
    },
    detection: { framework: routeMap.framework, apps: routeMap.apps.map((a) => ({ file: a.file, line: a.line })), notes, notDetected: keep('notDetected', notDetected, 100) },
    routes: keep('routes', routeRows, BACKEND_LIMITS.routes),
    mounts: keep('mounts', routeMap.mounts.map(({ app, ...m }) => (manyApps ? { ...m, app } : m)), BACKEND_LIMITS.mounts),
    middleware: keep('middleware', routeMap.middleware, BACKEND_LIMITS.middleware),
    unmounted: keep('unmounted', routeMap.unmounted.map(strip), BACKEND_LIMITS.unmounted),
    httpServers: routeMap.httpServers,
    files: { roles: roleCounts, list: keep('files', files, BACKEND_LIMITS.files) },
    imports: {
      edges: keep('edges', edges.map(({ from, to, line }) => ({ from, to, line })), BACKEND_LIMITS.edges),
      cycles: keep('cycles', cycles, BACKEND_LIMITS.cycles),
      outside: cap(outside, 50),
      unresolved: cap(unresolved, 50),
      packages,
    },
    env: keep('env', envList, BACKEND_LIMITS.env),
    effects: { counts: effectCounts, list: keep('effects', effects, BACKEND_LIMITS.effects) },
    truncated,
  };
  return summary;
}

// ---------------------------------------------------------------------------------------------- the human view

const pad = (s, n) => (s.length >= n ? s : s + ' '.repeat(n - s.length));
const at = (file, line) => `${file}${line ? `:${line}` : ''}`;
const handlerText = (h) => (h.inline ? (h.wrapper ? `${h.wrapper}(...)` : h.name ? `${h.name} (inline)` : '(inline)') : `${h.file ? `${path.posix.basename(h.file)}:` : ''}${h.name}${h.package ? ` [${h.package}]` : ''}`);

/**
 * The compact human view of a backend summary: a route table, mounts and middleware, what was not detected, roles with
 * the reason for each file, effects per file, environment variables and import cycles. Bounded like the JSON.
 *
 * @param {object} s The document `summarizeBackend` returned.
 * @returns {string} Plain text, one line per row.
 *
 * @example
 * console.log(renderBackendText(summarizeBackend('server/src')));
 */
export function renderBackendText(s) {
  const L = [];
  const c = s.counts;
  L.push(`Backend summary: ${s.dir}  (${s.detection.framework})`);
  L.push(`  ${c.files} files (${c.testFiles} test), ${c.routes} routes, ${c.mounts} mounts, ${c.middleware} middleware, ${c.edges} import edges, ${c.cycles} cycles, ${c.envVars} env vars, ${c.effects} effects`);
  for (const n of s.detection.notes) L.push(`  note: ${n}`);
  L.push('');
  L.push(`ROUTES (${c.routes})`);
  const mwCol = (r) => [...r.middleware, ...(r.inherited.length ? [`+${r.inherited.length} inherited`] : [])].join(', ');
  const rows = s.routes.map((r) => [r.method, r.path + (r.dynamicPath ? ' ~' : ''), handlerText(r.handler), mwCol(r), at(r.file, r.line)]);
  const widths = [0, 1, 2, 3].map((i) => Math.min(60, Math.max(0, ...rows.map((r) => r[i].length))));
  for (const r of rows) L.push(`  ${pad(r[0], widths[0])}  ${pad(r[1], widths[1])}  ${pad(r[2], widths[2])}  ${pad(r[3], widths[3])}  ${r[4]}`);
  if (s.truncated.routes) L.push(`  ... ${s.truncated.routes} more (use --format json)`);
  if (s.routes.some((r) => r.dynamicPath)) L.push('  ~ path is computed (a template or expression), shown as written');
  if (s.unmounted.length) {
    L.push('', `ROUTERS NO APP MOUNTS (${s.unmounted.length} routes; prefix not detected)`);
    for (const r of s.unmounted) L.push(`  ${pad(r.method, 7)} ${r.path}  ${handlerText(r.handler)}  ${at(r.file, r.line)}`);
  }
  if (s.httpServers.length) {
    L.push('', 'PLAIN http.createServer');
    for (const h of s.httpServers) {
      L.push(`  ${at(h.file, h.line)}${h.note ? `  (${h.note})` : ''}`);
      for (const r of h.routes) L.push(`    ${pad(r.method, 7)} ${r.path}  ${at(r.file, r.line)}`);
    }
  }
  if (s.mounts.length || s.middleware.length) {
    L.push('', `MOUNTS AND MIDDLEWARE (in registration order; ids match "inherited" in the JSON)`);
    for (const m of s.middleware) L.push(`  ${pad(m.id, 5)} use ${pad(m.path || '/', 20)} ${m.names.join(', ')}  ${at(m.file, m.line)}`);
    for (const m of s.mounts) L.push(`  mount ${pad(m.path || '/', 22)} -> ${m.target.file}${m.target.name ? ` (${m.target.name})` : ''}  from ${at(m.from.file, m.from.line)}`);
  }
  if (s.detection.notDetected.length) {
    L.push('', `NOT DETECTED (${c.notDetected})`);
    for (const n of s.detection.notDetected) L.push(`  ${n.what}: ${at(n.file, n.line)}  ${n.detail}`);
  }
  L.push('', `ROLES (${Object.entries(s.files.roles).filter(([, n]) => n).map(([r, n]) => `${r} ${n}`).join(', ')})`);
  for (const role of BACKEND_ROLES) {
    const list = s.files.list.filter((f) => f.role === role);
    if (!list.length) continue;
    if (role === 'test') { L.push(`  test (${list.length}): ${list[0].reason}`); continue; }
    L.push(`  ${role} (${list.length})`);
    for (const f of list) L.push(`    ${f.path}  [${f.reason}]`);
  }
  L.push('', `EFFECTS (${Object.entries(s.effects.counts).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'})`);
  const byFile = new Map();
  for (const e of s.effects.list) { if (!byFile.has(e.file)) byFile.set(e.file, new Map()); const m = byFile.get(e.file); const k = `${e.kind}:${e.op}`; const cur = m.get(k) ?? { n: 0, line: e.line }; cur.n += 1; m.set(k, cur); }
  for (const [file, ops] of byFile) L.push(`  ${file}  ${[...ops].map(([k, v]) => `${k}${v.n > 1 ? ` x${v.n}` : ''} (l.${v.line})`).join(', ')}`);
  if (s.truncated.effects) L.push(`  ... ${s.truncated.effects} more (use --format json)`);
  L.push('', `ENVIRONMENT (${s.env.length} names, never values)`);
  for (const e of s.env) L.push(`  ${pad(e.name, 34)} ${e.reads.slice(0, 3).map((r) => at(r.file, r.line)).join(', ')}${e.readCount > 3 ? `, +${e.readCount - 3}` : ''}`);
  L.push('', `IMPORT GRAPH: ${c.edges} edges, ${s.imports.packages.length} packages, ${c.cycles} cycle${c.cycles === 1 ? '' : 's'}`);
  for (const cy of s.imports.cycles) L.push(`  cycle: ${cy.path.join(' -> ')}`);
  return L.join('\n');
}
