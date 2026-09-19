// Pure (DOMAIN-001): global keyboard shortcuts of the shell. (Ctrl 1/2/3 for
// modes from the design doc is left out: browsers reserve it for their own tabs.)
import type { ShortcutAction, ShortcutInfo } from '../types.ts';

export const SHORTCUTS: ShortcutInfo[] = [
  { keys: 'Ctrl B', action: 'toggle-left', label: 'Show or hide the Browser pane' },
  { keys: 'Ctrl Alt B', action: 'toggle-right', label: 'Show or hide the Tools panel' },
  { keys: 'Ctrl J', action: 'toggle-drawer', label: 'Show or hide the drawer' },
  { keys: 'F6', action: 'cycle-pane', label: 'Move focus to the next pane' },
];

type KeyLike = { key: string; ctrlKey: boolean; altKey: boolean; metaKey: boolean; shiftKey: boolean };

/** Which shell action a key event triggers (Cmd counts as Ctrl on macOS), or null. */
export function shortcutAction(e: KeyLike): ShortcutAction | null {
  const key = e.key.toLowerCase();
  if (e.key === 'F6' && !e.ctrlKey && !e.altKey && !e.metaKey) return 'cycle-pane';
  const mod = e.ctrlKey || e.metaKey;
  if (!mod || e.shiftKey) return null;
  if (key === 'b') return e.altKey ? 'toggle-right' : 'toggle-left';
  if (key === 'j' && !e.altKey) return 'toggle-drawer';
  return null;
}
