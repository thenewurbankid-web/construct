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

/** The words: URL hints, the folder name a URL gets, a job as the screen shows it. */
export * from './domain/CloneWording';

/** The form's and the remote's state machines. */
export * from './workflows/Clone';
