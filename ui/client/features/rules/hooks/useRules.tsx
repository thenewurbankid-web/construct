'use client';

import { useCallback, useEffect, useRef, useReducer } from 'react';
import { fetchRules } from '../services/RulesApi';
import { initialRules, rulesReducer } from '../workflows/Rules';
import type { RulesApi } from '../types';

/** Reads every rule for the current project (severity, plain-words "why", live violation count) via `/api/validate`.
 * Runs once on mount and again on demand; overlapping runs are dropped so a slow one cannot overwrite a newer result. */
export function useRules(): RulesApi {
  const [state, dispatch] = useReducer(rulesReducer, initialRules);
  const inFlight = useRef(false);

  const run = useCallback(() => {
    if (inFlight.current) return;
    inFlight.current = true;
    dispatch({ type: 'RUN' });
    fetchRules().then((r) => {
      inFlight.current = false;
      if (r.ok) dispatch({ type: 'RESULT', rows: r.rows });
      else dispatch({ type: 'FAIL', error: r.error });
    });
  }, []);

  useEffect(() => {
    run();
  }, [run]);

  return { state, run };
}
