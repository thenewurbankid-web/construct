// The contract-upload lock of a local deploy.
//
// The race it closes: a redeploy or a rollback copies the running build's user-changed contracts into the build it switches
// to, then stops the running server. An upload that reaches the running server BETWEEN that copy and the stop would be
// written into the build that is about to be discarded, and lost.
//
// Two layers, on purpose (documented in docs/DEPLOY-LOCAL.md):
//   1. this LOCK (primary): while a deploy or rollback runs its switch-over, `deploy/contracts.lock` exists, and the running
//      server answers every contract write (POST /api/openapi, POST /api/demo/apply-fix) with 503 and `Retry-After`, so
//      the person sees "try again in a moment" instead of a silent loss;
//   2. a RE-CARRY after the old server is stopped (backstop, in src/deploy/deploy.mjs): a write that was already in flight
//      when the lock appeared is still on disk when the server stops, and the second copy picks it up.
// The lock never outlives its holder: it names the pid and the time, and a lock whose process is gone, or that is older than
// MAX_AGE_MS, is ignored (a crashed deploy cannot block uploads forever).
import fs from "node:fs";
import path from "node:path";

export const LOCK_NAME = "contracts.lock";
export const MAX_AGE_MS = 10 * 60 * 1000;
export const RETRY_AFTER_SEC = 15;
// the requests that write an example's contract into the running build's folder (all of them sit behind http-guard first)
export const CONTRACT_WRITES = [["POST", "/api/openapi"], ["POST", "/api/demo/apply-fix"]];

const pidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };

// The deploy folder a server running from `<deploy>/<version>` belongs to; null for a dev checkout (nothing to lock against).
/**
 * The deploy folder a running server belongs to.
 *
 * @param {string} root The server's root directory (e.g. `deploy/<version>`).
 * @returns {string|null} The deploy folder, or `null` for a dev checkout (nothing to lock against).
 */
export const deployDirOf = (root) => (path.basename(path.dirname(root)) === "deploy" ? path.dirname(root) : null);

// { pid, at } when a live lock is held, else null. A missing, unreadable, dead-holder or expired lock is no lock.
/**
 * Read the contracts lock, if one is currently live.
 *
 * @param {string|null} deployDir From {@link deployDirOf}.
 * @param {{now?: () => number, alive?: (pid: number) => boolean, maxAgeMs?: number}} [options]
 *   Overrides for testing; default to real time, a real liveness check, and {@link MAX_AGE_MS}.
 * @returns {{pid: number, at: number}|null} The lock, or `null` when there is none, it is unreadable, its holder
 *   is gone, or it has expired (or the clock jumped) — a crashed deploy cannot block uploads forever.
 */
export function readContractsLock(deployDir, { now = Date.now, alive = pidAlive, maxAgeMs = MAX_AGE_MS } = {}) {
  if (!deployDir) return null;
  const l = readJson(path.join(deployDir, LOCK_NAME));
  if (!l || !Number.isInteger(l.pid) || typeof l.at !== "number") return null;
  if (now() - l.at > maxAgeMs || l.at - now() > maxAgeMs) return null; // expired (or a clock that jumped)
  return alive(l.pid) ? { pid: l.pid, at: l.at } : null;
}

// Takes the lock and returns release(): safe to call twice, and it only removes the lock if it is still this holder's.
// Throws when a live lock of another holder exists.
/**
 * Take the contracts lock for a deploy/rollback switch-over.
 *
 * @param {string} deployDir The deploy folder to lock.
 * @param {{pid?: number, now?: () => number, alive?: (pid: number) => boolean, maxAgeMs?: number}} [options]
 *   `pid` defaults to this process; the rest default like {@link readContractsLock}.
 * @returns {() => void} `release()`: safe to call twice, and only removes the lock file if it is still this
 *   holder's.
 * @throws {Error} When a live lock held by another pid already exists.
 */
export function lockContracts(deployDir, { pid = process.pid, now = Date.now, alive = pidAlive, maxAgeMs = MAX_AGE_MS } = {}) {
  const file = path.join(deployDir, LOCK_NAME);
  fs.mkdirSync(deployDir, { recursive: true });
  const body = JSON.stringify({ pid, at: now() });
  try {
    fs.writeFileSync(file, body, { flag: "wx" });
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
    const held = readContractsLock(deployDir, { now, alive, maxAgeMs });
    if (held && held.pid !== pid) throw new Error(`the contract lock is held by pid ${held.pid}`);
    fs.writeFileSync(file, body); // stale, or ours from an earlier step
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (readJson(file)?.pid === pid) fs.rmSync(file, { force: true });
  };
}

// Answers a contract write with 503 while the lock is held. Returns true when it answered (the caller stops routing).
// Runs AFTER http-guard's checkRequest (Host, Origin, content-type), never instead of it.
/**
 * Answer a contract-writing request with 503 while the contracts lock is held, instead of letting it write into a
 * build that is about to be discarded. Must run after `http-guard.mjs`'s `checkRequest`, never instead of it.
 *
 * @param {string} method The request's HTTP method.
 * @param {string} pathname The request's pathname.
 * @param {import("node:http").ServerResponse} res
 * @param {string|null} deployDir From {@link deployDirOf}.
 * @param {object} [opts] Passed through to {@link readContractsLock}.
 * @returns {boolean} `true` when this answered the request (the caller stops routing); `false` when it is not a
 *   contract write, or no lock is held.
 */
export function answerIfContractsLocked(method, pathname, res, deployDir, opts) {
  if (!CONTRACT_WRITES.some(([m, p]) => m === String(method).toUpperCase() && p === pathname)) return false;
  if (!readContractsLock(deployDir, opts)) return false;
  res.writeHead(503, { "content-type": "application/json", "retry-after": String(RETRY_AFTER_SEC), "cache-control": "no-store" });
  res.end(JSON.stringify({ error: "Trace is switching to another build right now, so the file was not saved. Try again in a few seconds.", retryAfterSec: RETRY_AFTER_SEC }));
  return true;
}
