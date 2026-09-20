'use client';

import { useCallback, useEffect, useReducer, type Dispatch } from 'react';
import { describeError } from '@/features/states';
import { fetchProjectStatus, initProject, openProject } from '../services/ProjectGate';
import { initialProjectGateState, projectGateReducer, type ProjectGateAction } from '../workflows/ProjectGate';

/** #365: open a folder from the workspace. On success the page reloads, so every screen (and the top-bar
 * switcher and per-project layout memory) re-reads the new project, exactly as the top-bar switcher does. */
async function openFolder(dispatch: Dispatch<ProjectGateAction>, dir: string) {
  dispatch({ type: 'OPEN_START' });
  const result = await openProject(dir);
  if (result.ok) window.location.reload();
  else dispatch({ type: 'OPEN_ERROR', error: result.error });
}

/** Fetches project status once on mount and exposes the init-here and open-a-project actions —
 * every gated route (Dashboard, Wizard, Pages Editor) mounts its own
 * ProjectGateController, so each fetches independently rather than sharing
 * one app-wide store; simpler than a cross-route context provider, and
 * functionally equivalent since each gated screen only ever needs its own
 * up-to-date status. */
export function useProjectGate() {
  const [state, dispatch] = useReducer(projectGateReducer, initialProjectGateState);

  const refresh = useCallback(() => {
    dispatch({ type: 'STATUS_RETRY' });
    fetchProjectStatus()
      .then((status) => dispatch({ type: 'STATUS_LOADED', status }))
      .catch((e) => dispatch({ type: 'STATUS_FAILED', message: describeError(e, 'the project status').hint }));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleInit = useCallback(async () => {
    dispatch({ type: 'INIT_START' });
    const result = await initProject();
    if (result.error) {
      dispatch({ type: 'INIT_ERROR', error: result.error });
    } else {
      dispatch({ type: 'INIT_SUCCESS', status: result });
    }
  }, []);

  const handleOpen = useCallback((dir: string) => openFolder(dispatch, dir), []);

  return { ...state, refresh, handleInit, handleOpen };
}
