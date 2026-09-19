// Pure (DOMAIN-001): persisted-layout validation and the per-project storage key.
import type { PaneId, ShellLayoutState } from '../types.ts';
import { DEFAULT_LAYOUT, PANE_LIMITS } from './LayoutDefaults.ts';
import { clampSize } from './PaneSizing.ts';

const PANES: PaneId[] = ['left', 'right', 'drawer'];

/** Storage key for one project's layout (`null` = project not known yet). */
export function layoutStorageKey(projectDir: string | null): string {
  return `construct.shell.layout:${projectDir ?? '(default)'}`;
}

/** Turns whatever was in storage into a valid layout: unknown/garbage input
 * falls back to defaults per pane, sizes are clamped, extra keys dropped. */
export function sanitizeLayout(raw: unknown): ShellLayoutState {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out = {} as ShellLayoutState;
  for (const pane of PANES) {
    const p = src[pane] && typeof src[pane] === 'object' ? (src[pane] as Record<string, unknown>) : {};
    const { min, max } = PANE_LIMITS[pane];
    out[pane] = {
      size: typeof p.size === 'number' ? clampSize(p.size, min, max) : DEFAULT_LAYOUT[pane].size,
      open: typeof p.open === 'boolean' ? p.open : DEFAULT_LAYOUT[pane].open,
    };
  }
  return out;
}
