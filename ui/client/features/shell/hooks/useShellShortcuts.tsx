'use client';

import { useEffect } from 'react';
import { shortcutAction } from '../domain/Shortcuts';
import type { PaneId } from '../types';

/** Focuses the next pane landmark (`[data-pane]`), wrapping. */
function focusNextPane() {
  const panes = Array.from(document.querySelectorAll<HTMLElement>('[data-pane]'));
  if (panes.length === 0) return;
  const at = panes.findIndex((p) => p.contains(document.activeElement));
  const next = panes[(at + 1) % panes.length];
  next.focus();
}

/** Global shortcuts (Ctrl B, Ctrl Alt B, Ctrl J, F6). */
export function useShellShortcuts(toggle: (pane: PaneId) => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const action = shortcutAction(e);
      if (!action) return;
      e.preventDefault();
      if (action === 'toggle-left') toggle('left');
      else if (action === 'toggle-right') toggle('right');
      else if (action === 'toggle-drawer') toggle('drawer');
      else focusNextPane();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);
}
