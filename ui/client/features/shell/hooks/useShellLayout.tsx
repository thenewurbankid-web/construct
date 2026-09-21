'use client';

import { useCallback, useEffect, useReducer, useRef } from 'react';
import { initialShellLayout, shellLayoutReducer } from '../workflows/ShellLayout';
import { loadLayout, saveLayout } from '../services/LayoutStorage';
import type { PaneId } from '../types';

/** Pane sizes/collapse state, remembered per project (guarded localStorage).
 * Until the project is known the defaults are shown and nothing is saved; once
 * `projectDir` resolves, that project's saved layout is loaded. */
export function useShellLayout(projectDir: string | null, projectKnown: boolean) {
  const [layout, dispatch] = useReducer(shellLayoutReducer, initialShellLayout);
  const loadedFor = useRef<string | null | undefined>(undefined);
  // The render that dispatches LOAD still holds the defaults; saving them would overwrite the stored layout
  // (the shell now mounts with the project already known), so the save right after a load is skipped.
  const justLoaded = useRef(false);

  useEffect(() => {
    if (!projectKnown) return;
    dispatch({ type: 'LOAD', layout: loadLayout(projectDir) });
    loadedFor.current = projectDir;
    justLoaded.current = true;
  }, [projectDir, projectKnown]);

  useEffect(() => {
    if (!projectKnown || loadedFor.current !== projectDir) return;
    if (justLoaded.current) {
      justLoaded.current = false;
      return;
    }
    saveLayout(projectDir, layout);
  }, [layout, projectDir, projectKnown]);

  const resize = useCallback((pane: PaneId, size: number) => dispatch({ type: 'RESIZE', pane, size }), []);
  const toggle = useCallback((pane: PaneId, open?: boolean) => dispatch({ type: 'TOGGLE', pane, open }), []);
  return { layout, resize, toggle };
}
