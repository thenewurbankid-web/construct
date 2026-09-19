// Public API for feature: shell

/** Shared shell types (themes, panes, tabs, ...). */
export type * from './types';

/** The Cockpit frame (top bar, Browser | stage | Tools, drawer, status bar). Mount once in the root layout. */
export * from './controllers/ShellController';

/** Dark/light theme switch (persisted, no flash). */
export * from './controllers/ThemeController';

/** Pre-paint theme bootstrap for the document head. */
export * from './domain/ThemeInit';

/** Current theme + toggle (used by ThemeController). */
export * from './hooks/useTheme';

/** Let a feature add a tab to the Browser / Tools / Drawer regions (slot registry). */
export * from './hooks/useShellTabs';

/** Open a collapsed pane from a feature (Tools panel etc.). */
export * from './hooks/useRevealPane';

/** Which tab is selected per region. */
export * from './hooks/useActiveTabs';

/** Local-model status for the top-bar pill (from the ollama feature). */
export * from './hooks/useModelStatus';

/** Drag + keyboard behaviour of a pane separator. */
export * from './hooks/usePaneResizer';

/** Current local project and the switch action. */
export * from './hooks/useProjectSwitcher';

/** Pane sizes and collapse state, remembered per project. */
export * from './hooks/useShellLayout';

/** Current path and the top-bar mode it belongs to. */
export * from './hooks/useShellRoute';

/** Global keyboard shortcuts (Ctrl B, Ctrl Alt B, Ctrl J, F6). */
export * from './hooks/useShellShortcuts';

/** Active tab resolution and tablist keyboard handling. */
export * from './hooks/useTabHost';
