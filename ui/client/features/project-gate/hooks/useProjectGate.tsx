'use client';

import { useCallback, useEffect, useReducer } from 'react';
import { describeError } from '@/features/states';
import { fetchProjectStatus, initProject } from '../services/ProjectGate';
import { initialProjectGateState, projectGateReducer } from '../workflows/ProjectGate';

/** Fetches project status once on mount and exposes the init-here action —
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

  return { status: state.status, initializing: state.initializing, error: state.error, loadError: state.loadError, refresh, handleInit };
}
