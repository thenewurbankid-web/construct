// The decisions of a local deploy, separate from the side effects: every effect (run the tests, copy files, start a
// server, probe it, move the symlink) is a function on `d` that scripts/deploy-local.mjs supplies for real and the
// tests supply as fakes. So the rules below (refuse on failing tests, never leave a broken build running, roll back on a
// failed health check, do nothing for an unchanged tree) are tested without starting a process or touching the network.
import { diffManifests } from "../build-info.mjs";

// npm test prints `ℹ tests 79` ... `ℹ pass 77` ... `ℹ todo 2` (node:test spec reporter)
/**
 * Parse `npm test`'s node:test spec-reporter summary lines.
 *
 * @param {string} output The test run's combined output.
 * @returns {{total: number, pass: number, fail: number, todo: number}|null} The final summary counts (the last
 *   occurrence of each, in case of nested/repeated runs), or `null` when any of them could not be found.
 */
export function parseTestSummary(output) {
  const n = (k) => Number([...String(output).matchAll(new RegExp(`^\\S*\\s*${k}\\s+(\\d+)\\s*$`, "gm"))].pop()?.[1] ?? NaN); // the last one: the final summary
  const t = { total: n("tests"), pass: n("pass"), fail: n("fail"), todo: n("todo") };
  return Object.values(t).some(Number.isNaN) ? null : t;
}

const failure = (status, message) => ({ status, message });

// Deploy the tree described by d.computeState() on `port`. Returns { status, message, version }:
//   unchanged | started | deployed | pinned | port-busy | tests-failed | candidate-failed | reverted | failed
// (reverted: the new build failed after the switch and the previous one is running again; rollback() reports rolled-back)
/**
 * Deploy the current tree: refuse on failing tests, health-check the candidate on a throwaway port before
 * switching, and roll back automatically if the switched-to build then fails its health check. Every side effect
 * (run tests, copy files, start/stop a server, probe it, move the "current" symlink) is a method on `d`, so this
 * is testable without a real process or network.
 *
 * @param {object} d The effects object (see `scripts/deploy-local.mjs` for the real one; tests supply fakes).
 * @param {{port: number, respectPin?: boolean}} options `port` to deploy on; `respectPin` refuses to redeploy a
 *   tree that was just rolled back from on purpose.
 * @returns {Promise<{status: "unchanged"|"started"|"deployed"|"pinned"|"port-busy"|"tests-failed"|
 *   "candidate-failed"|"reverted"|"failed"|"lock-failed"|"carry-failed", message: string, version?: string}>}
 *   The outcome. `"reverted"`: the new build failed its health check after the switch and the previous build is
 *   running again (a manual {@link rollback} reports `"rolled-back"` instead).
 */
export async function deploy(d, { port, respectPin = false }) {
  const { info, manifest } = await d.computeState();
  const state = await d.readState();
  const ps = await d.portStatus(port);
  if (ps.state === "foreign") return failure("port-busy", `Port ${port} is held by ${ps.by}. Free it or choose another with --port or TRACE_DEPLOY_PORT. Nothing was changed.`);
  if (respectPin && state.pinnedHash && state.pinnedHash === info.hash) return failure("pinned", "This tree was rolled back from on purpose. Change a file or run deploy:local to deploy it again.");

  // same content already deployed: say so and do nothing (or just start it if it is not running)
  if (state.current === info.version && (await d.hasRelease(info.version))) {
    if (ps.state === "ours" && (await d.healthy(port, info.hash))) return { status: "unchanged", message: `${info.version} is already deployed and healthy on port ${port}. Nothing to do.`, version: info.version };
    await d.stop();
    await d.start({ version: info.version, port });
    if (await d.healthy(port, info.hash)) return { status: "started", message: `${info.version} was deployed but not running; started it on port ${port}.`, version: info.version };
    await d.stop();
    return failure("failed", `${info.version} is deployed but did not become healthy on port ${port}. See the server log.`);
  }

  // (a) tests first: a failing build never replaces a working one
  const tests = await d.runTests();
  if (!tests.ok) {
    await d.writeFailure(`Deploy of ${info.version} refused: npm test failed.\n\n${tests.tail ?? ""}`);
    return failure("tests-failed", `npm test failed, so ${info.version} was not deployed. The previous build (${state.current ?? "none"}) keeps running. See deploy/LAST-FAILURE.txt.`);
  }

  // (b)-(f) run with the contract-upload lock held (see contracts-lock.mjs): uploads wait instead of landing in a build that is about to stop
  let unlock = null;
  try { unlock = (await d.lockContracts?.()) ?? null; } catch (err) { return failure("lock-failed", `Could not take the contract lock (${err.message}), so nothing was changed. The previous build (${state.current ?? "none"}) keeps running.`); }
  try { return await switchOver(d, { info, manifest, state, port, tests }); } finally { await unlock?.(); }
}

// Copy, health-check, switch, verify, prune: everything from the first change on disk to the end.
async function switchOver(d, { info, manifest, state, port, tests }) {
  // (b) copy: the build-info records the tests result and what changed against the build that is running now
  const previous = state.current ?? null;
  const prevManifest = previous ? await d.readManifest(previous) : null;
  const built = {
    ...info,
    builtAt: d.now(),
    changesSincePrevious: prevManifest ? diffManifests(prevManifest, manifest) : null,
    previousVersion: prevManifest ? previous : null,
    tests: tests.summary ?? null,
  };
  await d.buildRelease({ info: built, manifest, previous });

  // (c) the candidate must answer on a throwaway port before anything is switched
  const tmpPort = await d.pickFreePort();
  const cand = await d.start({ version: info.version, port: tmpPort, temp: true });
  const candOk = await d.healthy(tmpPort, info.hash);
  await d.stop(cand);
  if (!candOk) {
    await d.removeRelease(info.version);
    await d.writeFailure(`Deploy of ${info.version} refused: the new build did not pass its health check on a temporary port.`);
    return failure("candidate-failed", `The new build did not start cleanly, so it was discarded. The previous build (${previous ?? "none"}) keeps running. See deploy/LAST-FAILURE.txt.`);
  }

  // (d) switch and restart on the fixed port
  await d.switchCurrent(info.version);
  await d.writeState({ current: info.version, pinnedHash: null });
  await d.stop();
  // the old server is stopped, so nothing can be written any more: copy again what reached it after the first copy (the
  // upload lock stops new ones, this catches one that was already in flight when the lock appeared)
  if (previous && d.carryContracts) {
    try { await d.carryContracts(previous, info.version); }
    catch (err) {
      await d.switchCurrent(previous);
      await d.writeState({ current: previous, pinnedHash: null });
      await d.start({ version: previous, port });
      await d.removeRelease(info.version);
      await d.writeFailure(`Deploy of ${info.version} refused: the last copy of the uploaded contracts failed (${err.message}); ${previous} is running again.`);
      return failure("carry-failed", `Could not carry the uploaded contracts into ${info.version} (${err.message}), so ${previous} is running again and nothing was lost. See deploy/LAST-FAILURE.txt.`);
    }
  }
  await d.start({ version: info.version, port });

  // (e) verify; on failure go back to what worked
  if (!(await d.healthy(port, info.hash))) {
    await d.stop();
    if (!previous || !(await d.hasRelease(previous))) {
      await d.writeFailure(`Deploy of ${info.version} failed its health check on port ${port} and there was no previous build to go back to.`);
      return failure("failed", `The new build failed its health check on port ${port} and there is no previous build to roll back to. The server is stopped.`);
    }
    const prevInfo = await d.readBuildInfo(previous);
    await d.switchCurrent(previous);
    await d.writeState({ current: previous, pinnedHash: null });
    await d.start({ version: previous, port });
    const back = await d.healthy(port, prevInfo?.hash);
    await d.writeFailure(`Deploy of ${info.version} failed its health check on port ${port}; rolled back to ${previous}${back ? "" : " (which did not come up either)"}.`);
    return failure("reverted", back
      ? `The new build failed its health check, so ${previous} is running again. See deploy/LAST-FAILURE.txt.`
      : `The new build failed its health check and ${previous} did not come up either. See the server log.`);
  }

  await d.clearFailure();
  // (f) keep the last 3 builds (never the running one or the one it can roll back to)
  for (const v of await d.pruneCandidates({ current: info.version, previous })) await d.removeRelease(v);
  return { status: "deployed", message: `Deployed ${info.version} on port ${port}.`, version: info.version };
}

// Go back to the build that was running before the current one. The tree is pinned so the watcher does not redeploy it.
// A contract uploaded (or replaced) in the running app lives in that build's own folder, so a rollback would silently
// bring back the older build's contract. The safest behaviour: carry the running build's user-changed contracts into the
// build it goes back to (d.carryContracts(from, to) returns the example names) BEFORE switching, and say so in the message.
// If that copy fails nothing is switched: a rollback never drops a user's contract quietly.
// An upload that reaches the running server after that copy would be lost, so (1) d.lockContracts() makes the running server refuse
// contract writes (503 + Retry-After) from before the copy to after the restart, and (2) once the old server is stopped the copy is
// made again, which picks up a write that was already in flight when the lock appeared (see src/deploy/contracts-lock.mjs).
/**
 * Go back to the build that was running before the current one, pinning the tree so the watcher does not
 * immediately redeploy it. Any contract uploaded or replaced in the running app is carried into the build being
 * rolled back to first (see {@link deploy} for why this can't just be skipped); if that copy fails nothing is
 * switched.
 *
 * @param {object} d The effects object (see {@link deploy}).
 * @param {{port: number}} options The port to run on.
 * @returns {Promise<{status: "rolled-back"|"no-previous"|"port-busy"|"lock-failed"|"carry-failed"|
 *   "rollback-failed", message: string, version?: string}>} The outcome.
 */
export async function rollback(d, { port }) {
  const state = await d.readState();
  if (!state.current) return failure("no-previous", "Nothing is deployed yet.");
  const cur = await d.readBuildInfo(state.current);
  const target = cur?.previousVersion;
  if (!target || !(await d.hasRelease(target))) return failure("no-previous", `No earlier build is kept to roll back to (${state.current} was ${target ? `preceded by ${target}, which is no longer kept` : "the first recorded build"}).`);
  const ps = await d.portStatus(port);
  if (ps.state === "foreign") return failure("port-busy", `Port ${port} is held by ${ps.by}. Nothing was changed.`);
  const tgt = await d.readBuildInfo(target);
  const { info } = await d.computeState();
  // uploads wait (503) from here to the end, so none lands in the build that is about to stop (see contracts-lock.mjs)
  let unlock = null;
  try { unlock = (await d.lockContracts?.()) ?? null; } catch (err) { return failure("lock-failed", `Could not take the contract lock (${err.message}), so nothing was changed. ${state.current} keeps running.`); }
  try { return await rollbackLocked(d, { port, state, target, tgt, info }); } finally { await unlock?.(); }
}

async function rollbackLocked(d, { port, state, target, tgt, info }) {
  let carried = [];
  if (d.carryContracts) {
    try { carried = (await d.carryContracts(state.current, target)) ?? []; }
    catch (err) { return failure("carry-failed", `Could not carry the uploaded contracts of ${state.current} over to ${target} (${err.message}), so nothing was changed. ${state.current} keeps running.`); }
  }
  await d.switchCurrent(target);
  await d.writeState({ current: target, pinnedHash: info.hash });
  await d.stop();
  if (d.carryContracts) { // the running server is stopped: copy again what reached it after the first copy (an upload already in flight when the lock appeared)
    try { carried = [...new Set([...carried, ...((await d.carryContracts(state.current, target)) ?? [])])]; }
    catch (err) {
      await d.switchCurrent(state.current);
      await d.writeState({ current: state.current, pinnedHash: null });
      await d.start({ version: state.current, port });
      return failure("carry-failed", `Could not carry the last uploaded contracts of ${state.current} over to ${target} (${err.message}), so ${state.current} is running again and nothing was lost.`);
    }
  }
  const carryNote = carried.length ? ` The contract you uploaded or changed in the app was kept for: ${carried.join(", ")}.` : "";
  await d.start({ version: target, port });
  if (await d.healthy(port, tgt?.hash)) return { status: "rolled-back", message: `Rolled back from ${state.current} to ${target}. The watcher will not redeploy the current source tree until it changes.${carryNote}`, version: target };
  // the older build will not start: return to where we were
  await d.stop();
  await d.switchCurrent(state.current);
  await d.writeState({ current: state.current, pinnedHash: null });
  await d.start({ version: state.current, port });
  return failure("rollback-failed", `${target} did not become healthy; ${state.current} is running again.`);
}

// The watcher's brain: file events in, at most one deploy at a time out, and never a second deploy for a tree it has
// already handled. `schedule(fn, ms)` returns a cancel function (setTimeout in production, a fake in tests).
/**
 * Build the file-watcher's controller: debounces file events, runs at most one deploy at a time, queues at most
 * one more pass if changes arrive mid-deploy, and never redeploys a tree it has already handled (except after a
 * `"port-busy"` result, which is retried on the next change).
 *
 * @param {object} options
 * @param {() => string} options.computeHash Hash of the current tree.
 * @param {() => Promise<{status: string, message: string}>} options.deploy Runs one deploy attempt.
 * @param {number} [options.quietMs] Debounce window in ms (default 20000).
 * @param {(fn: () => void, ms: number) => () => void} options.schedule Returns a cancel function (`setTimeout`
 *   in production, a fake in tests).
 * @param {(rel: string) => boolean} [options.isRelevant] Whether a changed path should restart the debounce
 *   clock (default: everything does); `deploy/`, `node_modules` and generated output should return `false`.
 * @param {(line: string) => void} [options.log] Called with one line per deploy attempt or error.
 * @returns {{onChange: (rel?: string) => void, settleNow: () => Promise<void>, stop: () => void}}
 *   `onChange`: report a file event. `settleNow`: run the debounced check immediately (tests). `stop`: cancel any
 *   pending scheduled run.
 */
export function createWatchController({ computeHash, deploy: run, quietMs = 20_000, schedule, isRelevant = () => true, log = () => {} }) {
  let cancel = null, running = false, again = false, handled = null;
  const settle = async () => {
    if (running) { again = true; return; }
    running = true;
    try {
      const hash = computeHash();
      if (hash === handled) return; // same tree as last time (a failed deploy is not retried until a file changes)
      const r = await run();
      if (r.status !== "port-busy") handled = hash; // port-busy is retried on the next change
      log(`${r.status}: ${r.message}`);
    } catch (err) {
      log(`error: ${err.message}`);
    } finally {
      running = false;
      if (again) { again = false; onChange(); }
    }
  };
  function onChange(rel) {
    if (rel != null && !isRelevant(rel)) return; // deploy/, node_modules and generated output never restart the clock
    cancel?.();
    cancel = schedule(settle, quietMs);
  }
  return { onChange, settleNow: settle, stop: () => cancel?.() };
}
