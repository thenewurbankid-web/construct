// Public API for feature: git-session (#283 — commit on save)

/** Session/config/commit shapes from ui/server's `/api/git/*`, plus the finished view models. */
export type * from './types';

/** Mode names, windows and what each mode will actually do. */
export * from './domain/CommitWording';

/** The counted impact a commit claims, as text. */
export * from './domain/CommitImpactText';

/** What the indicator says, and when Commit is offered. */
export * from './domain/SaveState';

/** One status object in, two finished view models out. */
export * from './domain/GitSessionView';

/** The indicator plus the dirty-tree prompt — composed as a slot by the editors. */
export * from './controllers/CommitIndicatorController';

/** The Settings-screen controls: mode, window, prefixes and the off switch. */
export * from './controllers/AutoCommitSettingsController';

/** Loads the session and applies changes — used by both controllers; exported for reuse/testing. */
export * from './hooks/useGitSession';

/** The session's own state machine (loading / busy / error). */
export * from './workflows/GitSession';
