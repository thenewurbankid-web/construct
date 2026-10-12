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

/** The frame itself (switch-aware layout, breadcrumb, chat helper), for a screen that keeps its own chat (Features, cd1). */
export * from './controllers/ModesFrameController';

/** A screen's mode, its default for the switch, and what a crumb does. */
export * from './hooks/useScreenModes';

/** Tells the shell's switch a screen's default mode (for a screen that renders its own frame, like Features). */
export * from './hooks/useScreenDefault';

/** Chat mode's live stage (read-only blocks of what is active under the hood). */
export * from './controllers/LiveStageController';

/** Under the hood: whether the person hid the chat helper. */
export * from './hooks/useChatHidden';

/** The shapes passed between the hooks and the page. */
export type * from './types';

/** The live stage's state (blocks fading out, open or folded, the static focus outline). */
export * from './hooks/useLiveStage';
