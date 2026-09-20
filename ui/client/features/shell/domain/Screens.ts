// Pure (DOMAIN-001): every existing screen, listed in the Browser pane's
// "Screens" tab (the old sidebar nav, same labels so links stay reachable).
import type { ShellScreen } from '../types.ts';

export const SCREENS: ShellScreen[] = [
  { href: '/dashboard', label: 'Dashboard', activeOn: ['/', '/dashboard'] },
  { href: '/wizard', label: 'Import Wizard', activeOn: ['/wizard'] },
  { href: '/pages', label: 'Pages Editor', activeOn: ['/pages'] },
  { href: '/workflows', label: 'Workflows', activeOn: ['/workflows'] },
  { href: '/tests', label: 'Tests', activeOn: ['/tests'] },
  { href: '/ollama', label: 'Local Model', activeOn: ['/ollama'] },
  { href: '/settings', label: 'Settings', activeOn: ['/settings'] },
  { href: '/help', label: 'Help', activeOn: ['/help'] },
];

export function isScreenActive(screen: ShellScreen, pathname: string): boolean {
  return screen.activeOn.includes(pathname);
}
