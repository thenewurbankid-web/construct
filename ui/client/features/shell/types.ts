import type { ReactNode } from 'react';

export type ShellId = string;

/** The two supported colour themes. Dark is the default (owner decision). */
export type Theme = 'dark' | 'light';

export type ThemeToggleProps = {
  theme: Theme;
  onToggle: () => void;
};

// ---- Panes and layout (Design #245, docs/design/cockpit-layout.md) --------

/** The resizable regions of the frame: Browser (left), Tools (right), Drawer (bottom). */
export type PaneId = 'left' | 'right' | 'drawer';

/** `size` is px width (left/right) or px height (drawer); `open` is not-collapsed. */
export type PaneState = { size: number; open: boolean };

export type ShellLayoutState = Record<PaneId, PaneState>;

export type PaneLimit = { min: number; max: number; default: number };

export type ShellLayoutAction =
  | { type: 'LOAD'; layout: ShellLayoutState }
  | { type: 'RESIZE'; pane: PaneId; size: number }
  | { type: 'TOGGLE'; pane: PaneId; open?: boolean };

// ---- Slots / tab registry ------------------------------------------------

/** Where a tab lives: the Browser (left), the Tools panel (right) or the bottom drawer. */
export type ShellRegion = 'browser' | 'tools' | 'drawer';

/** The small interface every pane/tab implements (principles.md #10): a
 * feature registers one of these and never reaches into another feature's panel. */
export type ShellTab = {
  id: string;
  title: string;
  badge?: number | string;
  disabled?: boolean;
  render: () => ReactNode;
};

export type TabHostProps = {
  /** Accessible name of the tab list (also used for the panel group). */
  label: string;
  tabs: ShellTab[];
  activeId: string | null;
  onSelect: (id: string) => void;
  /** Shown when the region has no enabled tab. */
  empty?: ReactNode;
};

// ---- Navigation ----------------------------------------------------------

/** A mode changes what the panes hold; today each routes to an existing screen. */
export type ShellMode = { id: string; label: string; href: string; activeOn: string[] };

export type ShellScreen = { href: string; label: string; activeOn: string[] };

export type ModelStatus = 'checking' | 'ready' | 'offline';

export type ShortcutAction = 'toggle-left' | 'toggle-right' | 'toggle-drawer' | 'cycle-pane';

export type ShortcutInfo = { keys: string; action: ShortcutAction; label: string };

// ---- Component props -----------------------------------------------------

export type ShellLayoutProps = {
  layout: ShellLayoutState;
  limits: Record<PaneId, PaneLimit>;
  onResize: (pane: PaneId, size: number) => void;
  onTogglePane: (pane: PaneId) => void;
  top: ReactNode;
  left: ReactNode;
  mid: ReactNode;
  right: ReactNode;
  drawer: ReactNode;
  status: ReactNode;
};

export type PaneResizerProps = {
  /** 'vertical' separates side-by-side panes (drag left/right); 'horizontal' separates the drawer. */
  orientation: 'vertical' | 'horizontal';
  label: string;
  value: number;
  min: number;
  max: number;
  /** True when growing the pane means moving the pointer toward the start (right pane, drawer). */
  invert?: boolean;
  onResize: (size: number) => void;
  onToggle: () => void;
  controls?: string;
};

export type ProjectSwitcherProps = {
  label: string;
  dir: string | null;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  /** Folder picker supplied by the controller (another feature). */
  picker: ReactNode;
  error?: string | null;
};

export type TopBarProps = {
  modes: ShellMode[];
  activeModeId: string | null;
  projectSwitcher: ReactNode;
  themeToggle: ReactNode;
  modelStatus: ModelStatus;
  runningProcesses: number;
  layout: ShellLayoutState;
  onTogglePane: (pane: PaneId) => void;
  onOpenProcesses: () => void;
};

export type StatusBarProps = {
  layout: ShellLayoutState;
  onTogglePane: (pane: PaneId) => void;
  shortcuts: ShortcutInfo[];
};

export type ScreensNavProps = { screens: ShellScreen[]; pathname: string };

export type ProjectInfoPanelProps = {
  dir: string | null;
  modeLabel: string | null;
  modelStatus: ModelStatus;
  shortcuts: ShortcutInfo[];
};

export type ShellPageProps = {
  children: ReactNode;
  layout: ShellLayoutState;
  limits: Record<PaneId, PaneLimit>;
  onResize: (pane: PaneId, size: number) => void;
  onTogglePane: (pane: PaneId) => void;
  modes: ShellMode[];
  activeModeId: string | null;
  projectSwitcher: ReactNode;
  themeToggle: ReactNode;
  modelStatus: ModelStatus;
  runningProcesses: number;
  onOpenProcesses: () => void;
  shortcuts: ShortcutInfo[];
  tabs: Record<ShellRegion, ShellTab[]>;
  activeTabs: Record<ShellRegion, string | null>;
  onSelectTab: (region: ShellRegion, id: string) => void;
};
