#!/usr/bin/env node
// Mission Control: a local, read-only live dashboard of the Construct repo (bench telemetry, worktrees, commits,
// machine, one event log). Node core only, no LLM. Binds 127.0.0.1.
//
//   node packages/tools/dev/mission-control/server.mjs            # http://127.0.0.1:4777
//   MC_PORT=4888 MC_REPO=/path/to/construct node .../server.mjs
//
// Streams server-sent events at /events (?run=<run dir> pins a bench run; default: the newest run under
// bench/ecommerce/runs/ in the main checkout and every worktree). Polls: bench files 1 s (plus fs.watch), machine 2 s,
// git 5 s, worktree details rolling 12 per 5 s (there can be hundreds). See README.md.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { RUNS_REL, discoverRuns, pickAutoRun, isRealRun } from './runs.mjs';
import { runTailer } from './run-tailer.mjs';
import { handleContextRoute } from './context-view.mjs';
import { readPlanJev } from './plan-jev.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.MC_PORT ?? 4777);
const HOST = '127.0.0.1';
const BRANCH = process.env.MC_BRANCH ?? 'work/2026-09-23';

/** The main checkout: the common git dir's parent, so a server started from a worktree still sees everything. */
function mainRepo() {
  if (process.env.MC_REPO) return path.resolve(process.env.MC_REPO);
  let d = path.resolve(here, '../../../..');
  const gitFile = path.join(d, '.git');
  try {
    if (fs.statSync(gitFile).isFile()) {
      const m = /gitdir:\s*(.+)/.exec(fs.readFileSync(gitFile, 'utf8'));
      // <main>/.git/worktrees/<name> -> <main>
      if (m) d = path.resolve(d, m[1].trim(), '../../..');
    }
  } catch { /* not a checkout; keep d */ }
  return d;
}
const REPO = mainRepo();
const SELF = path.resolve(here, '../../../..');

/** Run a command; resolve {ok, out, err} and never reject. Timeout bounded so a hung git never piles up. */
function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: opts.timeout ?? 8000, maxBuffer: 8 * 1024 * 1024, cwd: opts.cwd ?? REPO, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }, (e, out, err) => {
      resolve({ ok: !e, out: String(out ?? ''), err: String(err ?? (e ? e.message : '')) });
    });
  });
}

/** Wrap a poller so a slow pass never overlaps the next one; a repeating failure is logged once, not every tick. */
function every(ms, fn) {
  let busy = false; let lastErr = null;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try { await fn(); lastErr = null; } catch (e) {
      if (e.message !== lastErr) { lastErr = e.message; logEvent('mc', 'error', `poller failed: ${e.message}`); }
    } finally { busy = false; }
  };
  tick();
  return setInterval(tick, ms);
}

// ---------------------------------------------------------------- SSE clients and the event log
/** @type {Set<{res: http.ServerResponse, run: string|null}>} */
const clients = new Set();
const events = []; // newest last, capped
const MAX_EVENTS = 600;

function send(client, type, data) {
  try { client.res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`); } catch { clients.delete(client); }
}
function broadcast(type, data, filter = () => true) { for (const c of clients) if (filter(c)) send(c, type, data); }

function logEvent(source, level, text, extra = {}) {
  const e = { at: new Date().toISOString(), source, level, text, ...extra };
  events.push(e);
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
  broadcast('event', e);
}

// ---------------------------------------------------------------- bench runs
const EXTRA_ROOTS = process.env.MC_RUNS ? process.env.MC_RUNS.split(':') : [];

let runList = [];
let autoRun = null;


/** run dir -> tailer, for every run any client watches. */
const tailers = new Map();
function tailerFor(dir) {
  if (!dir) return null;
  let t = tailers.get(dir);
  if (!t) {
    t = runTailer(dir, { onChange: scheduleBench, extraRoots: EXTRA_ROOTS, onError: (msg) => logEvent('bench', 'error', `log reader failed (${path.relative(REPO, dir)}): ${msg}`) });
    tailers.set(dir, t); t.poll();
    // History is shown in the table, not replayed into the event log.
    for (const r of t.state.rows) t.state.evSeen.add(r.id);
    const sum = t.summary();
    t.state.ended = sum.counters.finished; t.state.stuckKey = sum.loop.current ? `${sum.loop.current.tool}|${sum.loop.current.code}` : null;
  }
  return t;
}
const clientRun = (c) => c.run ?? autoRun;

/** Events into the unified log from one tailer's delta (only for the auto run, so pinned old runs do not spam). */
function benchEvents(t, delta) {
  const s = t.state;
  for (const r of delta.upserts ?? []) {
    if (!s.evSeen.has(r.id)) {
      if (r.status === 'landed') logEvent('bench', 'good', `turn ${r.turn ?? '-'}: step landed (${r.tool})`, { row: r.id });
      else if (r.status === 'not-landed') logEvent('bench', 'warn', `turn ${r.turn ?? '-'}: step NOT landed ${r.tool} [${(r.rules ?? []).join(',')}]`, { row: r.id });
      else if (r.status === 'refused' || r.status === 'error') { s.refusalTotal += 1; if (s.refusalTotal <= 20 || s.refusalTotal % 10 === 0) logEvent('bench', r.status === 'error' ? 'bad' : 'warn', `turn ${r.turn ?? '-'}: ${r.tool} refused ${r.code} (refusal #${s.refusalTotal})`, { row: r.id }); }
      else if (r.status === 'finish') logEvent('bench', 'info', `turn ${r.turn}: builder called finish`);
      s.evSeen.add(r.id);
    }
  }
  const sum = t.summary();
  const key = sum.loop.current ? `${sum.loop.current.tool}|${sum.loop.current.code}` : null;
  if (key && key !== s.stuckKey) logEvent('bench', 'bad', `STUCK: ${sum.loop.current.tool} refused ${sum.loop.current.code} ${sum.loop.current.count}x in a row`);
  if (!key && s.stuckKey) logEvent('bench', 'good', 'loop broken: a different call or outcome');
  s.stuckKey = key;
  if (sum.counters.finished && !s.ended) { s.ended = true; logEvent('bench', 'info', `run ended: ${sum.counters.stop}`); }
}

let benchTimer = null;
let lastBench = 0;
function scheduleBench() {
  if (benchTimer) return;
  benchTimer = setTimeout(() => { benchTimer = null; if (Date.now() - lastBench > 250) benchTick(); }, 300);
}

function benchTick() {
  lastBench = Date.now();
  const watched = new Set([autoRun, ...[...clients].map((c) => c.run)].filter(Boolean));
  for (const [dir, t] of tailers) if (!watched.has(dir)) { t.close(); tailers.delete(dir); }
  for (const dir of watched) {
    const t = tailerFor(dir);
    const delta = t.poll();
    if (delta && dir === autoRun) benchEvents(t, { upserts: delta.upserts });
    const sum = t.summary();
    for (const c of clients) {
      if (clientRun(c) !== dir) continue;
      if (delta?.reset) send(c, 'bench-reset', { run: dir, ...runMode(dir, c.run) });
      if (delta?.upserts?.length || delta?.removed?.length) send(c, 'bench-rows', { run: dir, upserts: delta.upserts, removed: delta.removed });
      if (delta?.console?.length) send(c, 'bench-console', { run: dir, lines: delta.console });
      send(c, 'bench-summary', { run: dir, ...sum });
    }
  }
}

function discoverTick() {
  runList = discoverRuns(REPO, EXTRA_ROOTS);
  const next = pickAutoRun(runList)?.path ?? null;
  if (next !== autoRun) {
    const prev = autoRun;
    autoRun = next;
    if (next) logEvent('bench', 'info', `${prev ? 'newer run' : 'watching run'}: ${path.relative(REPO, next)}`);
    for (const c of clients) if (!c.run) sendBenchSnapshot(c);
  }
  broadcast('runs', runsPayload());
}

function runsPayload() {
  const real = runList.filter((r) => r.real).slice(0, 60);
  const extra = runList.filter((r) => !r.real).slice(0, 20);
  return { auto: autoRun, runs: [...real, ...extra].map((r) => ({ ...r, rel: path.relative(REPO, r.path) })) };
}

/** How the page must label a run: live only when it is the auto-picked real run (staleness is judged client-side). */
function runMode(dir, pinned) {
  if (!dir) return { real: false, pinned };
  return { real: isRealRun(dir), pinned: Boolean(pinned) };
}

function sendBenchSnapshot(c) {
  const dir = clientRun(c);
  if (!dir) { send(c, 'bench-reset', { run: null }); return; }
  const t = tailerFor(dir);
  send(c, 'bench-reset', { run: dir, rel: path.relative(REPO, dir), ...runMode(dir, c.run) });
  send(c, 'bench-rows', { run: dir, upserts: t.state.rows, removed: [] });
  send(c, 'bench-console', { run: dir, lines: t.state.console.slice(-800) });
  send(c, 'bench-summary', { run: dir, ...t.summary() });
}

// ---------------------------------------------------------------- worktrees
let worktrees = []; // {path, branch, head, commitAt, subject, dirty, activityMs, detailAt}
let wtCursor = 0;

function gitDirOf(wt) {
  const g = path.join(wt, '.git');
  try {
    const st = fs.statSync(g);
    if (st.isDirectory()) return g;
    const m = /gitdir:\s*(.+)/.exec(fs.readFileSync(g, 'utf8'));
    return m ? path.resolve(wt, m[1].trim()) : null;
  } catch { return null; }
}

/** Cheap activity signal: newest mtime of the worktree's index, HEAD and reflog. */
function activityOf(wt) {
  const gd = gitDirOf(wt);
  if (!gd) return 0;
  let m = 0;
  for (const f of ['index', 'HEAD', 'logs/HEAD']) { try { m = Math.max(m, fs.statSync(path.join(gd, f)).mtimeMs); } catch { /* absent */ } }
  return m;
}

async function worktreeListTick() {
  const r = await run('git', ['worktree', 'list', '--porcelain']);
  if (!r.ok) { broadcast('worktrees', { error: r.err.slice(0, 300), items: [] }); return; }
  const items = [];
  let cur = null;
  for (const l of r.out.split('\n')) {
    if (l.startsWith('worktree ')) { cur = { path: l.slice(9) }; items.push(cur); } else if (cur && l.startsWith('HEAD ')) cur.head = l.slice(5, 13);
    else if (cur && l.startsWith('branch ')) cur.branch = l.slice(7).replace('refs/heads/', '');
    else if (cur && l === 'detached') cur.branch = '(detached)';
    else if (cur && l.startsWith('prunable')) cur.prunable = true;
  }
  const old = new Map(worktrees.map((w) => [w.path, w]));
  for (const w of items) {
    const o = old.get(w.path);
    Object.assign(w, { commitAt: o?.commitAt ?? null, subject: o?.subject ?? null, dirty: o?.dirty ?? null, newest: o?.newest ?? null, detailAt: o?.detailAt ?? 0, detailActivity: o?.detailActivity ?? 0 });
    w.activityMs = activityOf(w.path);
    if (!o && worktrees.length) logEvent('worktree', 'info', `new worktree ${path.basename(w.path)} on ${w.branch ?? '?'}`);
    if (o && o.head !== w.head) logEvent('worktree', 'info', `${path.basename(w.path)} moved to ${w.head} (${w.branch ?? ''})`);
  }
  if (worktrees.length) for (const o of worktrees) if (!items.find((w) => w.path === o.path)) logEvent('worktree', 'info', `worktree removed ${path.basename(o.path)}`);
  worktrees = items;
  // Details (last commit, dirty count): the ones whose activity changed first, then a rolling 12.
  const changed = worktrees.filter((w) => w.activityMs > w.detailActivity).sort((a, b) => b.activityMs - a.activityMs);
  const pick = new Set(changed.slice(0, 12));
  for (let i = 0; pick.size < 12 && i < worktrees.length; i += 1) { pick.add(worktrees[(wtCursor + i) % worktrees.length]); }
  wtCursor = (wtCursor + 12) % Math.max(1, worktrees.length);
  for (const w of pick) await worktreeDetail(w);
  broadcast('worktrees', { at: Date.now(), self: SELF, items: worktrees.map(publicWt) });
}

async function worktreeDetail(w) {
  if (w.prunable) return;
  const log = await run('git', ['-C', w.path, 'log', '-1', '--format=%ct%x09%s'], { timeout: 4000 });
  if (log.ok) { const [ct, ...s] = log.out.trim().split('\t'); w.commitAt = Number(ct) * 1000; w.subject = s.join('\t').slice(0, 120); }
  const st = await run('git', ['-C', w.path, 'status', '--porcelain', '--untracked-files=normal'], { timeout: 6000 });
  if (st.ok) {
    const files = st.out.split('\n').filter(Boolean);
    w.dirty = files.length;
    let newest = 0;
    for (const f of files.slice(0, 200)) { try { newest = Math.max(newest, fs.statSync(path.join(w.path, f.slice(3).split(' -> ').pop().replace(/^"|"$/g, ''))).mtimeMs); } catch { /* deleted */ } }
    w.newest = newest || null;
  }
  w.detailAt = Date.now(); w.detailActivity = w.activityMs;
}
const publicWt = (w) => ({ path: w.path, name: path.basename(w.path), branch: w.branch ?? null, head: w.head ?? null, commitAt: w.commitAt, subject: w.subject, dirty: w.dirty, activityMs: Math.max(w.activityMs || 0, w.newest || 0) || null, prunable: Boolean(w.prunable), detailAt: w.detailAt });

// ---------------------------------------------------------------- commits
const seenCommits = new Set();
let commitFeed = [];
async function commitsTick() {
  const r = await run('git', ['log', '-n', '60', '--date-order', '--format=%H%x09%ct%x09%an%x09%D%x09%s', BRANCH, '--branches=og/*', '--']);
  if (!r.ok) { broadcast('commits', { error: r.err.slice(0, 300), items: commitFeed }); return; }
  const first = seenCommits.size === 0;
  const fresh = [];
  const items = r.out.split('\n').filter(Boolean).map((l) => { const [sha, ct, author, refs, ...s] = l.split('\t'); return { sha: sha.slice(0, 10), at: Number(ct) * 1000, author, refs, subject: s.join('\t') }; });
  for (const c of items) if (!seenCommits.has(c.sha)) { seenCommits.add(c.sha); if (!first) fresh.push(c); }
  // Branch for each commit: the refs that contain it are expensive; name-rev on the new ones only.
  for (const c of fresh) {
    const n = await run('git', ['name-rev', '--name-only', '--refs=og/*', `--refs=${BRANCH}`, c.sha], { timeout: 3000 });
    c.branch = n.ok ? n.out.trim() : '';
    logEvent('commit', 'good', `${c.sha.slice(0, 8)} ${c.branch ? `[${c.branch}] ` : ''}${c.subject.slice(0, 100)}`);
  }
  const known = new Map(commitFeed.map((c) => [c.sha, c]));
  commitFeed = items.map((c) => ({ ...c, branch: known.get(c.sha)?.branch ?? c.branch ?? null, fresh: fresh.includes(c) || known.get(c.sha)?.fresh || false }));
  broadcast('commits', { branch: BRANCH, items: commitFeed });
}

// ---------------------------------------------------------------- machine
let lockPath = process.env.CONSTRUCT_HEAVY_LOCK ?? null;
// Heavy jobs worth seeing. Shell wrappers (`zsh -c ...`) are skipped; a match under a matched ancestor (node --test
// workers under run-tests.mjs, npm under heavy.sh) folds into that ancestor as a worker count, so the list and the
// event log show one line per job, not one per test file.
const HEAVY_RE = /(run-tests\.mjs|node (--[a-z-]+(=\S+)? )*--test\b|playwright|qwen-agent\.mjs|npm ci|npm test|next dev|next-server|heavy\.sh|tsc --noEmit|ollama runner)/;
const SHELL_RE = /^(\/bin\/|\/usr\/bin\/)?(zsh|bash|sh) -c /;
let procs = new Map();
let procsInit = false;

async function memory() {
  if (process.platform === 'linux') {
    try {
      const m = Object.fromEntries(fs.readFileSync('/proc/meminfo', 'utf8').split('\n').filter(Boolean).map((l) => { const [k, v] = l.split(':'); return [k, parseInt(v, 10) * 1024]; }));
      return { total: m.MemTotal, available: m.MemAvailable, used: m.MemTotal - m.MemAvailable, swapUsed: (m.SwapTotal ?? 0) - (m.SwapFree ?? 0), source: '/proc/meminfo' };
    } catch { /* fall through */ }
  }
  if (process.platform === 'darwin') {
    const v = await run('vm_stat', [], { timeout: 2000 });
    if (v.ok) {
      const page = Number(/page size of (\d+)/.exec(v.out)?.[1] ?? 4096);
      const g = (k) => Number(new RegExp(`${k}:\\s+(\\d+)`).exec(v.out)?.[1] ?? 0) * page;
      const total = os.totalmem();
      const available = g('Pages free') + g('Pages inactive') + g('Pages speculative') + g('Pages purgeable');
      return { total, available, used: total - available, wired: g('Pages wired down'), compressed: g('Pages occupied by compressor'), source: 'vm_stat' };
    }
  }
  return { total: os.totalmem(), available: os.freemem(), used: os.totalmem() - os.freemem(), source: 'os.freemem' };
}

function heavyLock() {
  if (!lockPath) return { path: null };
  const out = { path: lockPath, held: false, holder: null };
  try { out.holder = fs.readFileSync(`${lockPath}.holder`, 'utf8').trim().slice(0, 400); } catch { /* none */ }
  try {
    // macOS: mkdir lock dir with a pid file. Linux: flock on the file; the holder file is the only readable signal.
    const pid = fs.readFileSync(path.join(`${lockPath}.d`, 'pid'), 'utf8').trim();
    out.pid = Number(pid); out.held = pidAlive(out.pid);
  } catch {
    const hp = Number(/pid[=: ]+(\d+)/i.exec(out.holder ?? '')?.[1] ?? /^(\d+)/.exec(out.holder ?? '')?.[1] ?? NaN);
    if (hp) { out.pid = hp; out.held = pidAlive(hp); }
  }
  return out;
}
function pidAlive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }

async function machineTick() {
  const [mem, ps, ol] = await Promise.all([memory(), run('ps', ['-axo', 'pid=,ppid=,etime=,rss=,command='], { timeout: 3000 }), ollamaPs()]);
  const list = [];
  if (ps.ok) {
    const all = new Map();
    for (const l of ps.out.split('\n')) {
      const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\d+)\s+(.*)$/.exec(l);
      if (!m) continue;
      const cmd = m[5];
      const hit = Number(m[1]) !== process.pid && HEAVY_RE.test(cmd) && !SHELL_RE.test(cmd) && !/mission-control/.test(cmd);
      all.set(Number(m[1]), { pid: Number(m[1]), ppid: Number(m[2]), etime: m[3], rssKb: Number(m[4]), cmd, hit });
    }
    const rootOf = (p) => { let top = null; let cur = all.get(p.ppid); for (let i = 0; cur && i < 30; i += 1) { if (cur.hit) top = cur; cur = all.get(cur.ppid); } return top; };
    const roots = new Map();
    for (const p of all.values()) {
      if (!p.hit) continue;
      const r = rootOf(p);
      if (r) { const e = roots.get(r.pid) ?? { ...r, workers: 0, rssKbAll: r.rssKb }; e.workers += 1; e.rssKbAll += p.rssKb; roots.set(r.pid, e); } else if (!roots.has(p.pid)) roots.set(p.pid, { ...p, workers: 0, rssKbAll: p.rssKb });
    }
    for (const p of roots.values()) list.push({ pid: p.pid, etime: p.etime, rssMb: Math.round(p.rssKbAll / 1024), workers: p.workers, cmd: p.cmd.slice(0, 220) });
  }
  const next = new Map(list.map((p) => [p.pid, p]));
  if (procsInit) {
    for (const [pid, p] of next) if (!procs.has(pid)) logEvent('process', 'info', `started ${pid}: ${p.cmd.slice(0, 120)}`);
    for (const [pid, p] of procs) if (!next.has(pid)) logEvent('process', 'info', `ended ${pid}: ${p.cmd.slice(0, 120)}`);
  }
  procs = next; procsInit = true;
  broadcast('machine', { at: Date.now(), platform: process.platform, load: os.loadavg(), cpus: os.cpus().length, mem, lock: heavyLock(), procs: list, ollama: ol });
}

let lastOllama = { ok: false, models: [], at: 0 };
async function ollamaPs() {
  if (Date.now() - lastOllama.at < 5000) return lastOllama;
  const r = await run('ollama', ['ps'], { timeout: 2500 });
  const rows = r.ok ? r.out.split('\n').slice(1).filter(Boolean).map((l) => l.split(/\s{2,}/)) : [];
  const models = rows.map((c) => ({ name: c[0], id: c[1], size: c[2], processor: c[3], until: c.slice(4).join(' ') }));
  const prev = new Set(lastOllama.models.map((m) => m.name));
  if (lastOllama.at) {
    for (const m of models) if (!prev.has(m.name)) logEvent('ollama', 'info', `model loaded ${m.name} (${m.size})`);
    for (const n of prev) if (!models.find((m) => m.name === n)) logEvent('ollama', 'info', `model unloaded ${n}`);
  }
  lastOllama = { ok: r.ok, error: r.ok ? null : r.err.trim().split('\n')[0].slice(0, 200), models, at: Date.now() };
  return lastOllama;
}

// ---------------------------------------------------------------- HTTP
function readBody(file) { try { return fs.readFileSync(file); } catch { return null; } }

/** Only run dirs we discovered (or that sit under a known runs root) may be read: no arbitrary file serving. */
function allowedRun(p) {
  if (!p) return null;
  const abs = path.resolve(p);
  if (runList.some((r) => r.path === abs)) return abs;
  if (abs.split(path.sep).join('/').includes(`/${RUNS_REL}/`) && fs.existsSync(path.join(abs, 'logs'))) return abs;
  if (EXTRA_ROOTS.some((r) => abs.startsWith(path.resolve(r) + path.sep)) && fs.existsSync(path.join(abs, 'logs'))) return abs;
  return null;
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url ?? '/', `http://${HOST}`);
  if (u.pathname === '/' || u.pathname === '/index.html') {
    const b = readBody(path.join(here, 'index.html'));
    res.writeHead(b ? 200 : 500, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(b ?? 'index.html missing');
    return;
  }
  if (u.pathname === '/events') {
    const pinned = u.searchParams.get('run');
    const runDir = pinned ? allowedRun(pinned) : null;
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    res.write('retry: 2000\n\n');
    const c = { res, run: runDir };
    clients.add(c);
    send(c, 'hello', { repo: REPO, self: SELF, branch: BRANCH, pid: process.pid, pinned: pinned ? runDir ?? `refused: ${pinned}` : null, startedAt: STARTED });
    send(c, 'events-backlog', events.slice(-300));
    send(c, 'runs', runsPayload());
    sendBenchSnapshot(c);
    send(c, 'worktrees', { at: Date.now(), self: SELF, items: worktrees.map(publicWt) });
    send(c, 'commits', { branch: BRANCH, items: commitFeed });
    req.on('close', () => clients.delete(c));
    return;
  }
  if (u.pathname === '/api/row') {
    const dir = u.searchParams.get('run') ? allowedRun(u.searchParams.get('run')) : autoRun;
    const t = dir ? tailers.get(dir) : null;
    const d = t?.detail(u.searchParams.get('id') ?? '');
    res.writeHead(d ? 200 : 404, { 'content-type': 'application/json' });
    res.end(JSON.stringify(d ?? { error: 'no such row' }));
    return;
  }
  if (u.pathname === '/api/prompt') {
    const dir = u.searchParams.get('run') ? allowedRun(u.searchParams.get('run')) : autoRun;
    // Claude builders: <run>/logs/prompt.md. Qwen: the system prompt is the arm's BUILDER-PROMPT with SPEC (static).
    let text = dir ? readBody(path.join(dir, 'logs', 'prompt.md')) : null;
    let source = 'logs/prompt.md';
    if (!text && dir) {
      const bench = path.resolve(dir, '../..');
      const arm = tailers.get(dir)?.state.turns.find((x) => x?.kind === 'start')?.arm;
      const p = path.join(bench, arm === 'plain' ? 'BUILDER-PROMPT-PLAIN.md' : 'BUILDER-PROMPT.md');
      text = readBody(p); source = path.relative(REPO, p) + (arm === 'plain' ? ' (+ SPEC.md in place of {{SPEC}}; static per arm)' : ' (+ the SPEC.md overview and feature index in place of {{SPEC}}; each feature\'s points arrive in plan status, #889)');
    }
    res.writeHead(text ? 200 : 404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ source, text: text ? String(text) : null }));
    return;
  }
  if (u.pathname.startsWith('/turn-io/')) { import('./turn-io.mjs').then((m) => m.handleTurnIoRoute(u, res, (r) => (r ? allowedRun(r) : autoRun))).catch((e) => { res.writeHead(500); res.end(String(e)); }); return; } // #913 full input / raw output
  if (u.pathname.startsWith('/ctx/')) { handleContextRoute(u, res, (r) => (r ? allowedRun(r) : autoRun)); return; } // #899 Context / jev
  if (u.pathname === '/api/plan-jev') { res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(readPlanJev(SELF))); return; }
  if (u.pathname === '/api/health') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, clients: clients.size, autoRun, tailers: tailers.size })); return; }
  res.writeHead(404); res.end('not found');
});

const STARTED = new Date().toISOString();
const timers = [];
async function start() {
  if (!lockPath) {
    const r = await run('bash', [path.join(REPO, 'packages/tools/dev/heavy.sh'), '--lock-path'], { timeout: 3000 });
    if (!r.ok) { const s = await run('bash', [path.join(SELF, 'packages/tools/dev/heavy.sh'), '--lock-path'], { timeout: 3000 }); lockPath = s.ok ? s.out.trim() : '/tmp/construct-heavy.lock'; } else lockPath = r.out.trim();
  }
  server.listen(PORT, HOST, () => {
    console.log(`Mission Control: http://${HOST}:${PORT}  (repo ${REPO}, branch ${BRANCH})`);
    logEvent('mc', 'info', `mission control up on http://${HOST}:${PORT}`);
  });
  timers.push(every(5000, discoverTick));
  timers.push(every(1000, async () => benchTick()));
  timers.push(every(1000, async () => broadcast('tick', { at: Date.now(), clients: clients.size })));
  timers.push(every(2000, machineTick));
  timers.push(every(5000, commitsTick));
  timers.push(every(5000, worktreeListTick));
}
function stop() {
  for (const t of timers) clearInterval(t);
  for (const t of tailers.values()) t.close();
  for (const c of clients) { try { c.res.end(); } catch { /* gone */ } }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
server.on('error', (e) => { console.error(`Mission Control: ${e.message}`); process.exit(1); });
await (await import('./beam-eval.mjs')).attachBeamEval(server, { every, timers, self: SELF }); // #902 Beam eval panel (beam-eval.mjs)
start();
