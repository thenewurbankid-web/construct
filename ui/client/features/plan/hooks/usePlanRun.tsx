'use client';

import { useCallback, type Dispatch } from 'react';
import { runPlanOnServer } from '../services/PlanCheckApi';
import type { PlanDoc, ScreenAction } from '../domain/PlanTypes';

/** Run plan: the server re-validates the plan itself and only then creates and starts the process. */
export function usePlanRun(plan: PlanDoc, dispatch: Dispatch<ScreenAction>, onStarted: () => void) {
  return useCallback(async () => {
    dispatch({ type: 'RUN_LOADING' });
    const r = await runPlanOnServer(plan);
    if (!r.ok) return dispatch({ type: 'RUN_FAILED', error: r.error, errors: r.errors ?? [] });
    dispatch({ type: 'RUN_STARTED', processId: r.data.processId, models: r.data.models });
    return onStarted();
  }, [plan, dispatch, onStarted]);
}
