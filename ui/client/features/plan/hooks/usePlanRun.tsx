'use client';

import { useCallback, type Dispatch } from 'react';
import { runPlanOnServer } from '../services/PlanCheckApi';
import type { PlanDoc, ScreenAction } from '../domain/PlanTypes';

/** What Run needs of the durable note (#609): save it first and name it, then take the server's "ran" copy. */
export type RunNote = { flush: () => Promise<string | null>; resync: (id: string) => Promise<void> };

/** Run plan: the server re-validates the plan itself and only then creates and starts the process, and marks the note ran. */
export function usePlanRun(plan: PlanDoc, dispatch: Dispatch<ScreenAction>, onStarted: () => void, note: RunNote) {
  return useCallback(async () => {
    dispatch({ type: 'RUN_LOADING' });
    // The note is saved before it runs, so the note that ran holds exactly the text and plan that ran. A note that
    // cannot be saved is a reason not to run: a run with no history is the gap this closes.
    const noteId = await note.flush();
    if (noteId === null) return dispatch({ type: 'RUN_FAILED', error: 'Your note could not be saved, so the plan was not run. Fix the save above, then run it again.', errors: [] });
    const r = await runPlanOnServer(plan, noteId);
    if (!r.ok) return dispatch({ type: 'RUN_FAILED', error: r.error, errors: r.errors ?? [] });
    dispatch({ type: 'RUN_STARTED', processId: r.data.processId, models: r.data.models });
    await note.resync(noteId);
    return onStarted();
  }, [plan, dispatch, onStarted, note]);
}
