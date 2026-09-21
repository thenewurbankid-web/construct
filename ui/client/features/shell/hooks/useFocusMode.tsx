'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ShellFocusApi } from './useShellFocus';

/** Owns focus mode for the shell (see useShellFocus for what it is).
 *
 * Deliberately CSS/state-driven rather than the browser Fullscreen API: what has
 * to disappear is the Cockpit's own chrome, which only React and CSS can hide,
 * and Esc, focus return and the reduced-motion rule then behave identically in
 * every browser and in headless runs — where requestFullscreen needs a user
 * gesture and can be refused by permissions policy. */
export function useFocusMode(): ShellFocusApi & { label: string | null } {
  const [label, setLabel] = useState<string | null>(null);
  const focused = label !== null;

  const enter = useCallback((next?: string) => setLabel(next ?? 'Full screen'), []);
  const exit = useCallback(() => setLabel(null), []);

  // Esc leaves, from anywhere — including from inside the framed app's own
  // controls, which is why the listener sits on the document in capture phase.
  useEffect(() => {
    if (!focused) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      setLabel(null);
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [focused]);

  return useMemo(() => ({ focused, label, enter, exit }), [focused, label, enter, exit]);
}
