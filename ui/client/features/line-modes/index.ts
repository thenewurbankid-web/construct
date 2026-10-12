// Public API for feature: line-modes (two modes on every screen: Chat and Under the hood). The contract is
// lib/lineModes.ts; each screen keeps its options provider in its own feature folder.

/** The person's mode, remembered per user. Mount the provider once around the shell. */
export * from './hooks/useLineMode';

/** The shell's global switch. */
export * from './controllers/ModeSwitchController';

/** Both modes for one screen: give it the screen's provider, its data and its regular view. */
export * from './controllers/ScreenModesController';

/** One screen's chat, driven by its provider (for a screen that renders its own frame). */
export * from './hooks/useScreenChat';
