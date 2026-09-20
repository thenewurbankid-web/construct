'use client';

import { useCallback, useEffect, useReducer } from 'react';
import { fetchChange, requestAnalysis } from '../services/ReviewApi';
import { changeReducer, initialChange } from '../workflows/ChangeMachine';
import type { ChangeViewState } from '../types';

const POLL_MS = 700;

/** One change (base -> head): asks for its analysis if nobody has, then reads it until it is done. */
export function useReviewChange(base: string, head: string) {
  const [state, dispatch] = useReducer(changeReducer, initialChange);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    dispatch({ type: 'RESET' });
    async function read(first: boolean) {
      let r = await fetchChange(base, head);
      if (cancelled) return;
      if (!r.ok) return dispatch({ type: 'FAILED', error: r.error });
      if (first && (r.data.state === 'none' || r.data.state === 'error')) {
        await requestAnalysis(base, [head]);
        if (cancelled) return;
        r = await fetchChange(base, head);
        if (cancelled) return;
        if (!r.ok) return dispatch({ type: 'FAILED', error: r.error });
      }
      dispatch({ type: 'RESPONSE', data: r.data });
      if (r.data.state === 'none' || r.data.state === 'queued' || r.data.state === 'running') timer = setTimeout(() => read(false), POLL_MS);
    }
    read(true);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [base, head]);

  const select = useCallback((path: string | null) => dispatch({ type: 'SELECT', path }), []);
  const setGrouping = useCallback((grouping: ChangeViewState['grouping']) => dispatch({ type: 'GROUPING', grouping }), []);
  return { state, select, setGrouping };
}
