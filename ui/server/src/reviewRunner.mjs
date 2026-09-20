// #312/#313/#351 -- runs ONE analysis in a forked child process (reviewWorker.mjs), so the synchronous
// PR-health engine can never stall the Cockpit server's request thread.
//
// It can be stopped: an AbortSignal (the process engine's cancel, #287) or the timeout ends the child the
// way the worker was designed to be ended. SIGTERM first, because the worker's temporary `git worktree`
// checkouts are removed by its own SIGINT/SIGTERM/SIGHUP handler (src/engine/gitTrees.mjs). That handler
// only runs when the worker's synchronous stretch returns (the engine uses spawnSync), so after a grace
// period the child is SIGKILLed, and whatever it could not clean up is reclaimed HERE, deterministically
// and only for that child's pid (`reclaimTreesOf`). Either way, when the returned promise settles, no
// worktree registration and no `construct-prhealth-<pid>-*` directory of that child is left.
import { fork } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reclaimTreesOf } from '../../../src/engine/gitTrees.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const WORKER = path.join(HERE, 'reviewWorker.mjs');
export const JOB_TIMEOUT_MS = 180_000;
export const CANCEL_GRACE_MS = 3_000;

const children = new Set();
process.on('exit', () => { for (const c of children) c.kill('SIGKILL'); });

/** Stop a child: SIGTERM, wait `graceMs` for it to clean up and exit, then SIGKILL; then reclaim its debris. */
function terminate(child, root, graceMs) {
  return new Promise((resolve) => {
    let done = false;
    const end = () => {
      if (done) return;
      done = true;
      clearTimeout(killer);
      children.delete(child);
      try { reclaimTreesOf(child.pid, root); } catch { /* best effort: the caller verifies */ }
      resolve();
    };
    if (child.exitCode !== null || child.signalCode !== null) return end();
    child.once('exit', end);
    const killer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* already gone */ } }, graceMs);
    try { child.kill('SIGTERM'); } catch { end(); }
  });
}

/**
 * Default runner: one child process per job. Resolves to the worker's result object; never rejects.
 * @param {object} job `{root, baseSha, headSha, expected?}` (validated by the caller)
 * @param {{timeoutMs?:number, signal?:AbortSignal, worker?:string, graceMs?:number, onProgress?:(m:object)=>void}} [opts]
 */
export function forkRunner(job, { timeoutMs = JOB_TIMEOUT_MS, signal, worker = WORKER, graceMs = CANCEL_GRACE_MS, onProgress } = {}) {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve({ ok: false, error: { code: 'CANCELLED', message: 'The analysis was cancelled before it started.' } });
    const child = fork(worker, [], { execArgv: [], stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
    children.add(child);
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      // A finished worker has already removed its checkouts; a failed or stopped one may not have.
      terminate(child, job.root, result?.ok ? 0 : graceMs).then(() => resolve(result));
    };
    const onAbort = () => finish({ ok: false, error: { code: 'CANCELLED', message: 'The analysis was cancelled.' } });
    const timer = setTimeout(() => finish({ ok: false, error: { code: 'TIMEOUT', message: `The analysis took longer than ${Math.round(timeoutMs / 1000)} seconds and was stopped.` } }), timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    child.on('message', (m) => {
      if (m && typeof m === 'object' && m.progress) { try { onProgress?.(m); } catch { /* a listener must not stop the job */ } return; }
      finish(m);
    });
    child.once('error', (e) => finish({ ok: false, error: { code: 'WORKER_FAILED', message: String(e.message || e) } }));
    child.once('exit', (code) => finish({ ok: false, error: { code: 'WORKER_FAILED', message: `The analysis process stopped unexpectedly (exit ${code}).` } }));
    child.send(job);
  });
}
