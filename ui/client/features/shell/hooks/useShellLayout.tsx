'use client';

import { useCallback, useEffect, useReducer, useState } from 'react';
import { initialShellLayout, shellLayoutReducer } from '../workflows/ShellLayout';
import { loadLayout, saveLayout } from '../services/LayoutStorage';
import type { PaneId } from '../types';

/** Pane sizes/collapse state, remembered per project (guarded localStorage).
 * Until the project is known the defaults are shown and nothing is saved; once
 * `projectDir` resolves, that project's saved layout is loaded. */
export function useShellLayout(projectDir: string | null, projectKnown: boolean) {
  const [layout, dispatch] = useReducer(shellLayoutReducer, initialShellLayout);
  // State, not a ref: the save below must not see "loaded" until the render that carries the loaded layout,
  // or a shell that mounts with the project already known would save its defaults over the stored layout.
  const [loadedFor, setLoadedFor] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (!projectKnown) return;
    dispatch({ type: 'LOAD', layout: loadLayout(projectDir) });
    setLoadedFor(projectDir);
  }, [projectDir, projectKnown]);

  useEffect(() => {
    if (!projectKnown || loadedFor !== projectDir) return;
    saveLayout(projectDir, layout);
  }, [layout, loadedFor, projectDir, projectKnown]);

  const resize = useCallback((pane: PaneId, size: number) => dispatch({ type: 'RESIZE', pane, size }), []);
  const toggle = useCallback((pane: PaneId, open?: boolean) => dispatch({ type: 'TOGGLE', pane, open }), []);
  return { layout, resize, toggle };
}
