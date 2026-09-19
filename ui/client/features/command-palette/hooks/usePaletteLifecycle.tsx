'use client';

import { useEffect, useRef, type Dispatch } from 'react';
import { rememberFocus, subscribePaletteShortcut } from '../services/PaletteBrowser';
import type { PaletteAction } from '../workflows/PaletteState';

/** Ctrl/Cmd+K toggles the palette; each time it opens the search starts fresh
 * and focus is remembered, then restored when it closes. */
export function usePaletteLifecycle(open: boolean, setOpen: (open: boolean) => void, dispatch: Dispatch<PaletteAction>): void {
  const restoreFocus = useRef<(() => void) | null>(null);

  useEffect(() => subscribePaletteShortcut(() => setOpen(!open)), [open, setOpen]);

  useEffect(() => {
    if (open) {
      restoreFocus.current = rememberFocus();
      dispatch({ type: 'RESET' });
    } else {
      restoreFocus.current?.();
      restoreFocus.current = null;
    }
  }, [open, dispatch]);
}
