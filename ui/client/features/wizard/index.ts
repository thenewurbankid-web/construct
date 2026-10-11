// Public API for feature: wizard

/** Shared identifier, chat-message, and wizard-event types for the wizard
 * feature. */
export type * from './types';

/** Renders the import route wizard as a chat, behind the project gate. */
export * from './controllers/WizardController';

/** Drives the wizard's chat/connection state over ui/server's /ws/wizard —
 * used by WizardController; exported for direct reuse/testing. */
export * from './hooks/useWizard';

/** One folder of the open project at a time, with "Use" per folder (#600); the shell's "Change workspace folder"
 * (Line cu6) reuses it, so the Cockpit has one in-project folder picker. */
export * from './controllers/ProjectFolderPickerController';
