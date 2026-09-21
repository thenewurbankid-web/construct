'use client';

import { useCallback, useEffect, useState } from 'react';
import { NARROW_MEDIA_QUERY } from '../domain/NarrowLayout';
import { DEFAULT_NARROW_PANE } from '../domain/NarrowPanes';
import type { NarrowPane } from '../types';

const MIN_REAL_WIDTH = 200;

/** Whether the viewport is narrow (< 900px) and which single pane is showing
 * there. Navigating to another screen returns to the stage, so a link chosen in
 * the Browser pane actually shows its result. Server render and first paint use
 * the wide layout; the media query takes over right after mount. */
export function useNarrowLayout(pathname: string) {
  const [narrow, setNarrow] = useState(false);
  const [pane, setPaneState] = useState<NarrowPane>(DEFAULT_NARROW_PANE);

  useEffect(() => {
    const query = window.matchMedia(NARROW_MEDIA_QUERY);
    // A viewport of a few pixels is a measurement artefact (a full-page screenshot briefly resizes the window to
    // 1x1), not a phone. Flipping to the one-pane layout for that instant would remount the whole stage and lose
    // its state, so keep the layout we had.
    const sync = () => {
      if (window.innerWidth < MIN_REAL_WIDTH) return;
      setNarrow(query.matches);
    };
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    setPaneState(DEFAULT_NARROW_PANE);
  }, [pathname]);

  const setPane = useCallback((next: NarrowPane) => setPaneState(next), []);
  return { narrow, pane, setPane };
}
