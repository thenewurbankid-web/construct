// #950 -- the Line LSP's background indexer: a SEPARATE child process that fills the persistent index (lsp/store) for
// the files outside the scope, outward from it, so a later widening or a cold start finds them stored. It never blocks
// the foreground: it runs at nice 19 under its own heap cap, writes only store entries (one file each, atomic), and
// steps aside while another heavy job holds heavy.sh's lock or free RAM is below heavy.sh's threshold.
//
//   const bg = startBackgroundIndexer({ root, scope: [...rels], pin, smith: true, onIndexed(files) {...} })
//   bg.status   -> { state: 'starting'|'running'|'paused'|'done'|'stopped'|'failed', done, total, pausedFor, nice }
//   bg.stop()   -> the child is killed; also when the parent goes away (IPC disconnect)
//
// Child protocol (IPC): the parent sends one config message; the child answers
//   { type: 'started', total, nice }   { type: 'indexed', files: [{rel, hash, hit}], done, total }
//   { type: 'paused', why: 'lock'|'ram' }   { type: 'resumed' }   { type: 'done', done, total, pruned }   { type: 'cap', rssMb }
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const TICK_FILES = 50;
export const TICK_PAUSE_MS = 100;
export const CAP_MB = 1536;
export const DEFAULT_LOCK = '/tmp/construct-heavy.lock';
const SELF = fileURLToPath(import.meta.url);
const sleep = (t) => new Promise((r) => setTimeout(r, t));

/**
 * Free RAM in MB the way heavy.sh measures it: MemAvailable (Linux), else (free + inactive + speculative) pages from
 * vm_stat (macOS), else os.freemem().
 * @returns {number}
 */
export function freeMb() {
  try {
    const m = /^MemAvailable:\s+(\d+)/m.exec(fs.readFileSync('/proc/meminfo', 'utf8'));
    if (m) return Math.round(Number(m[1]) / 1024);
  } catch { /* not Linux */ }
  try {
    const out = execFileSync('vm_stat', { encoding: 'utf8', timeout: 2000 });
    const page = Number(/page size of (\d+)/.exec(out)?.[1] ?? 4096);
    const pages = (k) => Number(new RegExp(`Pages ${k}:\\s+(\\d+)`).exec(out)?.[1] ?? 0);
    return Math.round(((pages('free') + pages('inactive') + pages('speculative')) * page) / 1048576);
  } catch { return Math.round(os.freemem() / 1048576); }
}

/**
 * Whether ANOTHER heavy.sh job holds the lock (mkdir lock: <lock>.d/pid; flock: <lock>.holder "pid N ..."), with a
 * live holder. The job this process runs inside (CONSTRUCT_HEAVY_HELD="<pid>:<lock>") does not count.
 * @param {string} [lock]
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
export function lockHeldByOther(lock = DEFAULT_LOCK, env = process.env) {
  const own = Number(String(env.CONSTRUCT_HEAVY_HELD ?? '').split(':')[0]) || -1;
  let pid = null;
  try { pid = Number(fs.readFileSync(`${lock}.d/pid`, 'utf8').replace(/\D/g, '')) || null; } catch { /* none */ }
  if (!pid) { try { pid = Number(/^pid (\d+)/.exec(fs.readFileSync(`${lock}.holder`, 'utf8'))?.[1]) || null; } catch { /* none */ } }
  if (!pid || pid === own) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return /** @type {any} */ (e)?.code === 'EPERM'; }
}

/** The `nice` binary when there is one: it raises the child's niceness relative to the parent, so it never fails the
 * way os.setPriority(19) does in an already-niced parent (macOS refuses that no-op renice). */
let niceBin;
const niceBinary = () => {
  if (niceBin !== undefined) return niceBin;
  niceBin = ['/usr/bin/nice', '/bin/nice'].find((p) => fs.existsSync(p)) ?? null;
  return niceBin;
};

/**
 * Start the background indexer child for one project.
 * @param {{root: string, scope: string[], pin: {smith: string, rules: string}, storeDir?: string, smith?: boolean,
 *   smithModule?: string|null, exact?: boolean, rules?: boolean, tick?: number, pauseMs?: number, capMb?: number,
 *   minFreeMb?: number, lock?: string, pruneDays?: number, onIndexed?: (files: {rel: string, hash: string, hit: boolean}[]) => void,
 *   onMessage?: (m: any) => void, env?: NodeJS.ProcessEnv}} o
 * @returns {{child: import('node:child_process').ChildProcess, status: any, stop: () => void, done: Promise<any>}}
 */
export function startBackgroundIndexer(o) {
  const capMb = o.capMb ?? CAP_MB;
  const env = { ...(o.env ?? process.env) };
  const nodeArgs = [`--max-old-space-size=${capMb}`, SELF, '--child'];
  const nice = niceBinary();
  const child = nice
    ? spawn(nice, ['-n', '19', process.execPath, ...nodeArgs], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'], env })
    : spawn(process.execPath, nodeArgs, { stdio: ['ignore', 'ignore', 'inherit', 'ipc'], env });
  if (!nice) { try { os.setPriority(/** @type {number} */ (child.pid), 19); } catch { /* best effort */ } }
  const status = { state: 'starting', done: 0, total: null, pausedFor: { lock: 0, ram: 0 }, nice: null, pid: child.pid, pruned: null, rssMb: null };
  let resolveDone;
  const done = new Promise((r) => { resolveDone = r; });
  child.on('message', (m) => {
    const msg = /** @type {any} */ (m);
    if (msg.type === 'started') { status.state = 'running'; status.total = msg.total; status.nice = msg.nice; }
    else if (msg.type === 'indexed') { status.done = msg.done; status.total = msg.total; o.onIndexed?.(msg.files); }
    else if (msg.type === 'paused') { status.state = 'paused'; status.pausedFor[msg.why] = (status.pausedFor[msg.why] ?? 0) + 1; }
    else if (msg.type === 'resumed') status.state = 'running';
    else if (msg.type === 'done') { status.state = 'done'; status.pruned = msg.pruned; status.rssMb = msg.rssMb; }
    else if (msg.type === 'cap') { status.state = 'stopped'; status.rssMb = msg.rssMb; }
    o.onMessage?.(msg);
  });
  child.on('exit', (code) => { if (status.state !== 'done' && status.state !== 'stopped') status.state = code === 0 ? 'stopped' : 'failed'; resolveDone(status); });
  child.on('error', () => { status.state = 'failed'; resolveDone(status); });
  const config = {
    root: path.resolve(o.root), scope: o.scope, pin: o.pin, storeDir: o.storeDir ?? null, smith: o.smith ?? true, smithModule: o.smithModule ?? null,
    exact: o.exact ?? true, rules: o.rules ?? true, tick: o.tick ?? TICK_FILES, pauseMs: o.pauseMs ?? TICK_PAUSE_MS, capMb,
    minFreeMb: o.minFreeMb ?? Number(env.CONSTRUCT_MIN_FREE_MB ?? 3000), lock: o.lock ?? env.CONSTRUCT_HEAVY_LOCK ?? DEFAULT_LOCK, pruneDays: o.pruneDays ?? null,
  };
  child.send(config);
  child.unref();
  /** @type {any} */ (child).channel?.unref?.();
  return { child, status, done, stop: () => { if (child.exitCode === null && !child.killed) { try { child.kill('SIGTERM'); } catch { /* gone */ } status.state = 'stopped'; } } };
}

// ------------------------------------------------------------------------------------------------ the child
async function runChild(config) {
  const send = (m) => { try { process.send?.(m); } catch { /* parent gone */ } };
  // the last message is flushed before exiting (an exit right after send() can drop it)
  const last = (m) => new Promise((r) => { try { process.send?.(m, () => r(null)) ?? r(null); } catch { r(null); } setTimeout(r, 2000).unref(); });
  const { sourceFiles, readOptions, hashOf } = await import('./host.mjs');
  const { openStore } = await import('./store/index.mjs');
  const { computeRecord, defaultSmith, isCode } = await import('./record.mjs');
  const { directImportsOf, refsOf } = await import('./outline.mjs');
  const { outwardOrder } = await import('./scope.mjs');
  const root = config.root;
  const store = openStore(root, { pin: config.pin, dir: config.storeDir ?? undefined });
  const smith = !config.smith ? null : config.smithModule ? (await import(config.smithModule)).smithIndexFile : await defaultSmith();
  const tsOptions = readOptions(root).options ?? null;
  const posix = (p) => p.split(path.sep).join('/');
  const all = sourceFiles(root, { includeDts: false }).map((a) => posix(path.relative(root, a)));
  const texts = new Map();
  const textOf = (rel) => { if (!texts.has(rel)) { let t = null; try { t = fs.readFileSync(path.join(root, rel), 'utf8'); } catch { t = null; } texts.set(rel, t); } return texts.get(rel); };
  const refsCache = new Map();
  const importsOf = (rel) => {
    if (refsCache.has(rel)) return refsCache.get(rel);
    const t = textOf(rel);
    let out = [];
    if (t !== null) { const rec = store.get(rel, hashOf(t)); out = directImportsOf(rec?.refs ?? refsOf(root, rel, t, tsOptions)); }
    refsCache.set(rel, out);
    texts.delete(rel); // keep memory flat: a file's text is read again when its turn comes
    return out;
  };
  const scope = { files: new Set(config.scope ?? []) };
  const order = outwardOrder(scope, all, importsOf);
  send({ type: 'started', total: order.length, nice: (() => { try { return os.getPriority(); } catch { return null; } })() });
  const live = new Map();
  let done = 0;
  for (let i = 0; i < order.length; i += config.tick) {
    let pausedWhy = null;
    for (;;) {
      const why = lockHeldByOther(config.lock) ? 'lock' : config.minFreeMb > 0 && freeMb() < config.minFreeMb ? 'ram' : null;
      if (!why) break;
      if (why !== pausedWhy) { send({ type: 'paused', why }); pausedWhy = why; }
      await sleep(1000);
    }
    if (pausedWhy) send({ type: 'resumed' });
    const rssMb = Math.round(process.memoryUsage().rss / 1048576);
    if (rssMb > config.capMb) { await last({ type: 'cap', rssMb }); process.exit(0); }
    const files = [];
    for (const rel of order.slice(i, i + config.tick)) {
      const text = textOf(rel);
      texts.delete(rel);
      if (text === null) continue;
      const hash = hashOf(text);
      live.set(rel, hash);
      if (store.has(rel, hash) && store.get(rel, hash)) { files.push({ rel, hash, hit: true }); continue; }
      const rec = await computeRecord(root, rel, text, { smith: isCode(rel) ? smith : null, exact: config.exact, rules: config.rules && isCode(rel), tsOptions });
      store.put(rel, hash, rec);
      files.push({ rel, hash, hit: false });
    }
    done += files.length;
    send({ type: 'indexed', files, done, total: order.length });
    await sleep(config.pauseMs);
  }
  // the scope's own files are live too: prune only what matches no file of the project
  for (const rel of config.scope ?? []) { const t = textOf(rel); texts.delete(rel); if (t !== null) live.set(rel, hashOf(t)); }
  const pruned = store.prune({ live, ...(config.pruneDays != null ? { days: config.pruneDays } : {}) });
  await last({ type: 'done', done, total: order.length, pruned, rssMb: Math.round(process.resourceUsage().maxRSS / 1024) });
  process.exit(0);
}

if (process.argv[1] === SELF && process.argv.includes('--child')) {
  process.on('disconnect', () => process.exit(0)); // the parent went away: stop, never orphaned
  process.once('message', (config) => { runChild(config).catch((e) => { process.stderr.write(`line-lsp indexer: ${String(e?.message ?? e).split('\n')[0]}\n`); process.exit(1); }); });
}
