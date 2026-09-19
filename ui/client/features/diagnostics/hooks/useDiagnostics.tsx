'use client';

import { useCallback, useEffect, useReducer, useRef } from 'react';
import { fetchValidation } from '../services/DiagnosticsApi';
import { diagnosticsReducer, initialDiagnostics } from '../workflows/Diagnostics';
import type { DiagnosticsApi } from '../types';

/** Runs `construct validate` for the current project. `enabled` starts the
 * first run automatically (once the project is known); `run` re-runs on demand.
 * Overlapping runs are dropped so a slow one cannot overwrite a newer result. */
export function useDiagnostics(enabled: boolean): DiagnosticsApi {
  const [state, dispatch] = useReducer(diagnosticsReducer, initialDiagnostics);
  const inFlight = useRef(false);

  const run = useCallback(() => {
    if (inFlight.current) return;
    inFlight.current = true;
    dispatch({ type: 'RUN' });
    fetchValidation().then((r) => {
      inFlight.current = false;
      if (r.ok) dispatch({ type: 'RESULT', violations: r.violations, total: r.total, truncated: r.truncated, durationMs: r.durationMs });
      else dispatch({ type: 'FAIL', error: r.error });
    });
  }, []);

  useEffect(() => {
    if (enabled) run();
  }, [enabled, run]);

  return { state, run };
}
