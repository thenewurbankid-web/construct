import type { CloneJob, CloneReadResult } from '../types';

/** Timers are external effects (SERVICE-001): the polling loops of the clone feature live here, not in its hooks. */
const CLONE_JOB_POLL_MS = 700;
const CLONE_LIST_POLL_MS = 2000;

/** Follow one clone job: read it every tick and hand each successful read to `onJob`. A read that lands after
 * the returned stop function ran is dropped. */
export function pollCloneJob(
  jobId: string,
  read: (id: string) => Promise<CloneReadResult>,
  onJob: (job: CloneJob) => void,
  intervalMs: number = CLONE_JOB_POLL_MS,
): () => void {
  let stop = false;
  const tick = async () => {
    const r = await read(jobId);
    if (stop) return;
    if (r.ok) onJob(r.job);
  };
  const t = setInterval(tick, intervalMs);
  return () => {
    stop = true;
    clearInterval(t);
  };
}

/** Keep the recent-clones list fresh: one read now, then one per tick; a null list (unreachable) keeps what is shown. */
export function pollCloneList(
  list: () => Promise<CloneJob[] | null>,
  onJobs: (jobs: CloneJob[]) => void,
  intervalMs: number = CLONE_LIST_POLL_MS,
): () => void {
  let stop = false;
  const tick = async () => {
    const jobs = await list();
    if (!stop && jobs) onJobs(jobs);
  };
  void tick();
  const t = setInterval(tick, intervalMs);
  return () => {
    stop = true;
    clearInterval(t);
  };
}
