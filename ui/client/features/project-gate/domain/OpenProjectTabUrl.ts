// Pure (DOMAIN-001): how the Open-a-project tab sits in the URL (?tab=new), so a person can come back to it later, and
// which tab shows when none is named.
import type { OpenProjectTab } from '../types.ts';
import { OPEN_PROJECT_TABS } from './OpenProjectTabs.ts';

const isTab = (v: string | null): v is OpenProjectTab => OPEN_PROJECT_TABS.some((t) => t.id === v);

/** The tab named in a query string (`?tab=new`), or null when none (or an unknown one) is named. */
export function tabFromSearch(search: string): OpenProjectTab | null {
  const v = new URLSearchParams(search).get('tab');
  return isTab(v) ? v : null;
}

/** The tab on screen: the one chosen (or named in the URL); else "Your projects" when there are projects (or while they
 * load), "New project" when there are none. */
export function shownTab(chosen: OpenProjectTab | null, projectCount: number | null): OpenProjectTab {
  if (chosen) return chosen;
  return projectCount === 0 ? 'new' : 'projects';
}

/** The query string with `tab` set, the rest kept as it was. */
export function searchWithTab(search: string, tab: OpenProjectTab): string {
  const q = new URLSearchParams(search);
  q.set('tab', tab);
  return `?${q.toString()}`;
}

/** The query string once a project opens: the Open-a-project screen's own places (`tab`, and Chat mode's `section`)
 * dropped, the rest kept, so the screen the project opens on does not carry "Your projects" in its address. */
export function searchAfterOpen(search: string): string {
  const q = new URLSearchParams(search);
  q.delete('tab');
  q.delete('section');
  const rest = q.toString();
  return rest ? `?${rest}` : '';
}
