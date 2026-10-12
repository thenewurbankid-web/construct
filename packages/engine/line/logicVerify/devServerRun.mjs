// Line logic verification, spec F (step 8): the L2 dev-server level. One unit before and after a step is checked
// through the target app's own dev server over HTTP, for the server-rendered routes that reach it. Deterministic, no
// LLM, no browser, no DOM compare (the UI is regenerated from primitives, so only logic shows: status, redirects, the
// sentinels in the HTML and the server's own fetches).
//
//   devServerPair({beforeRoot, afterRoot, before, after, routes}) -> the `dev-server` LayerResult
//     same-behaviour  every route answered the same on both sides and the unit ran on at least one of them (or the
//                     coverage could not be read, said in the reason)
//     changed         the first route whose answer differs (status, redirect, HTML sentinels or the fixture requests),
//                     the route as `input` and the recorded difference
//     cant-tell       a side did not start, a request hit the time limit, or the unit never ran on any route (the
//                     coverage says so: a "same" over code that did not run proves nothing)
//     skipped         no route reaches the unit, or the app has no `dev`/`start` script
//
// Per side, one after the other (one dev server at a time):
//   1. a local fixture server (127.0.0.1, free port) answers every request with deterministic sentinel JSON keyed by
//      method and path, and records each request (method, path, the sentinels in its URL and body);
//   2. a generated `.env.line` (in the run's temp dir, never in the app; the app's code and `.env` are never edited):
//      every env key the app reads (its source, plus the key names of its `.env*` files) gets a stub, the fixture
//      server's URL for URL-like keys and a sentinel for the rest; the stubs go into the server's environment, which
//      both Next.js and Vite rank above `.env` files;
//   3. the app's own `dev` (else `start`) script runs through npm in its own process group with a minimal environment
//      (PATH, HOME, LANG, the stubs, PORT, HOSTNAME=127.0.0.1, NODE_V8_COVERAGE): no node flags at all, so never
//      `--allow-inspector` (#877) and no NODE_OPTIONS; coverage comes from V8's own env switch, not the inspector;
//   4. each route is requested once (GET, text/html, no redirects followed), then the group gets SIGTERM (so node
//      writes the coverage), SIGKILL after a grace period, and the run dir is removed.
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { parseToAst } from '@construct/ast/parse';
import { findFunction } from './z3Translate.mjs';
import { locateUnitDifference } from './canonical.mjs';
import { FAKE_ENV, sentinel, findSentinels } from './fakes.mjs';

/** @typedef {import('./contract.mjs').LayerResult} LayerResult */
/** @typedef {import('./contract.mjs').VerdictLocation} VerdictLocation */

/** Time for one dev server to answer its first request (a cold `next dev` compiles on the first hit). */
export const DEV_STARTUP_TIMEOUT_MS = 90_000;
/** Time for one route request. */
export const DEV_REQUEST_TIMEOUT_MS = 30_000;
/** Time between SIGTERM and SIGKILL when stopping a dev server. */
export const DEV_KILL_GRACE_MS = 4_000;
/** The scripts tried, in order (the Cockpit devServer slot's order). */
export const DEV_SCRIPTS = Object.freeze(['dev', 'start']);
/** Env keys never stubbed: the runner sets them, or they belong to the toolchain. */
export const RESERVED_ENV = Object.freeze(['PATH', 'HOME', 'LANG', 'PORT', 'HOSTNAME', 'NODE_ENV', 'NODE_OPTIONS', 'NODE_V8_COVERAGE', 'NEXT_RUNTIME', 'TZ', 'TMPDIR', 'CI', 'npm_lifecycle_event']);
/** An env key whose value is a server address: its stub is the fixture server's URL. */
export const URL_KEY = /(?:^|_)(?:URL|URI|ENDPOINT|ORIGIN|HOST|BASE)(?:_|$)/i;

const SOURCE = /\.(?:[cm]?[jt]sx?)$/;
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'dist', 'build', 'out', 'coverage', '.turbo', '.vercel']);
const ENV_READ = /\bprocess\.env\.([A-Za-z_][\w]*)|\bprocess\.env\[\s*['"]([A-Za-z_][\w]*)['"]\s*\]|\bimport\.meta\.env\.([A-Za-z_][\w]*)/g;

function walk(root, dir = '', out = []) {
  let entries;
  try { entries = fs.readdirSync(path.join(root, dir), { withFileTypes: true }); } catch { return out; }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(root, rel, out); } else if (e.isFile()) out.push(rel);
  }
  return out;
}

/**
 * The env keys an app reads: `process.env.X`, `process.env['X']` and `import.meta.env.X` in its source, plus the key
 * names (never the values) of its `.env*` files, so a real value there is always overridden by a stub. Sorted, each
 * once, reserved keys left out.
 * @param {string} root
 * @returns {string[]}
 */
export function envKeysRead(root) {
  const keys = new Set();
  for (const f of walk(root)) {
    const base = path.posix.basename(f);
    if (SOURCE.test(base) && !/\.d\.ts$/.test(base)) {
      const src = fs.readFileSync(path.join(root, f), 'utf8');
      for (const m of src.matchAll(ENV_READ)) keys.add(m[1] ?? m[2] ?? m[3]);
    } else if (/^\.env(?:\..+)?$/.test(base) && base !== '.env.line' && !f.includes('/')) {
      for (const line of fs.readFileSync(path.join(root, f), 'utf8').split('\n')) {
        const m = /^\s*(?:export\s+)?([A-Za-z_][\w]*)\s*=/.exec(line);
        if (m) keys.add(m[1]);
      }
    }
  }
  return [...keys].filter((k) => !RESERVED_ENV.includes(k)).sort();
}

/**
 * The stub for each key: the fixture URL for a URL-like key (URL_KEY), else a sentinel (numbered from 300 in key order,
 * so the same keys always get the same stubs).
 * @param {string[]} keys Sorted (envKeysRead).
 * @param {{fixtureUrl: string, seed?: number}} opts
 * @returns {Record<string, string>}
 */
export function envLineStubs(keys, { fixtureUrl, seed = FAKE_ENV.seed }) {
  /** @type {Record<string, string>} */
  const out = {};
  keys.forEach((k, i) => { out[k] = URL_KEY.test(k) ? fixtureUrl : sentinel(seed, 300 + i); });
  return out;
}

/**
 * The `.env.line` text for the stubs (dotenv syntax, sorted, one header comment).
 * @param {Record<string, string>} stubs From envLineStubs.
 * @returns {string}
 */
export function formatEnvLine(stubs) {
  const lines = Object.keys(stubs).sort().map((k) => `${k}=${stubs[k]}`);
  return `# Generated by Line (logic verification L2). Stubs only; the app's own .env is never edited.\n${lines.join('\n')}\n`;
}

/** A stable small number for a string (FNV-1a), so the fixture answers a request the same way on both sides. */
function fnv(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h;
}

/**
 * The fixture server's answer to one request: JSON whose strings are sentinels numbered from the request's method and
 * path (not its order), shaped to suit list and item endpoints alike.
 * @param {string} method
 * @param {string} pathname
 * @param {number} [seed]
 * @returns {Record<string, unknown>}
 */
export function fixtureBody(method, pathname, seed = FAKE_ENV.seed) {
  const n = 1000 + (fnv(`${method} ${pathname}`) % 100_000) * 10;
  const item = (k) => ({ id: sentinel(seed, n + 2 * k), name: sentinel(seed, n + 2 * k + 1), count: 1, active: true });
  return { ...item(0), items: [item(1), item(2)], data: [item(1), item(2)], total: 2, ok: true };
}

/**
 * A local fixture server: every request is recorded and answered with fixtureBody.
 * @param {{seed?: number}} [opts]
 * @returns {Promise<{url: string, requests: Array<{method: string, path: string, sentinels: string[]}>, close: () => Promise<void>}>}
 */
export async function startFixtureServer({ seed = FAKE_ENV.seed } = {}) {
  /** @type {Array<{method: string, path: string, sentinels: string[]}>} */
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      const method = req.method ?? 'GET';
      const url = new URL(req.url ?? '/', 'http://fixture');
      requests.push({ method, path: url.pathname + url.search, sentinels: findSentinels(`${url.pathname}${url.search} ${body}`) });
      res.writeHead(200, { 'content-type': 'application/json', connection: 'close' });
      res.end(JSON.stringify(fixtureBody(method, url.pathname, seed)));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const { port } = /** @type {net.AddressInfo} */ (server.address());
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(() => resolve(undefined)); }),
  };
}

/**
 * The routes a file renders on the server, by the Next.js conventions (`app/` page and route handlers, `pages/`), with
 * or without `src/`. Route groups `(x)` and slots `@x` drop out; a dynamic segment `[x]` / `[...x]` gets a sentinel,
 * an optional catch-all `[[...x]]` drops out; a private `_x` folder and any other file give no route.
 * @param {string} file Root-relative, forward slashes.
 * @param {number} [seed]
 * @returns {string[]}
 */
export function routesForFile(file, seed = FAKE_ENV.seed) {
  const parts = file.replace(/^src\//, '').split('/');
  const name = /** @type {string} */ (parts.pop()).replace(SOURCE, '');
  let segs;
  if (parts[0] === 'app' && (name === 'page' || name === 'route')) segs = parts.slice(1);
  else if (parts[0] === 'pages' && !name.startsWith('_')) segs = [...parts.slice(1), ...(name === 'index' ? [] : [name])];
  else return [];
  const out = [];
  let dyn = 0;
  for (const s of segs) {
    if (s.startsWith('_')) return [];
    if (/^\(.*\)$/.test(s) || s.startsWith('@') || /^\[\[\.\.\..+\]\]$/.test(s)) continue;
    out.push(/^\[.+\]$/.test(s) ? sentinel(seed, 900 + dyn++) : s);
  }
  return [`/${out.join('/')}`];
}

/**
 * The command that starts the app's dev server: its `dev` (else `start`) script through npm, in the app root, with
 * only the given environment. No node flags: the server never gets `--allow-inspector`, `--inspect` or NODE_OPTIONS.
 * @param {{root: string, port: number, stubs: Record<string, string>, coverageDir: string}} args
 * @returns {{command: string, args: string[], cwd: string, env: Record<string, string>, script: string}|{refusal: string}}
 */
export function serverSpawnSpec({ root, port, stubs, coverageDir }) {
  let scripts = {};
  try { scripts = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts ?? {}; } catch { return { refusal: 'the app has no package.json' }; }
  const script = DEV_SCRIPTS.find((s) => typeof scripts[s] === 'string' && scripts[s].trim());
  if (!script) return { refusal: 'the app has no dev or start script' };
  /** @type {Record<string, string>} */
  const env = { ...stubs, PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? os.homedir(), LANG: 'C', TZ: FAKE_ENV.timeZone, PORT: String(port), HOSTNAME: '127.0.0.1', NODE_V8_COVERAGE: coverageDir, NEXT_TELEMETRY_DISABLED: '1' };
  return { command: process.platform === 'win32' ? 'npm.cmd' : 'npm', args: ['run', '--silent', script], cwd: root, env, script };
}

/** A free port on 127.0.0.1. */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => { const { port } = /** @type {net.AddressInfo} */ (srv.address()); srv.close(() => resolve(port)); });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One GET of a route: status, redirect target and the sentinels in the body, in order of first appearance. */
async function requestRoute(port, route, timeoutMs) {
  const res = await fetch(`http://127.0.0.1:${port}${route}`, { redirect: 'manual', headers: { accept: 'text/html' }, signal: AbortSignal.timeout(timeoutMs) });
  const body = await res.text();
  return { route, status: res.status, location: res.headers.get('location'), sentinels: findSentinels(body) };
}

/**
 * Whether the unit's function ran, from the NODE_V8_COVERAGE files: true when a function of that name in a script
 * under the app root (its sources or its dev build, `.next/` included) has a non-zero count; false when coverage was
 * written but no such call shows; null when no coverage was written.
 * @param {string} coverageDir
 * @param {string} root
 * @param {string} fn
 * @returns {{ran: boolean|null, scripts: number}}
 */
export function unitRan(coverageDir, root, fn) {
  let files = [];
  try { files = fs.readdirSync(coverageDir).filter((f) => f.endsWith('.json')); } catch { return { ran: null, scripts: 0 }; }
  if (!files.length) return { ran: null, scripts: 0 };
  const rootUrl = `file://${fs.realpathSync(root)}/`;
  let scripts = 0;
  let ran = false;
  for (const f of files) {
    let data;
    try { data = JSON.parse(fs.readFileSync(path.join(coverageDir, f), 'utf8')); } catch { continue; }
    for (const s of data.result ?? []) {
      if (typeof s.url !== 'string' || !s.url.startsWith(rootUrl) || s.url.includes('/node_modules/')) continue;
      scripts++;
      if (s.functions?.some((g) => g.functionName === fn && g.ranges?.[0]?.count > 0)) ran = true;
    }
  }
  return { ran, scripts };
}

/** SIGTERM the process group, SIGKILL after the grace period; resolves when the leader has exited. */
async function stopGroup(child, graceMs) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', () => resolve(undefined)));
  const kill = (sig) => { try { process.kill(-(/** @type {number} */ (child.pid)), sig); } catch { try { child.kill(sig); } catch { /* gone */ } } };
  kill('SIGTERM');
  const timer = setTimeout(() => kill('SIGKILL'), graceMs);
  await exited;
  clearTimeout(timer);
  // the group may outlive its leader (npm exits first); give the rest the same treatment
  await sleep(50);
  kill('SIGKILL');
}

/**
 * One side: fixture server, `.env.line`, the app's dev server, every route once, then everything stopped and removed.
 * @param {{root: string, fn: string, routes: string[], seed?: number, startupMs?: number, requestMs?: number, graceMs?: number}} args
 * @returns {Promise<{ok: true, pages: Array<{route: string, status: number, location: string|null, sentinels: string[]}>, requests: Array<{method: string, path: string, sentinels: string[]}>, coverage: {ran: boolean|null, scripts: number}, envKeys: string[]}|{ok: false, reason: string, skipped?: boolean}>}
 */
export async function runDevSide({ root, fn, routes, seed = FAKE_ENV.seed, startupMs = DEV_STARTUP_TIMEOUT_MS, requestMs = DEV_REQUEST_TIMEOUT_MS, graceMs = DEV_KILL_GRACE_MS }) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'construct-lv-devserver-')));
  const fixture = await startFixtureServer({ seed });
  /** @type {import('node:child_process').ChildProcess|null} */
  let child = null;
  try {
    const keys = envKeysRead(root);
    const stubs = envLineStubs(keys, { fixtureUrl: fixture.url, seed });
    fs.writeFileSync(path.join(dir, '.env.line'), formatEnvLine(stubs));
    const coverageDir = path.join(dir, 'coverage');
    fs.mkdirSync(coverageDir);
    const port = await freePort();
    const spec = serverSpawnSpec({ root, port, stubs, coverageDir });
    if ('refusal' in spec) return { ok: false, skipped: true, reason: spec.refusal };
    const proc = spawn(spec.command, spec.args, { cwd: spec.cwd, env: spec.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child = proc;
    let output = '';
    proc.stdout?.on('data', (d) => { output = (output + d).slice(-4000); });
    proc.stderr?.on('data', (d) => { output = (output + d).slice(-4000); });
    proc.on('error', (e) => { output += `\n${e.message}`; });
    const deadline = Date.now() + startupMs;
    let up = false;
    while (Date.now() < deadline && proc.exitCode === null && proc.signalCode === null) {
      try { await fetch(`http://127.0.0.1:${port}/`, { redirect: 'manual', signal: AbortSignal.timeout(1000) }); up = true; break; } catch { await sleep(150); }
    }
    if (!up) {
      const last = output.trim().split('\n').filter(Boolean).pop() ?? '';
      return { ok: false, reason: proc.exitCode !== null ? `the dev server (npm run ${spec.script}) exited with code ${proc.exitCode}${last ? `: ${last}` : ''}` : `the dev server did not answer within ${startupMs} ms` };
    }
    fixture.requests.length = 0; // the readiness probe's own fetches are not the routes'
    const pages = [];
    for (const route of routes) {
      try { pages.push(await requestRoute(port, route, requestMs)); } catch (e) {
        return { ok: false, reason: `${route} did not answer: ${/** @type {Error} */ (e).message}` };
      }
    }
    await stopGroup(proc, graceMs);
    child = null;
    const requests = [...fixture.requests].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    return { ok: true, pages, requests, coverage: unitRan(coverageDir, root, fn), envKeys: keys };
  } finally {
    if (child) await stopGroup(child, graceMs);
    await fixture.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** One plain-English sentence for the first difference between two answers of one route. */
function pageDifference(b, a) {
  if (b.status !== a.status) return `${b.route} answered ${b.status} before and ${a.status} after`;
  if (b.location !== a.location) return `${b.route} redirected to ${b.location ?? 'nowhere'} before and ${a.location ?? 'nowhere'} after`;
  return `the sentinels in ${b.route}'s HTML differ (${b.sentinels.join(', ') || 'none'} before, ${a.sentinels.join(', ') || 'none'} after)`;
}
const reqText = (r) => `${r.method} ${r.path}`;

/** The location of a change in the unit: the AST locator, else the after function's first line. */
function changeLocation(beforeRoot, afterRoot, before, after) {
  const read = (root, file) => { try { return fs.readFileSync(path.join(root, file), 'utf8'); } catch { return null; } };
  const bs = read(beforeRoot, before.file);
  const as = read(afterRoot, after.file);
  if (bs !== null && as !== null) {
    try {
      const loc = locateUnitDifference({ source: bs, file: before.file, fn: before.fn }, { source: as, file: after.file, fn: after.fn });
      if (loc) return loc;
      const node = findFunction(parseToAst(as), after.fn);
      if (node) return { astPath: after.fn, file: after.file, line: node.loc.start.line, column: node.loc.start.column + 1 };
    } catch { /* fall through */ }
  }
  return { astPath: after.fn, file: after.file, line: 1 };
}

/**
 * The L2 `dev-server` LayerResult for one unit pair.
 * @param {object} args
 * @param {string} args.beforeRoot
 * @param {string} args.afterRoot
 * @param {{file: string, fn: string}} args.before
 * @param {{file: string, fn: string}} args.after
 * @param {string[]} [args.routes] The server-rendered routes that reach the unit (the G1 impact graph's); default
 *   routesForFile of the after file.
 * @param {number} [args.seed]
 * @param {number} [args.startupMs]
 * @param {number} [args.requestMs]
 * @param {number} [args.graceMs]
 * @returns {Promise<LayerResult & {unitRan?: {before: {ran: boolean|null, scripts: number}, after: {ran: boolean|null, scripts: number}}}>}
 *   `unitRan` (not LayerResult.coverage, which is #883's branch-count shape): whether V8 saw the unit run on each side.
 */
export async function devServerPair({ beforeRoot, afterRoot, before, after, routes, seed = FAKE_ENV.seed, startupMs, requestMs, graceMs }) {
  const t0 = performance.now();
  const done = (r) => ({ layer: /** @type {const} */ ('dev-server'), ...r, ms: Math.round(performance.now() - t0) });
  const list = routes?.length ? routes : routesForFile(after.file, seed);
  if (!list.length) return done({ outcome: 'skipped', reason: `no server-rendered route reaches ${after.fn}` });
  const opts = { routes: list, seed, startupMs, requestMs, graceMs };
  const b = await runDevSide({ root: beforeRoot, fn: before.fn, ...opts });
  if ('reason' in b) return done({ outcome: b.skipped ? 'skipped' : 'cant-tell', reason: `before: ${b.reason}` });
  const a = await runDevSide({ root: afterRoot, fn: after.fn, ...opts });
  if ('reason' in a) return done({ outcome: a.skipped ? 'skipped' : 'cant-tell', reason: `after: ${a.reason}` });
  const unitRan = { before: b.coverage, after: a.coverage };
  for (let i = 0; i < list.length; i++) {
    const [pb, pa] = [b.pages[i], a.pages[i]];
    if (JSON.stringify(pb) === JSON.stringify(pa)) continue;
    return done({ outcome: 'changed', input: { route: list[i] }, location: changeLocation(beforeRoot, afterRoot, before, after), reason: pageDifference(pb, pa), unitRan });
  }
  if (JSON.stringify(b.requests) !== JSON.stringify(a.requests)) {
    const bt = b.requests.map(reqText);
    const at = a.requests.map(reqText);
    const gone = bt.filter((r) => !at.includes(r));
    const added = at.filter((r) => !bt.includes(r));
    const what = gone.length || added.length
      ? `the server's fetches differ (${gone.length ? `only before: ${gone.join(', ')}` : ''}${gone.length && added.length ? '; ' : ''}${added.length ? `only after: ${added.join(', ')}` : ''})`
      : "the server's fetches carry different sentinels";
    return done({ outcome: 'changed', input: { route: list.join(', ') }, location: changeLocation(beforeRoot, afterRoot, before, after), reason: what, unitRan });
  }
  if (b.coverage.ran === false && a.coverage.ran === false) {
    return done({ outcome: 'cant-tell', reason: `${after.fn} never ran on ${list.join(', ')} (V8 coverage), so the same answers prove nothing about it`, unitRan });
  }
  const unread = b.coverage.ran === null || a.coverage.ran === null;
  return done({ outcome: 'same-behaviour', reason: `${list.join(', ')} answered the same on both sides${unread ? '; the V8 coverage could not be read, so whether the unit ran is not known' : ''}`, unitRan });
}
