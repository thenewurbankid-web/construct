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
  /** `AUTH` when the repository is private or misspelled; `NOT_VISIBLE_TO_CONNECTION` when the GitHub connection cannot see it (the message says so in words). */
  code?: string;
  /** True when a one-time access token was used (the token itself is never in a job). */
  private: boolean;
  /** `login` when the clone used the person's GitHub connection instead of a pasted token (#638). */
  via?: 'login';
  branch?: string;
  log: string[];
};

/** What the form sends to POST /api/clone. `token` is held only for the request; `useLogin` (#638) asks the server to use
 * this session's GitHub connection instead, and is never sent together with a token. */
export type CloneStartInput = { url: string; name: string; branch: string; token: string; useLogin?: boolean };

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
  /** True when the GitHub connection cannot see the repository (its app is not installed there), so the screen can point at the connection. */
  notVisible: boolean;
  log: string[];
};

/** What the pasted text was read as: the address that will be cloned, the folder and the branch. */
export type ClonePreview = { url: string; folder: string; branch: string | null; how: string; note: string | null };

/** One recent clone as the list draws it. */
export type RecentCloneRow = {
  id: string;
  name: string;
  url: string;
  when: string;
  isPrivate: boolean;
  pulling: boolean;
  /** What the last update said, and whether it worked. */
  pullMessage: string | null;
  pullOk: boolean;
};

/** GET /api/github/status (#638): `enabled` false means the feature is off on this server and nothing about it shows. */
export type GithubStatus = { enabled: boolean; connected: boolean; login?: string };
export type GithubStatusResult = { ok: true; status: GithubStatus } | { ok: false; error: string };

/** A repository the GitHub connection can read: names and visibility only. */
export type GithubRepo = { fullName: string; owner: string; name: string; private: boolean };
export type GithubRepoList = { repos: GithubRepo[]; page: number; perPage: number; total: number; hasMore: boolean; truncated: boolean; source: string; installations: number | null };
export type GithubReposResult = { ok: true; list: GithubRepoList } | { ok: false; error: string; code?: string };

/** How a private clone is authorised: the person's GitHub connection, or a pasted token. */
export type CloneAuthMode = 'login' | 'token';

/** One entry of the repository picker. */
export type RepoOption = { value: string; label: string };

/** What the Settings row and the clone form's connection panel show. */
export type GithubPanelView = {
  /** False when the feature is off on this server: render nothing at all. */
  visible: boolean;
  connected: boolean;
  /** "Connected as octo" / "Not connected". */
  summary: string;
  login: string | null;
};
