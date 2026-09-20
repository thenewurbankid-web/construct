// Pure (DOMAIN-001): how "clone a repository" talks — the hint for a URL as it is typed, the folder name it
// will get, and a job as the screen shows it. The server re-validates everything; this only saves a round trip
// and explains a refusal in plain words.
import type { CloneJob, CloneJobView, CloneState } from '../types.ts';

const STATE_LABEL: Record<CloneState, string> = {
  running: 'Cloning',
  cancelling: 'Cancelling',
  done: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

/** The folder name a URL will get (`https://github.com/o/my-repo(.git)` -> `my-repo`), or '' when it has none yet. */
export function suggestFolderName(url: string): string {
  const m = /^https:\/\/[^/\s]+\/[^/\s]+\/([^/\s?#]+?)(?:\.git)?\/?$/i.exec(url.trim());
  return m ? m[1] : '';
}

/** A short, plain hint about what is wrong with a URL as typed, or null when it looks fine. */
export function urlProblem(url: string): string | null {
  const v = url.trim();
  if (v === '') return null;
  if (!/^https:\/\//i.test(v)) return 'Use an https:// address, for example https://github.com/owner/repository.';
  if (/^https:\/\/[^/]*@/i.test(v)) return 'Do not put a user name or password in the address.';
  if (!/^https:\/\/[^/\s]+\/[^/\s]+\/[^/\s?#]+\/?$/i.test(v)) return 'The address should look like https://github.com/owner/repository.';
  return null;
}

/** The percentage in the tool's own progress text ("Receiving objects:  42% (4/10)"), or null. */
export function percentOf(progress: string): number | null {
  const m = /(\d{1,3})%/.exec(progress);
  return m ? Math.min(100, Number(m[1])) : null;
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 KB';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

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
    log: job.log,
  };
}

export const isLiveJob = (job: CloneJob | null | undefined) => !!job && isLive(job.state);
