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
 * first enabled tab a feature marked `preferred`, else the first enabled tab,
 * else null. */
/** What a badge shows. A count over 99 is capped so that a tab's badge -- and
 * therefore the position of every tab after it -- is the same width whether the
 * project has 1 problem or 700 (#252). The real total is in the panel. */
export function badgeText(badge: number | string): string {
  return typeof badge === 'number' && badge > 99 ? '99+' : String(badge);
}

export function resolveActiveTab(tabs: ShellTab[], activeId: string | null): ShellTab | null {
  const wanted = tabs.find((t) => t.id === activeId && !t.disabled);
  return wanted ?? tabs.find((t) => t.preferred && !t.disabled) ?? tabs.find((t) => !t.disabled) ?? null;
}
