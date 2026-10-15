// The gate, isolated (2026-10-15: one typed-array answer given a large length from the test inputs allocated 14 GB
// inside the library run and the run was killed). Answers are gated in worker processes; a watchdog kills a worker
// that grows past `maxMb` or takes longer than `timeoutMs` on one answer, and that answer is refused with the reason.
// A new worker takes its place. Heap limits alone would not do: typed-array memory lives outside the JS heap.
import { execFileSync, fork } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const WORKER = fileURLToPath(new URL('./gate-worker.mjs', import.meta.url));

/** The resident memory of a process in MB: /proc on Linux, else `ps` (macOS has no /proc); null when neither works. */
export function rssMb(pid) {
  try {
    const m = readFileSync(`/proc/${pid}/status`, 'utf8').match(/^VmRSS:\s+(\d+) kB/m);
    if (m) return Number(m[1]) / 1024;
  } catch {
    // no /proc: fall through to ps
  }
  try {
    const kb = Number(execFileSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' }).trim());
    return Number.isFinite(kb) && kb > 0 ? kb / 1024 : null;
  } catch {
    return null;
  }
}

/** A refusal for an answer whose run had to be stopped, in the gate's own shape. */
export function stoppedVerdict(entry, why) {
  return {
    entry,
    pass: false,
    checks: { schema: 'pass', grammar: 'pass', equivalence: 'fail', types: 'skip' },
    refusal: `Running the answer's js ${why}, so it was stopped; write js that does the same as the reference without building something huge or looping forever.`,
    fixes: [],
  };
}

/**
 * A pool of gate workers. gate(key, answer) resolves to the C3 verdict, never throws for what the answer does.
 * @param {{size?: number, maxMb?: number, timeoutMs?: number, forkFn?: Function, rss?: Function}} options
 */
export function gatePool({ size = 4, maxMb = 1536, timeoutMs = 20_000, forkFn = fork, rss = rssMb } = {}) {
  const queue = [];
  const workers = [];
  let next = 0;
  let closed = false;

  const start = () => {
    const w = { child: forkFn(WORKER, [], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] }), job: null, ready: false };
    w.child.on('message', (m) => {
      if (m.ready) {
        w.ready = true;
        return pump();
      }
      if (!w.job || m.id !== w.job.id) return;
      const job = w.job;
      finish(w);
      job.resolve(m.verdict ?? stoppedVerdict(job.answer?.entry ?? job.key, `failed inside the gate (${m.error})`));
    });
    w.child.on('exit', () => {
      const job = w.job;
      const why = w.killedFor;
      workers.splice(workers.indexOf(w), 1);
      clearInterval(w.watch);
      if (job) job.resolve(stoppedVerdict(job.answer?.entry ?? job.key, why ?? 'ended the gate process'));
      if (!closed) {
        workers.push(start());
        pump();
      }
    });
    w.watch = setInterval(() => {
      if (!w.job) return;
      const mb = rss(w.child.pid);
      if (mb !== null && mb > maxMb) kill(w, `used more than ${Math.round(maxMb / 1024 * 10) / 10} GB of memory`);
      else if (Date.now() - w.job.started > timeoutMs) kill(w, `ran for more than ${Math.round(timeoutMs / 1000)} seconds`);
    }, 200);
    w.watch.unref?.();
    return w;
  };
  const kill = (w, why) => {
    w.killedFor = why;
    w.child.kill('SIGKILL');
  };
  const finish = (w) => {
    w.job = null;
    pump();
  };
  const pump = () => {
    for (const w of workers) {
      if (!queue.length) return;
      if (!w.ready || w.job) continue;
      const job = queue.shift();
      job.started = Date.now();
      w.job = job;
      w.child.send({ id: job.id, key: job.key, answer: job.answer });
    }
  };
  for (let i = 0; i < size; i++) workers.push(start());

  return {
    gate: (key, answer) => new Promise((resolve) => {
      queue.push({ id: ++next, key, answer, resolve });
      pump();
    }),
    close: () => {
      closed = true;
      for (const w of workers) {
        clearInterval(w.watch);
        w.child.kill();
      }
    },
  };
}
