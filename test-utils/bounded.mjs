/**
 * Bounded waits and the port table for Construct's network tests (#652).
 *
 * Why this exists: `ui/server/src/githubRepoApi.test.mjs` once hung for ~29 minutes in a full-suite run. The cause was
 * not a slow mock: a fixed port (49122) was already taken (another run of the same file, or a client socket the kernel had
 * handed the same number, since 32768-60999 is the ephemeral range and every 49xxx port below is inside it). `app.listen`
 * without an 'error' listener raised EADDRINUSE as an uncaught exception, node:test failed the test, but the test's own
 * `await` never returned and the mock GitHub it had already started kept the process alive: no timeout anywhere, forever.
 *
 * So, for a test that opens sockets:
 *   - listen on port 0 (`listenOn`) unless a fixed port is truly needed; the kernel then never hands out a taken one;
 *   - wait through `bounded(promise, ms, 'what is being waited for')` or `fetchBounded(...)`, so a hang fails in seconds
 *     with a message that names the wait;
 *   - `watchdog()` in an `after()` hook: if anything (a leaked server) still keeps the process alive, exit non-zero.
 *
 * PORT TABLE (fixed ports the test suites bind or hand out; keep ranges disjoint, add yours here). Every range is inside
 * the kernel's ephemeral range 32768-60999, so a fixed port can still collide with an outgoing socket; prefer port 0.
 *
 *   47300-47399  ui/server/src/devServer.test.mjs              fixture dev servers (portBase 47300; probes 47500, 47600, 47700)
 *   47800-47899  ui/server/src/devServerChanges.test.mjs       fixture dev server (portBase 47800)
 *   47900-47999  ui/server/src/devServerPerUser.test.mjs       fixture dev servers (portBase 47900)
 *   48100-48199  ui/server/src/logBufferPerUser.test.mjs       fake spawn banner (portBase 48100, nothing listens)
 *   49100        ui/server/src/repoConnection.test.mjs         a URL in a config string only, nothing listens
 *   49110-49139  (was ui/server/src/githubRepoApi.test.mjs)    now port 0 on both the Cockpit and the mock; range retired
 *   49200-49299  ui/e2e/playwright.github-repo.config.js       mock GitHub 49210, client 49211, server 49212
 *   49210        ui/server/src/coreExecutor.test.mjs           a value in an env fixture only, nothing listens
 *   49400-49449  ui/server/src/requirementApi.test.mjs         49400 the route alone, 49401 the real route table
 *   49450-49489  ui/e2e/tests/requirement-chain.spec.js (49450-49469), requirement-shape.spec.js (49470-49489)
 *   49500-49509  ui/server/src/requirementTraces.test.mjs
 *   49520-49524  ui/server/src/requirementProof.cases.mjs      (49520, 49521, 49522)
 *   49525-49539  ui/e2e/tests/requirement-proof.spec.js        (client 49525, server 49526, dev servers from 49530)
 *   49580-49589  ui/server/src/requirementSuggestions.test.mjs
 *   49600-49649  packages/tools/paperclip/mock-paperclip.mjs   PORT_FIRST-PORT_LAST
 *   49650-49699  free: ui/server tests that need a fixed port take theirs here (#650 seam tests use none)
 */
import fs from 'node:fs';

/** Reject with `what timed out after Nms` when `promise` has not settled in `ms`. The timer never outlives the wait. */
export function bounded(promise, ms, what) {
  let timer;
  const limit = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms waiting for: ${what}`)), ms);
  });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

/** `fetch` that gives up after `ms` (default 10 s) with an error naming the request; the body read is inside the bound. */
export async function fetchBounded(url, init = {}, { ms = 10_000, what = `${init.method || 'GET'} ${url}` } = {}) {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(ms) });
    return res;
  } catch (e) {
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') throw new Error(`timed out after ${ms} ms waiting for: ${what}`);
    throw e;
  }
}

/** Read a response body as text inside the same kind of bound (a mock that answers the headers and never the body). */
export const textBounded = (res, what, ms = 10_000) => bounded(res.text(), ms, `${what} response body`);

/**
 * `server.listen(port, host)` as a promise that rejects on EADDRINUSE and the like (instead of an uncaught exception
 * that leaves the caller waiting forever) and gives up after `ms`. Port 0 (the default) asks the kernel for a free one.
 * Resolves with the bound port.
 */
export function listenOn(server, { port = 0, host = '127.0.0.1', ms = 5000, what = 'a test server to listen' } = {}) {
  const ready = new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve(server.address().port);
    });
  });
  return bounded(ready, ms, `${what} on ${host}:${port}`);
}

/** Close a server, dropping its keep-alive connections, without waiting on a peer that never hangs up (bounded). */
export function closeServer(server, { ms = 5000, what = 'a test server to close' } = {}) {
  return bounded(new Promise((resolve) => { server.close(() => resolve()); server.closeAllConnections?.(); }), ms, what);
}

/**
 * Call from an `after()` hook. If the process is still alive `ms` after the last test (a leaked server or timer), say so
 * and exit non-zero, so a file that cannot end fails in seconds rather than hanging a whole run. The timer is unref'd:
 * a clean process exits at once and never waits for it.
 */
export function watchdog(ms = 10_000, who = 'this test file') {
  setTimeout(() => {
    fs.writeSync(2, `\n${who}: still running ${ms} ms after its last test (a server or timer was left open). Failing instead of hanging.\n`);
    process.exit(1);
  }, ms).unref();
}
