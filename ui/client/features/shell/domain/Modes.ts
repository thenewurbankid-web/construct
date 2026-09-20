// Pure (DOMAIN-001): the top-bar modes, Explore / Plan / Build / Review (owner decision, #285). Each
// routes to a screen. "Plan" is only the label on the button (the rename of Research, #243): the route it
// leads to, the `construct research` CLI verb and `[Research]` ticket titles are all unchanged. The
// mode's design lives in docs/design/cockpit-layout.md section 4 (`plan-mode`); Review (#312) is a
// fourth mode that fills all three panes (docs/design/mocks/pr-review-*.html).
import type { ShellMode } from '../types.ts';

export const MODES: ShellMode[] = [
  { id: 'explore', label: 'Explore', href: '/pages', activeOn: ['/pages', '/workflows', '/tests'] },
  { id: 'plan', label: 'Plan', href: '/dashboard', activeOn: ['/', '/dashboard'] },
  { id: 'build', label: 'Build', href: '/wizard', activeOn: ['/wizard'] },
  { id: 'review', label: 'Review', href: '/review', activeOn: ['/review'] },
];

/** The mode whose screens include `pathname`, or null (Settings, Help, Local model...). */
export function modeForPath(pathname: string, modes: ShellMode[] = MODES): ShellMode | null {
  return modes.find((m) => m.activeOn.includes(pathname)) ?? null;
}
