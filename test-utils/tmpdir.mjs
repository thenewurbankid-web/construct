/**
 * Shared temporary-directory helper for Construct's tests.
 *
 * Why this exists (#254): tests used to call
 * `fs.mkdtempSync(path.join(os.tmpdir(), 'construct-foo-'))` directly and then
 * either forget to remove the directory or only remove it on the happy path.
 * On a tmpfs /tmp that is leaked RAM — 58k directories / 1.1 GB at its worst,
 * which contributed to OOM kills on the dev box.
 *
 * The fix is structural rather than per-call-site. Every temp directory a test
 * asks for is created *inside a single per-process root*, and that root is
 * removed when the process exits — normally, on an uncaught throw, or on
 * SIGINT/SIGTERM. Nothing has to be remembered in an `after()` hook, so an
 * assertion failure or an early `return` in the middle of a test cannot leak,
 * and a Ctrl-C'd run cleans up after itself too.
 *
 * `node --test` forks one child process per test file, so each file gets its
 * own root and tears it down as it exits.
 *
 * Usage — a drop-in replacement for the old one-liner:
 *
 *   import { makeTempDir } from '../test-utils/tmpdir.mjs';
 *   const dir = makeTempDir('construct-config-');
 *
 * It lives in `test-utils/` rather than `test/` on purpose: `node --test`
 * treats *every* `.mjs` file under a directory named `test` as a test file, so
 * a helper kept there would be loaded and counted as an (empty) test.
 *
 * `makeTempDir` returns an absolute, symlink-resolved path (macOS /tmp is a
 * symlink to /private/tmp, and several tests compare paths), so call sites that
 * previously wrapped the call in `fs.realpathSync(...)` no longer need to.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let root = null;
let installed = false;

function removeRoot() {
  if (!root) return;
  const dir = root;
  root = null;
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // Best effort: never let cleanup turn a passing run into a failing one.
  }
}

function installCleanup() {
  if (installed) return;
  installed = true;

  // Normal exit, `process.exit()`, and an unhandled throw that ends the process
  // all run 'exit' handlers. It must stay synchronous — async work is ignored
  // during 'exit'.
  process.on('exit', removeRoot);

  // Signals do not run 'exit' handlers on their own: Node's default handler
  // terminates the process. Clean up first, then re-raise with the default
  // disposition so the exit status still looks like a signal death.
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => {
      removeRoot();
      process.removeAllListeners(signal);
      process.kill(process.pid, signal);
    });
  }
}

const ROOT_PREFIX = 'construct-tests-';

/**
 * Best-effort sweep of roots left behind by processes that are no longer alive.
 *
 * `process.on('exit')` covers every ending Node can observe, but not SIGKILL and
 * not an OOM kill - and an OOM kill is exactly how this box loses test runs (see
 * #254). Those leave a `construct-tests-<pid>-XXXXXX` root behind forever. Since
 * the pid is in the name, a later run can tell whether the owner is still around
 * and reclaim the directory if it is not.
 *
 * Deliberately conservative: if the pid is still alive, or we cannot tell, the
 * directory is left alone. The worst case is that a stale root survives one more
 * run, never that a live run's directory is deleted underneath it.
 */
function sweepDeadRoots(tmp) {
  let entries;
  try {
    entries = fs.readdirSync(tmp, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(ROOT_PREFIX)) continue;
    // construct-tests-<pid>-XXXXXX
    const pid = Number.parseInt(entry.name.slice(ROOT_PREFIX.length).split('-')[0], 10);
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) continue;
    try {
      // Signal 0 performs the existence/permission check without delivering it.
      process.kill(pid, 0);
      continue; // still running - not ours to remove
    } catch (err) {
      // EPERM means the pid exists but belongs to another user: leave it.
      if (err.code !== 'ESRCH') continue;
    }
    try {
      fs.rmSync(path.join(tmp, entry.name), { recursive: true, force: true });
    } catch {
      // Someone else may have won the race, or it is not ours to delete.
    }
  }
}

/**
 * The per-process root every temp directory lives under. Created lazily so a
 * test file that never asks for a temp directory never makes one.
 * @returns {string} absolute, symlink-resolved path
 */
export function tempRoot() {
  if (!root) {
    const tmp = fs.realpathSync(os.tmpdir());
    sweepDeadRoots(tmp);
    root = fs.realpathSync(fs.mkdtempSync(path.join(tmp, `${ROOT_PREFIX}${process.pid}-`)));
    installCleanup();
  }
  return root;
}

/**
 * Create a temp directory that is guaranteed to be cleaned up when this process
 * exits, however it exits.
 *
 * @param {string} [prefix] a readable prefix, kept only so directories are
 *   identifiable while a run is in flight; it does not affect cleanup.
 * @returns {string} absolute, symlink-resolved path to a fresh empty directory
 */
export function makeTempDir(prefix = 'project-') {
  // Only the basename matters — a caller passing 'construct-config-' should not
  // be able to escape the root, and a path separator would do exactly that.
  const safe = path.basename(String(prefix)) || 'project-';
  return fs.realpathSync(fs.mkdtempSync(path.join(tempRoot(), safe)));
}

/**
 * Run `fn` with a fresh temp directory and remove it immediately afterwards,
 * pass or fail. Use this when a single test creates many directories and you
 * would rather not hold them all until the process exits; plain `makeTempDir`
 * is fine everywhere else.
 *
 * @template T
 * @param {string} prefix
 * @param {(dir: string) => T} fn
 * @returns {T}
 */
export function withTempDir(prefix, fn) {
  const dir = makeTempDir(prefix);
  try {
    return fn(dir);
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // The process-exit sweep will get it.
    }
  }
}

/**
 * Remove the per-process root now. Tests for the helper itself use this; normal
 * test files should not need to call it.
 */
export function cleanupTempRoot() {
  removeRoot();
}
