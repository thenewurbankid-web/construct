// Pure (DOMAIN-001): a clone job as the screen shows it.
import type { CloneJob, CloneJobView, CloneState } from '../types.ts';
import { formatBytes, percentOf } from './CloneProgress.ts';

const STATE_LABEL: Record<CloneState, string> = {
  running: 'Cloning',
  cancelling: 'Cancelling',
  done: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

const isLive = (s: CloneState) => s === 'running' || s === 'cancelling';

export function buildJobView(job: CloneJob): CloneJobView {
  const live = isLive(job.state);
  return {
    id: job.id,
    title: job.title,
    stateLabel: STATE_LABEL[job.state] ?? job.state,
    tone: live ? 'live' : job.state === 'done' ? 'done' : job.state === 'failed' ? 'bad' : 'idle',
    progress: job.state === 'done' ? `Cloned into ${job.name}` : (job.error ?? job.progress),
    percent: live ? percentOf(job.progress) : job.state === 'done' ? 100 : null,
    size: formatBytes(job.bytes),
    live,
    error: job.error ?? null,
    authFailed: job.code === 'AUTH',
    notVisible: job.code === 'NOT_VISIBLE_TO_CONNECTION',
    log: job.log,
  };
}

export const isLiveJob = (job: CloneJob | null | undefined) => !!job && isLive(job.state);
