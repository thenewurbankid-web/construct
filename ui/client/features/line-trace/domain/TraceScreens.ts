// Pure (DOMAIN-001): the Line screens a control can sit on, and where each one is.
import type { LineScreen, TraceScreen } from '../types.ts';

export const SCREENS: Record<LineScreen, { title: string; href: string }> = {
  components: { title: 'Components', href: '/components' },
  pages: { title: 'Pages', href: '/pages' },
  features: { title: 'Features', href: '/' },
  plan: { title: 'the Plan panel on Components', href: '/components' },
  'open-project': { title: 'Your projects', href: '/' },
  shell: { title: 'the Cockpit frame', href: '/' },
};

/** Whether a control of `screen` is on the screen the person is looking at (the Plan panel is on Components and Pages; the shell is on every screen). */
export function isOnScreen(controlScreen: LineScreen, here: TraceScreen): boolean {
  return controlScreen === here || controlScreen === 'shell' || (controlScreen === 'plan' && here !== 'features' && here !== 'open-project');
}

/** The screen a control id belongs to ("<screen>.<name>"). */
export function screenOfControl(controlId: string): LineScreen {
  const s = controlId.split('.')[0];
  return (s in SCREENS ? s : 'components') as LineScreen;
}
