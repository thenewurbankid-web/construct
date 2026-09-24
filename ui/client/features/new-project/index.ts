// Public API for feature: new-project (#445 — start a project inside the Cockpit)

/** Framework choice, the server's answer and the form state. */
export type * from './types';

/** The "New project" form: `onCreated(dir)` receives the folder the server made, initialised and opened. Composed as
 * a slot by the Open-a-project screen. */
export * from './controllers/NewProjectController';

/** Hints for the name typed so far, and where the folder will be made. */
export * from './domain/NewProjectName';

/** The form's state machine. */
export * from './workflows/NewProject';

/** Creates a project from a name; hands the new folder to the caller. */
export * from './hooks/useNewProject';
