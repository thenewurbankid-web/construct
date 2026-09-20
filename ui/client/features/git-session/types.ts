/** Shapes ui/server's `/api/git/*` routes return (see ui/server/src/autoCommit.mjs), plus the
 * finished view models the domain layer builds from them. Nothing here is persisted: restarting
 * the backend resets the session and the config to their defaults. */

/** Commit granularity (#283) — all three are the user's to choose. */
export type CommitMode = 'coalesce' | 'every-save' | 'manual';

export type CommitConfig = {
  /** Auto-commit is ON by default for new projects; this is the real off switch. */
  enabled: boolean;
  mode: CommitMode;
  /** How long `coalesce` folds repeated saves into one commit. */
  coalesceMs: number;
  /** The user's commit-message prefix; may be empty. The session id and serial are ours. */
  messagePrefix: string;
  /** The user's session-branch prefix (`cockpit/…`) and suffix; either may be empty. */
  branchPrefix: string;
  branchSuffix: string;
  modes: CommitMode[];
  maxCoalesceMs: number;
};

export type CommitImpact = {
  features: number;
  layers: number;
  files: number;
  perFeature: { name: string; layers: string[] }[];
};

export type CommitRecord = {
  sha: string;
  /** `CON-a3f7-0007` — prefix, session id, serial. */
  label: string;
  subject: string;
  serial: number;
  branch: string;
  sessionId: string;
  files: string[];
  impact: CommitImpact;
  message: string;
  at: string;
};

/** The dirty working tree found at session start, grouped by feature and layer so the prompt is
 * answerable rather than a generic "you have uncommitted changes". */
export type DirtyPrompt = {
  count: number;
  files: string[];
  groups: { name: string; kind: string; layers: string[]; files: string[] }[];
  question: string;
};

export type DirtyAnswer = 'carry' | 'stash';

export type GitSession = {
  sessionId: string;
  branch: string | null;
  adopted: boolean;
  pending: string[];
  /** Milliseconds left in the coalescing window, or null when no window is open. */
  dueInMs: number | null;
  awaitingDecision: DirtyPrompt | null;
  dirtyAnswer: DirtyAnswer | null;
  stash: string | null;
  commits: CommitRecord[];
  lastCommit: CommitRecord | null;
};

export type GitSessionStatus = {
  ok: boolean;
  config: CommitConfig;
  /** False when the project directory is not a git repository — saves still work, nothing commits. */
  repo: boolean;
  branch: string | null;
  remembered: DirtyAnswer | null;
  session: GitSession | null;
};

/** The indicator's one-line state. `kind` also drives its colour, via a `data-state` attribute. */
export type SaveStateKind = 'off' | 'no-repo' | 'idle' | 'pending' | 'asking' | 'committed';
export type SaveState = { kind: SaveStateKind; text: string };

/** Everything the save-time surfaces render, already formatted (see domain/GitSessionView.ts). */
export type GitSessionView = {
  state: SaveState;
  canCommit: boolean;
  stash: string | null;
  lastCommit: { label: string; subject: string; branch: string; impactText: string; perFeatureText: string } | null;
  prompt: { question: string; count: number; files: string[]; groupLines: string[] } | null;
};

/** Everything the Settings controls render, already labelled. */
export type AutoCommitView = {
  config: CommitConfig;
  repo: boolean;
  branch: string | null;
  modeOptions: { value: string; label: string }[];
  modeHint: string;
  windowOptions: { value: string; label: string }[];
  windowHint: string;
  messageExample: string;
  branchExample: string;
};
