// Public API for feature: command-palette

/** The Command shape features register (id, title, keywords, group, hint, run). */
export type * from './types';

/** The palette overlay (Ctrl/Cmd+K). Mount once inside CommandRegistryProvider. */
export * from './controllers/CommandPaletteController';

/** Command registry: the provider and the read-side hook. */
export * from './hooks/useCommandRegistry';

/** Registers commands while a component is mounted (the way a feature adds to the palette). */
export * from './hooks/useRegisterCommands';

/** Opens the palette from anywhere (e.g. a top-bar trigger). */
export * from './hooks/useOpenPalette';

/** Palette behaviour (query, selection, Ctrl/Cmd+K); used by CommandPaletteController. */
export * from './hooks/useCommandPalette';

/** Shortcut and focus lifecycle of the palette; used by useCommandPalette. */
export * from './hooks/usePaletteLifecycle';
