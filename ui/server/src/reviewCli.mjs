// #541 -- the `cli` execution mode of a Review analysis: the same job the forked worker runs (reviewRunner.mjs),
// but the PR-health report comes from the real `construct review <base> <head> --format json` subprocess
// (coreVerbs.runReview), so the Cockpit shows exactly what the pinned CLI computes.
//
// It is a drop-in for `forkRunner`: same `(job, {signal, timeoutMs, graceMs, onProgress, reclaim})` contract,
// same `{ok, report, units, unitsOmitted, ...}` | `{ok:false, error:{code, message}}` result, never rejects. What
// stays in-process is only the Cockpit's own enrichment, "what each changed file now does" (`units`): it is not
// part of the CLI's report, and it runs in the existing forked worker (`unitsOnly`), so a large change still never
// blocks the request thread.
//
// SAFETY, in addition to the read-only guarantees of the worker path:
//   * containment: the subprocess gets `--dir <job.root>` only, and only when that directory IS its own nearest
//     `architecture.yml` root. The CLI resolves `--dir` by walking UP to the nearest architecture.yml, so a
//     repository whose top level has none would otherwise climb out of the project (possibly out of the
//     workspace). Such a root is refused with CLI_ROOT_MISMATCH, never guessed.
//   * cancellation: an abort or the timeout stops the CLI's process group (SIGTERM, then SIGKILL after the
//     grace period) and then reclaims the temporary checkouts the CLI's pid left behind, like the worker path.
import fs from 'node:fs';
import { findProjectRoot } from '../../../packages/core/config.mjs';
import { reclaimTreesOf } from '../../../packages/engine/gitTrees.mjs';
import { ExecutionError } from './coreExecutor.mjs';
import { runReview } from './coreVerbs.mjs';
import { forkRunner, JOB_TIMEOUT_MS, CANCEL_GRACE_MS, WORKER } from './reviewRunner.mjs';

/** Are these two paths the same directory (symlinks resolved)? */
const same = (a, b) => { try { return fs.realpathSync.native(a) === fs.realpathSync.native(b); } catch { return false; } };

/**
 * Run one analysis through the real CLI.
 *
 * @param {object} job `{root, baseSha, headSha, expected?}` exactly as the fork runner takes it.
 * @param {{timeoutMs?:number, signal?:AbortSignal, graceMs?:number, onProgress?:(m:object)=>void, reclaim?:(pid:number, root:string)=>void,
 *   what?:string, cli?:object, units?:Function}} [opts] `cli` passes `env`, `bin`, `spawnImpl` to the executor; `units` replaces
 *   the forked units step (tests).
 * @returns {Promise<object>} The worker-shaped result.
 */
export async function cliReviewRunner(job, { timeoutMs = JOB_TIMEOUT_MS, signal, graceMs = CANCEL_GRACE_MS, onProgress, reclaim = reclaimTreesOf, what = 'analysis', cli = {}, units = forkRunner } = {}) {
  const fail = (code, message) => ({ ok: false, error: { code, message } });
  if (signal?.aborted) return fail('CANCELLED', `The ${what} was cancelled before it started.`);
  const nearest = findProjectRoot(job.root);
  if (nearest === null || !same(nearest, job.root)) {
    return fail('CLI_ROOT_MISMATCH', `The ${what} runs the construct CLI only in a folder that holds its own architecture.yml; ${job.root} does not, so it was not run. Set project.execution.mode to engine for this project.`);
  }
  let pid = null;
  const started = Date.now();
  let review;
  try {
    onProgress?.({ progress: 'Running construct review in a subprocess.' });
    review = await runReview(job.root, {
      mode: 'cli', base: job.baseSha, head: job.headSha, expected: job.expected ?? null,
      timeoutMs, signal, graceMs, onStart: (p) => { pid = p; }, ...cli,
    });
  } catch (e) {
    // What a stopped or killed CLI could not remove itself is reclaimed here, only for that child's pid.
    if (pid !== null) { try { reclaim(pid, job.root); } catch { /* best effort */ } }
    if (e instanceof ExecutionError) {
      if (e.code === 'CLI_CANCELLED') return fail('CANCELLED', `The ${what} was cancelled.`);
      if (e.code === 'CLI_TIMEOUT') return fail('TIMEOUT', `The ${what} took longer than ${Math.round(timeoutMs / 1000)} seconds and was stopped.`);
      return fail('CLI_FAILED', e.message);
    }
    return fail('WORKER_FAILED', String(e?.message || e));
  }
  if (pid !== null) { try { reclaim(pid, job.root); } catch { /* best effort */ } }
  if (!review.doc.ok) return { ok: false, error: review.doc.error };
  const report = review.doc;
  const left = Math.max(1000, timeoutMs - (Date.now() - started));
  const rows = await units({ unitsOnly: true, root: job.root, headSha: job.headSha, files: report.change.files }, { timeoutMs: left, signal, graceMs, onProgress, what: `${what} (changed files)`, worker: WORKER });
  if (!rows?.ok) {
    if (rows?.error?.code === 'CANCELLED') return rows;
    return { ok: true, report, units: [], unitsOmitted: 0, unitsError: rows?.error?.message ?? 'Could not read the head commit.', worker: { pid, via: 'cli' } };
  }
  return { ok: true, report, units: rows.units, unitsOmitted: rows.unitsOmitted, ...(rows.unitsError ? { unitsError: rows.unitsError } : {}), worker: { pid, via: 'cli' } };
}
