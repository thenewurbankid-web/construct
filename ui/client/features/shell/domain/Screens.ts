// Pure (DOMAIN-001): the screens the palette lists as "Go to ..." besides the five in the top bar (PrimaryScreens.ts):
// the Import Wizard, and Settings / Local Model / Help, which the profile menu also opens. The Browser pane's
// "Screens" tab and the Dashboard entry are retired (#370); `/dashboard` still answers for old links.
import type { ShellScreen } from '../types.ts';

export const SCREENS: ShellScreen[] = [
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
