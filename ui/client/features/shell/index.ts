// Public API for feature: shell

/** Shared shell types (themes, panes, tabs, ...). */
export type * from './types';

/** The Cockpit frame (top bar, Browser | stage | Tools, drawer, status bar). Mount once in the root layout. */
export * from './controllers/ShellController';

/** Pre-paint theme bootstrap for the document head. */
export * from './domain/ThemeInit';

/** Current theme + toggle (Dark / Light / System, chosen in the profile menu). */
export * from './hooks/useTheme';

/** Let a feature add a tab to the Browser / Tools / Drawer regions (slot registry). */
export * from './hooks/useShellTabs';

/** Which tab is selected per region. */
export * from './hooks/useActiveTabs';

/** Local-model status for the top-bar pill (from the ollama feature). */
export * from './hooks/useModelStatus';

/** Drag + keyboard behaviour of a pane separator. */
export * from './hooks/usePaneResizer';

/** Current local project and the switch action. */
export * from './hooks/useProjectSwitcher';

/** Narrow (< 900px) one-pane-at-a-time state. */
export * from './hooks/useNarrowLayout';

/** Roving-focus keyboard handling of the narrow bottom tab bar. */
export * from './hooks/useNarrowTabBar';
/** Opens a pane when a screen first registers tabs into it. */
export * from './hooks/useRevealPanes';

/** Pane sizes and collapse state, remembered per project. */
export * from './hooks/useShellLayout';

/** Current path and the top-bar mode it belongs to. */
export * from './hooks/useShellRoute';

/** Global keyboard shortcuts (Ctrl B, Ctrl Alt B, Ctrl J, F6). */
export * from './hooks/useShellShortcuts';

/** Active tab resolution and tablist keyboard handling. */
export * from './hooks/useTabHost';

/** Registers the shell's own palette commands (go to a screen, mode, theme, panes, validate). */
export * from './hooks/useShellCommands';

/** Route and open-page-in-editor actions the shell offers its slots. */
export * from './hooks/useShellNavigation';

/** Opens the drawer on a given tab. */
export * from './hooks/useDrawerActions';

/** Lets a screen open the drawer's Processes tab (Plan mode does after starting a process). */
export * from './hooks/useShellDrawer';

/** How many branches await review, for the badge beside the fourth screen in the top bar. */
export * from './hooks/useGitBranchCount';

/** Whether the screens rail is collapsed to icons, remembered per person. */
export * from './hooks/useRailCollapsed';

/** Roving-focus keyboard handling of the screens rail. */
export * from './hooks/useRailKeys';

/** The full shell (used by the shell controller only when a project is open). */
export * from './controllers/ShellFrame';
