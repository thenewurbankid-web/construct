'use client';

import { useEffect } from 'react';
import { screenIndexFromKey, shortcutAction } from '../domain/Shortcuts';
import type { PaneId, PrimaryScreen } from '../types';

/** Focuses the next (or, going back, previous) pane landmark (`[data-pane]`), wrapping. DOM order
 * already matches the visual/focus order (design section 6): top bar, left, stage, right, bottom
 * -- the bottom (drawer) landmark only exists in the DOM while it is open, so it drops out of the
 * cycle by itself. */
function focusPane(back: boolean) {
  const panes = Array.from(document.querySelectorAll<HTMLElement>('[data-pane]'));
  if (panes.length === 0) return;
  const at = panes.findIndex((p) => p.contains(document.activeElement));
  const step = back ? -1 : 1;
  const next = panes[(at + step + panes.length) % panes.length];
  next.focus();
}

/** Global shortcuts (Ctrl B, Ctrl Alt B, Ctrl J, F6 / Shift F6, Alt 1-5). */
export function useShellShortcuts(toggle: (pane: PaneId) => void, navigate: (href: string) => void, screens: PrimaryScreen[]) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const action = shortcutAction(e);
      if (!action) return;
      if (action === 'go-to-screen') {
        const index = screenIndexFromKey(e.key);
        const screen = index === null ? null : screens[index];
        if (!screen) return;
        e.preventDefault();
        navigate(screen.href);
        return;
      }
      e.preventDefault();
      if (action === 'toggle-left') toggle('left');
      else if (action === 'toggle-right') toggle('right');
      else if (action === 'toggle-drawer') toggle('drawer');
      else focusPane(action === 'cycle-pane-back');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle, navigate, screens]);
}
