// Public API for feature: project-picker (what is left of the retired route wizard: its in-project folder picker).

/** The project tree and pick types. */
export type * from './types';

/** One folder of the open project at a time, with "Use" per folder (#600); the shell's "Change workspace folder"
 * (Line cu6) uses it, so the Cockpit has one in-project folder picker. */
export * from './controllers/ProjectFolderPickerController';
