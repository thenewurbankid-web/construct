'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useShellFocus } from '@/features/shell';

/** Showing the previewed app full screen: the shell's focus mode plus the two
 * things a keyboard user needs from it — a shortcut in (Ctrl+Alt+F) and focus
 * handed back to the trigger on the way out.
 *
 * The iframe is never moved or remounted; only the chrome around it changes, so
 * the app keeps its own state and the selected node survives the round trip. */
export function useFullScreenPreview(available: boolean) {
  const { focused, enter, exit } = useShellFocus();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const wasFocused = useRef(false);

  // Leaving (Esc, the exit button, or the screen going away) returns focus to the
  // control that was pressed, which is only back in the DOM after this render.
  useEffect(() => {
    if (wasFocused.current && !focused) triggerRef.current?.focus();
    wasFocused.current = focused;
  }, [focused]);

  const open = useCallback(() => enter('Live app preview'), [enter]);

  useEffect(() => {
    if (!available) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || !e.altKey || e.metaKey || e.key.toLowerCase() !== 'f') return;
      e.preventDefault();
      enter('Live app preview');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [available, enter]);

  // Never leave the Cockpit hidden behind a screen that is no longer mounted.
  useEffect(() => () => exit(), [exit]);

  return useMemo(() => ({ fullScreen: focused, open, exit, triggerRef }), [focused, open, exit]);
}
