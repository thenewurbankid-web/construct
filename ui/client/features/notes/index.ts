// Public API for feature: notes

/** View models the controller hands to the presentation components. */
export type * from './types';

/** Server response shapes (/api/notes) and the screen state (#596). */
export type * from './domain/NoteTypes';

/** The Notes screen (`/notes`): durable, autosaved drafts for the open project. */
export * from './controllers/NotesController';

/** Everything the screen does, composed from small hooks. */
export * from './hooks/useNotes';

/** Notes over /api/notes, for the screens that keep a note of their own (the Plan screen, #609). */
export * from './services/NotesApi';
