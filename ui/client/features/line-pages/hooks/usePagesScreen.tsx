'use client';

import { useLinePages } from './useLinePages';
import { useLineProject } from './useLineProject';

/** /pages: which screen to show ("loading", "line" or "not-line") and, for a Line project, its view. */
export function usePagesScreen() {
  const { state, reload } = useLineProject();
  const line = state.phase === 'line' ? state : null;
  const view = useLinePages(line?.project ?? null, line?.api ?? null, reload);
  return { phase: state.phase === 'line' && !view.ready ? ('loading' as const) : state.phase, view };
}
