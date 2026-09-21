// Public API for feature: clone (#330 — clone a public repository into the workspace, connect a remote)

/** Job / remote / view-model types from ui/server's /api/clone and /api/git/remote. */
export type * from './types';

/** The "Clone a repository" form: `onCloned(dir)` receives the finished folder. Composed as a slot by the
 * Open-a-project screen. */
export * from './controllers/CloneController';

/** "Connect a remote" for the open project (a slot on the Settings screen). */
export * from './controllers/ConnectRemoteController';

/** Recent clones, for the Processes drawer. */
export * from './controllers/CloneJobsController';

/** URL hints and the folder name an address will get. */
export * from './domain/CloneUrl';

/** Reads what people paste (owner/repo, a browser link, a git clone line) into one https address. */
export * from './domain/CloneInput';

/** Plain-words hints for the folder name, branch and token fields. */
export * from './domain/CloneFieldHints';

/** What the form shows for the text typed so far, and the rows of the recent list. */
export * from './domain/CloneFormView';

/** Progress numbers in words: the percentage in git's text, sizes at a glance. */
export * from './domain/CloneProgress';

/** A clone job as the screen shows it. */
export * from './domain/CloneJobView';

/** The clone form's state machine. */
export * from './workflows/Clone';

/** The recent-clones list's state machine. */
export * from './workflows/Recent';

/** The remote form's state machine. */
export * from './workflows/Remote';

/** Starts a clone, follows it until it ends, cancels it; hands the finished folder to the caller. */
export * from './hooks/useClone';

/** This browser's recent clones, with Pull latest. */
export * from './hooks/useRecentClones';

/** Reads the open project's remote and adds an `origin` when it has none. */
export * from './hooks/useRemote';

/** Recent clone jobs, refreshed while the Processes drawer shows them. */
export * from './hooks/useCloneJobs';
