// Test fixture only (#351): a review worker that holds its temporary checkouts open, so a test can cancel an
// analysis while `git worktree` registrations and a `construct-prhealth-<pid>-*` directory really exist.
//
// It does exactly what the real worker does to get them (`withTrees`), then blocks in a synchronous wait,
// like the real engine does inside `spawnSync`, so a SIGTERM's handler cannot run until the wait ends: the
// parent has to SIGKILL and reclaim. It writes `{pid, dirs}` to the file named by OG351_MARKER (synchronously,
// so the test can see the checkouts exist before it cancels).
import fs from 'node:fs';
import { withTrees } from '../../../src/engine/gitTrees.mjs';

process.once('message', (job) => {
  withTrees(job.root, [job.baseSha, job.headSha], (dirs) => {
    if (process.env.OG351_MARKER) fs.writeFileSync(process.env.OG351_MARKER, JSON.stringify({ pid: process.pid, dirs }));
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60_000);
    return null;
  });
  process.send({ ok: false, error: { code: 'WORKER_FAILED', message: 'fixture finished without being cancelled' } }, () => process.exit(0));
});
