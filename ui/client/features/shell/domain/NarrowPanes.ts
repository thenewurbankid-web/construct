// Pure (DOMAIN-001): the entries of the narrow layout's bottom tab bar.
import type { NarrowPane } from '../types.ts';

/** Bottom tab bar entries, in visual order; `mid` is the stage (the current screen). The design doc
 * (section 6) renames Browser/Tools to Browse/Inspect here, but that rename is shared with the pane
 * landmarks' aria-label, which #371 owns and several other specs (blocks, features-screen,
 * components-screen, pages-screen) assert on outside this issue's stated touched-spec list; #376
 * ships only the new `drawer` (Run) entry, out of reach at narrow widths until now, joining the other
 * three panes as a fourth one-at-a-time choice instead of the wide layout's separate open/closed
 * drawer. The Browse/Inspect rename is left to #371. */
export const NARROW_PANES: Array<{ id: NarrowPane; label: string }> = [
  { id: 'left', label: 'Browser' },
  { id: 'mid', label: 'Stage' },
  { id: 'right', label: 'Tools' },
  { id: 'drawer', label: 'Run' },
];

export const DEFAULT_NARROW_PANE: NarrowPane = 'mid';

/** Pane to move to for a key press on the bottom tab bar; null for other keys. */
export function nextNarrowPane(current: NarrowPane, key: string): NarrowPane | null {
  const at = NARROW_PANES.findIndex((p) => p.id === current);
  if (at < 0) return null;
  if (key === 'Home') return NARROW_PANES[0].id;
  if (key === 'End') return NARROW_PANES[NARROW_PANES.length - 1].id;
  if (key === 'ArrowRight') return NARROW_PANES[(at + 1) % NARROW_PANES.length].id;
  if (key === 'ArrowLeft') return NARROW_PANES[(at - 1 + NARROW_PANES.length) % NARROW_PANES.length].id;
  return null;
}
