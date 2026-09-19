// Pure (DOMAIN-001): default pane sizes and their limits.
import type { PaneId, PaneLimit, ShellLayoutState } from '../types.ts';

/** Left = Browser (defaults to the old 200px nav width so existing screens keep
 * their width), right = Tools (closed until asked for), drawer = closed on first run
 * (owner-resolved open question). */
export const PANE_LIMITS: Record<PaneId, PaneLimit> = {
  left: { min: 160, max: 480, default: 200 },
  right: { min: 280, max: 640, default: 360 },
  drawer: { min: 96, max: 480, default: 220 },
};

export const DEFAULT_LAYOUT: ShellLayoutState = {
  left: { size: PANE_LIMITS.left.default, open: true },
  right: { size: PANE_LIMITS.right.default, open: false },
  drawer: { size: PANE_LIMITS.drawer.default, open: false },
};
