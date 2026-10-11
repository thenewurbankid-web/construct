// One cross-process lock per file, the one shared helper for every read-modify-write two Line processes can race on
// (the MCP server and the Cockpit server both write `line/plans/ses-cockpit.json`). Built on proper-lockfile (MIT): the
// lock is a `<file>.lock` directory made with an atomic mkdir, kept fresh while held (its mtime is touched), and taken
// over when its mtime is older than `staleMs`, so a holder that died never blocks anyone for long. Inside one process the
// callers of one file queue up first (no polling against ourselves), and a nested call for a file the current async
// context already holds runs straight through, so a locked step that calls back into the plan cannot deadlock.
//
//   withFileLock(file, fn, opts?)      async: take the lock, run fn, release in finally
//   withFileLockSync(file, fn, opts?)  the same for synchronous callers (append-only JSONL)
//
// When the lock cannot be taken within `timeoutMs`, both throw a FileLockError: code LOCK_TIMEOUT, one plain sentence.
import fs from 'node:fs';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import lockfile from 'proper-lockfile';

/** The sentence a caller sees when another process holds the lock for too long. */
export const LOCK_BUSY_SENTENCE = 'Another Line process is changing the plan; try again.';
/** The typed code of that refusal. */
export const LOCK_TIMEOUT = 'LOCK_TIMEOUT';

const DEFAULTS = { timeoutMs: 10_000, staleMs: 10_000, pollMs: 25 };

/** A lock that could not be taken in time: `code` is LOCK_TIMEOUT, `sentence` one plain-English sentence. */
export class FileLockError extends Error {
  /**
   * @param {string} sentence The plain-English sentence a person sees.
   * @param {string} file The file whose lock was busy.
   */
  constructor(sentence, file) {
    super(sentence);
    this.name = 'FileLockError';
    this.code = LOCK_TIMEOUT;
    this.sentence = sentence;
    this.file = file;
  }
}

const held = new AsyncLocalStorage();
/** @type {Map<string, Promise<unknown>>} */
const queues = new Map();
/** @type {Set<string>} files a synchronous caller in this process holds right now */
const heldSync = new Set();

const keyOf = (file) => path.resolve(String(file));
const optionsOf = (o) => ({ ...DEFAULTS, ...(o ?? {}) });
const lockOptions = (o) => ({ realpath: false, stale: Math.max(2000, o.staleMs), retries: 0, onCompromised: () => { /* a taken-over lock: the next writer's version check still refuses stale work */ } });
const sleepSync = (ms) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };
const busy = (o, file) => new FileLockError(o.sentence ?? LOCK_BUSY_SENTENCE, file);

/**
 * Run `fn` while holding the cross-process lock of `file` (the file itself need not exist; its folder is created).
 * @template T
 * @param {string} file The file whose read-modify-write is guarded.
 * @param {() => Promise<T> | T} fn The work done under the lock.
 * @param {{timeoutMs?: number, staleMs?: number, pollMs?: number, sentence?: string}} [opts] `timeoutMs` how long to wait
 *   for the lock (default 10 s); `staleMs` how old a lock's mtime must be before it is taken over (default 10 s, at least
 *   2 s); `sentence` the refusal's words (default LOCK_BUSY_SENTENCE).
 * @returns {Promise<T>} What `fn` returned.
 * @throws {FileLockError} When the lock is not free within `timeoutMs`.
 */
export async function withFileLock(file, fn, opts) {
  const key = keyOf(file);
  const mine = held.getStore();
  if (mine?.has(key) || heldSync.has(key)) return fn();
  const o = optionsOf(opts);
  const prev = queues.get(key) ?? Promise.resolve();
  const run = prev.then(() => locked(key, fn, o, mine));
  const tail = run.catch(() => {});
  queues.set(key, tail);
  try { return await run; } finally { if (queues.get(key) === tail) queues.delete(key); }
}

async function locked(key, fn, o, mine) {
  fs.mkdirSync(path.dirname(key), { recursive: true });
  const deadline = Date.now() + o.timeoutMs;
  let release;
  for (;;) {
    try { release = await lockfile.lock(key, lockOptions(o)); break; } catch (e) {
      if (/** @type {any} */ (e).code !== 'ELOCKED') throw e;
      if (Date.now() >= deadline) throw busy(o, key);
      await new Promise((r) => { setTimeout(r, o.pollMs); });
    }
  }
  try {
    return await held.run(new Set([...(mine ?? []), key]), fn);
  } finally {
    await release().catch(() => { /* already released or taken over as stale */ });
  }
}

/**
 * The synchronous twin of withFileLock, for short synchronous writes (an O_APPEND line).
 * @template T
 * @param {string} file The file whose write is guarded.
 * @param {() => T} fn The work done under the lock.
 * @param {{timeoutMs?: number, staleMs?: number, pollMs?: number, sentence?: string}} [opts] As withFileLock.
 * @returns {T} What `fn` returned.
 * @throws {FileLockError} When the lock is not free within `timeoutMs`.
 */
export function withFileLockSync(file, fn, opts) {
  const key = keyOf(file);
  if (heldSync.has(key) || held.getStore()?.has(key)) return fn();
  const o = optionsOf(opts);
  fs.mkdirSync(path.dirname(key), { recursive: true });
  const deadline = Date.now() + o.timeoutMs;
  let release;
  for (;;) {
    try { release = lockfile.lockSync(key, lockOptions(o)); break; } catch (e) {
      if (/** @type {any} */ (e).code !== 'ELOCKED') throw e;
      if (Date.now() >= deadline) throw busy(o, key);
      sleepSync(o.pollMs);
    }
  }
  heldSync.add(key);
  try {
    return fn();
  } finally {
    heldSync.delete(key);
    try { release(); } catch { /* already released or taken over as stale */ }
  }
}
