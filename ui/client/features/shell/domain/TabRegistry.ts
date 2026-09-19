// Pure (DOMAIN-001): the tab registry every region (browser / tools / drawer) uses.
// Immutable helpers; re-registering an id replaces that tab in place.
import type { ShellTab } from '../types.ts';

export function addTab(tabs: ShellTab[], tab: ShellTab): ShellTab[] {
  const at = tabs.findIndex((t) => t.id === tab.id);
  if (at === -1) return [...tabs, tab];
  const next = tabs.slice();
  next[at] = tab;
  return next;
}

export function removeTab(tabs: ShellTab[], id: string): ShellTab[] {
  return tabs.some((t) => t.id === id) ? tabs.filter((t) => t.id !== id) : tabs;
}

/** The tab to show: the requested one if it exists and is enabled, else the
 * first enabled tab, else null. */
export function resolveActiveTab(tabs: ShellTab[], activeId: string | null): ShellTab | null {
  const wanted = tabs.find((t) => t.id === activeId && !t.disabled);
  return wanted ?? tabs.find((t) => !t.disabled) ?? null;
}
