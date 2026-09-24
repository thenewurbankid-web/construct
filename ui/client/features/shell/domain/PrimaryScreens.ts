// Pure (DOMAIN-001): the five primary screens of the top bar, Features / Pages / Components / Git / Tests
// (owner decision 2026-09-20, docs/design/ia-five-screens.md). They replace the Explore / Plan / Build /
// Review modes: screens are the nouns you work on, and the old verbs live on as tabs and actions inside a
// screen (Explore is the default state of every screen, Plan a Features tab, Build the Run plan button and
// the bottom panel, Review a verb inside Git). Routes did not move: `activeOn` says which existing path
// belongs to which screen (Components owns /components and the workflow viewer at /workflows), so every route is covered and Settings / Local model / Help (reached from the
// profile menu) belong to none.
import type { PrimaryScreen } from '../types.ts';

export const PRIMARY_SCREENS: PrimaryScreen[] = [
  { id: 'features', label: 'Features', href: '/', activeOn: ['/', '/plan', '/dashboard', '/wizard', '/notes'] },
  { id: 'pages', label: 'Pages', href: '/pages', activeOn: ['/pages'] },
  { id: 'components', label: 'Components', href: '/components', activeOn: ['/components', '/workflows'] },
  { id: 'git', label: 'Git', href: '/review', activeOn: ['/review'] },
  { id: 'tests', label: 'Tests', href: '/tests', activeOn: ['/tests'] },
];

/** The primary screen whose routes include `pathname`, or null (Settings, Help, Local model...). */
export function primaryScreenForPath(pathname: string, screens: PrimaryScreen[] = PRIMARY_SCREENS): PrimaryScreen | null {
  return screens.find((s) => s.activeOn.includes(pathname)) ?? null;
}
