'use client';

import { useCallback, useEffect, useRef, useReducer } from 'react';
import { fetchFlows } from '../services/EnvelopesApi';
import { initialEnvelopes, envelopesReducer } from '../workflows/Envelopes';
import type { EnvelopesApi } from '../types';

/** Reads every saved flow for the current project via `/api/envelopes`. Runs once on mount and again on
 * demand; overlapping runs are dropped so a slow one cannot overwrite a newer result. */
export function useEnvelopes(): EnvelopesApi {
  const [state, dispatch] = useReducer(envelopesReducer, initialEnvelopes);
  const inFlight = useRef(false);

  const run = useCallback(() => {
    if (inFlight.current) return;
    inFlight.current = true;
    dispatch({ type: 'RUN' });
    fetchFlows().then((r) => {
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
