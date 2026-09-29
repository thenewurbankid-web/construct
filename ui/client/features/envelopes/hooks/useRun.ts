'use client';

import { useCallback, useReducer } from 'react';
import { runComposedFlow } from '../services/EnvelopesApi';
import { initialRun, runReducer } from '../workflows/Run';
import type { ComposeStep, RunApi } from '../types';

/** "Run this flow" (#395/#772): the same Process/Approvals path Plan mode's "Run plan" uses. `name` (the
 * compose draft's `loadedFrom`, or whatever "Save this flow" was last typed) only labels the process --
 * running never requires having saved first. `onStarted` opens the Processes drawer the instant the process
 * starts, same as Plan mode's `usePlanScreen(drawer.openProcesses)` -- not left to a manual click alone. */
export function useRun(name: string | null, steps: ComposeStep[], onStarted: () => void): RunApi {
  const [state, dispatch] = useReducer(runReducer, initialRun);

  const run = useCallback(() => {
    if (steps.length === 0) return;
    dispatch({ type: 'LOADING' });
    runComposedFlow(name, steps).then((r) => {
      if (r.ok) {
        dispatch({ type: 'STARTED', processId: r.processId, models: r.models });
        onStarted();
      } else {
        dispatch({ type: 'FAILED', error: r.error });
      }
    });
  }, [name, steps, onStarted]);

  return { state, run };
}
