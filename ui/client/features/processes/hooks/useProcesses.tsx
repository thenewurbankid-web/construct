'use client';

import { useCallback, useEffect, useReducer } from 'react';
import { fetchProcess } from '../services/ProcessesApi';
import { fetchDiff, sendControl } from '../services/ProcessActionsApi';
import { initialProcesses, processesReducer, summariesOf } from '../workflows/Processes';
import { runningCount } from '../domain/ProcessCounts';
import { useProcessesLive } from './useProcessesLive';
import type { ControlVerb } from '../types';

/**
 * Every process for the current project, kept live by the read-only socket.
 * Lives above the drawer (in the shell) so the top-bar count is real while the
 * drawer is closed, and a running process is simply there again after a reload
 * because the server, not this hook, remembers it.
 */
export function useProcesses(projectDir: string | null) {
  const [state, dispatch] = useReducer(processesReducer, initialProcesses);
  const reload = useProcessesLive(projectDir, dispatch);

  // A list row arrives without steps or log; fetch the detail of whichever is selected.
  const selected = state.selectedId ? state.details[state.selectedId] : null;
  const needsDetail = !!selected && selected.steps.length === 0 && selected.summary.progress.total > 0;
  useEffect(() => {
    if (!state.selectedId || !needsDetail) return;
    fetchProcess(state.selectedId).then((detail) => detail && dispatch({ type: 'UPDATE', detail }));
  }, [state.selectedId, needsDetail]);

  const select = useCallback((id: string) => dispatch({ type: 'SELECT', id }), []);

  const control = useCallback(async (id: string, verb: ControlVerb) => {
    dispatch({ type: 'CONTROL_START', id });
    const result = await sendControl(id, verb);
    if (result.ok) dispatch({ type: 'UPDATE', detail: result.detail });
    dispatch({ type: 'CONTROL_DONE', notice: result.ok ? null : result.error });
    if (!result.ok) reload(); // the machine's answer differs from what we showed: re-sync
  }, [reload]);

  const loadDiff = useCallback(async (id: string, path: string) => {
    const key = `${id}\n${path}`;
    dispatch({ type: 'DIFF', key, result: { status: 'loading' } });
    const { diff, reason } = await fetchDiff(id, path);
    dispatch({ type: 'DIFF', key, result: { status: 'ready', diff, reason } });
  }, []);

  return { state, select, control, loadDiff, running: runningCount(summariesOf(state)) };
}
