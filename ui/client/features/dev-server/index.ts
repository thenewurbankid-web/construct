// Public API for feature: dev-server (#378 — start the target app's dev server from the Cockpit)

/** Status, refusal and view shapes from ui/server's `/api/dev-server`. */
export type * from './types';

/** What each state of the server says and offers; and which kind of branch is checked out. */
export * from './domain/DevServerView';

/** The dev server's card and branch indicator, composed as a slot by the editors. */
export * from './controllers/DevServerController';

/** Loads the status and drives Start / Restart / Stop; exported for reuse and testing. */
export * from './hooks/useDevServer';

/** The polled status (and its reducer-backed session state). */
export * from './hooks/useDevServerStatus';

/** Announces the server's address to the screen that frames it. */
export * from './hooks/useDevServerUrl';

/** The card's own state machine (status, busy, first-start question). */
export * from './workflows/DevServer';
