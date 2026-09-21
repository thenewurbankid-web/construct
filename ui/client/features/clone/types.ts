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
  /** `AUTH` when the repository is private or misspelled (the message says so in words). */
  code?: string;
  /** True when a one-time access token was used (the token itself is never in a job). */
  private: boolean;
  branch?: string;
  log: string[];
};

/** What the form sends to POST /api/clone. `token` is held only for the request. */
export type CloneStartInput = { url: string; name: string; branch: string; token: string };

/** A clone this browser started, remembered so it can be opened or brought up to date later (per browser). */
export type RecentClone = { id: string; name: string; url: string; dir: string; at: string; private: boolean };

/** The answer of POST /api/clone/pull. */
export type PullResult = { ok: true; message: string; upToDate: boolean; detail: string[] } | { ok: false; error: string; code?: string };

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
  /** True when the failure is "private or misspelled", so the screen can point at the token field. */
  authFailed: boolean;
  log: string[];
};
