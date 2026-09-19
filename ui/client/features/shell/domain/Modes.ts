// Pure (DOMAIN-001): the top-bar modes (names kept per owner decision:
// Explore / Research / Build). Each routes to an existing screen for now;
// Research/Build screens arrive with the research-mode and Processes epics.
import type { ShellMode } from '../types.ts';

export const MODES: ShellMode[] = [
  { id: 'explore', label: 'Explore', href: '/pages', activeOn: ['/pages', '/workflows'] },
  { id: 'research', label: 'Research', href: '/dashboard', activeOn: ['/', '/dashboard'] },
  { id: 'build', label: 'Build', href: '/wizard', activeOn: ['/wizard'] },
];

/** The mode whose screens include `pathname`, or null (Settings, Help, Local model...). */
export function modeForPath(pathname: string, modes: ShellMode[] = MODES): ShellMode | null {
  return modes.find((m) => m.activeOn.includes(pathname)) ?? null;
}
