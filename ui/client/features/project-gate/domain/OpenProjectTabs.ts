// Pure (DOMAIN-001): the Open-a-project screen's tabs, one per workflow, and moving between them with the keyboard.

import type { OpenProjectTab } from '../types.ts';

export const OPEN_PROJECT_TABS: ReadonlyArray<{ id: OpenProjectTab; label: string; control: string }> = [
  { id: 'projects', label: 'Your projects', control: 'open-project.tabProjects' },
  { id: 'new', label: 'New project', control: 'open-project.tabNew' },
  { id: 'github', label: 'From GitHub', control: 'open-project.tabGithub' },
];

/** The tab a key press moves to (Left/Right wrap, Home/End), or null for any other key. */
export function tabForKey(current: OpenProjectTab, key: string): OpenProjectTab | null {
  const i = OPEN_PROJECT_TABS.findIndex((t) => t.id === current);
  const n = OPEN_PROJECT_TABS.length;
  const to: Record<string, number> = { ArrowRight: (i + 1) % n, ArrowLeft: (i - 1 + n) % n, Home: 0, End: n - 1 };
  return key in to ? OPEN_PROJECT_TABS[to[key]].id : null;
}
