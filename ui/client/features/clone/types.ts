export type CloneId = string;

/** A clone job as ui/server's /api/clone returns it (ui/server/src/cloneJobs.mjs). */
export type CloneState = 'running' | 'cancelling' | 'done' | 'failed' | 'cancelled';

export type CloneJob = {
  id: string;
  kind: 'clone';
  title: string;
  url: string;
  name: string;
  state: CloneState;
  progress: string;
  bytes: number;
  startedAt: string;
  finishedAt: string | null;
  /** Absolute path of the finished clone (only when `state` is `done`). */
  dir?: string;
  error?: string;
  log: string[];
};

export type CloneStartResult = { ok: true; job: CloneJob } | { ok: false; error: string };
export type CloneReadResult = { ok: true; job: CloneJob } | { ok: false; error: string };

/** What the open project's remote looks like (GET /api/git/remote). */
export type RemoteStatus = { repo: boolean; connected: boolean; url: string | null };
export type RemoteResult = { ok: true; status: RemoteStatus } | { ok: false; error: string };

/** The presentational shape of a job the components draw. */
export type CloneJobView = {
  id: string;
  title: string;
  stateLabel: string;
  tone: 'live' | 'done' | 'bad' | 'idle';
  progress: string;
  percent: number | null;
  size: string;
  live: boolean;
  error: string | null;
  log: string[];
};
