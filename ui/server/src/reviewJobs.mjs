// #312/#313 -- the analysis queue behind Review mode.
//
// The PR-health engine is synchronous and can take seconds, so it NEVER runs on the server's request
// thread: each job is one forked child process (reviewWorker.mjs). Jobs run one at a time (the box is
// small and each job checks out two trees), are keyed by (root, base commit, head commit) so asking
// twice is free and a moved branch is a new key, and finished results are kept in a bounded cache.
// A child that exceeds the timeout is killed, and so is every child when the server stops.
import { fork } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKER = path.join(HERE, 'reviewWorker.mjs');
export const JOB_TIMEOUT_MS = 180_000;
const MAX_CACHED = 100;

const children = new Set();
process.on('exit', () => { for (const c of children) c.kill('SIGKILL'); });

/** Default runner: one child process per job. Resolves to the worker's result object; never rejects. */
export function forkRunner(job, { timeoutMs = JOB_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    const child = fork(WORKER, [], { execArgv: [], stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
    children.add(child);
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      children.delete(child);
      if (!child.killed) child.kill('SIGKILL');
      resolve(result);
    };
    const timer = setTimeout(() => finish({ ok: false, error: { code: 'TIMEOUT', message: `The analysis took longer than ${Math.round(timeoutMs / 1000)} seconds and was stopped.` } }), timeoutMs);
    child.once('message', (m) => finish(m));
    child.once('error', (e) => finish({ ok: false, error: { code: 'WORKER_FAILED', message: String(e.message || e) } }));
    child.once('exit', (code) => finish({ ok: false, error: { code: 'WORKER_FAILED', message: `The analysis process stopped unexpectedly (exit ${code}).` } }));
    child.send(job);
  });
}

/**
 * @param {{run?: (job:object)=>Promise<object>}} [opts] `run` is the test seam; the default forks a child.
 */
export function createReviewJobs({ run = forkRunner } = {}) {
  const entries = new Map(); // key -> {state:'queued'|'running'|'done'|'error', result?, error?}
  const queue = [];
  let busy = false;

  const keyOf = ({ root, baseSha, headSha }) => `${root}\0${baseSha}\0${headSha}`;

  function pump() {
    if (busy) return;
    const next = queue.shift();
    if (!next) return;
    busy = true;
    const entry = entries.get(next.key);
    entry.state = 'running';
    Promise.resolve()
      .then(() => run(next.job))
      .catch((e) => ({ ok: false, error: { code: 'WORKER_FAILED', message: String(e?.message || e) } }))
      .then((result) => {
        if (result?.ok) Object.assign(entry, { state: 'done', result });
        else Object.assign(entry, { state: 'error', error: result?.error ?? { code: 'WORKER_FAILED', message: 'The analysis produced no result.' } });
        trim();
      })
      .finally(() => { busy = false; pump(); });
  }

  function trim() {
    for (const [k, v] of entries) {
      if (entries.size <= MAX_CACHED) break;
      if (v.state === 'done' || v.state === 'error') entries.delete(k);
    }
  }

  return {
    /** Queue a job unless one for the same commits is already known. Returns the entry. */
    enqueue(job) {
      const key = keyOf(job);
      const known = entries.get(key);
      if (known && known.state !== 'error') return known;
      const entry = { state: 'queued' };
      entries.set(key, entry);
      queue.push({ key, job });
      pump();
      return entry;
    },
    /** The current entry, or `{state:'none'}`. */
    get: (job) => entries.get(keyOf(job)) ?? { state: 'none' },
    /** For tests and status: how many jobs are waiting or running. */
    pending: () => queue.length + (busy ? 1 : 0),
  };
}
