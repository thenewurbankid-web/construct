'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { fetchChange } from '../services/ReviewApi';
import { requestAnalysis } from '../services/AnalysisApi';
import { useAnalysisCancel } from './useAnalysisCancel';
import { isLive, shouldStart } from '../domain/AnalysisStart';
import { changeReducer, initialChange } from '../workflows/ChangeMachine';
import type { ChangeViewState } from '../types';

const POLL_MS = 700;

/** One change (base -> head): asks for its analysis if nobody has, then reads it until it is done. */
export function useReviewChange(base: string, head: string, plan: string | null) {
  const [state, dispatch] = useReducer(changeReducer, initialChange);
  const [tick, setTick] = useState(0);
  const forced = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    dispatch({ type: 'RESET' });
    async function read(first: boolean) {
      let r = await fetchChange(base, head, plan);
      if (cancelled) return;
      if (!r.ok) return dispatch({ type: 'FAILED', error: r.error, code: r.code });
      const restart = forced.current;
      forced.current = false;
      if (first && shouldStart(r.data.state, restart)) {
        await requestAnalysis(base, [head], plan);
        if (cancelled) return;
        r = await fetchChange(base, head, plan);
        if (cancelled) return;
        if (!r.ok) return dispatch({ type: 'FAILED', error: r.error, code: r.code });
      }
      dispatch({ type: 'RESPONSE', data: r.data });
      if (isLive(r.data.state)) timer = setTimeout(() => read(false), POLL_MS);
    }
    read(true);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [base, head, plan, tick]);

  const select = useCallback((path: string | null) => dispatch({ type: 'SELECT', path }), []);
  const selectFinding = useCallback((id: string | null) => dispatch({ type: 'SELECT_FINDING', id }), []);
  const setGrouping = useCallback((grouping: ChangeViewState['grouping']) => dispatch({ type: 'GROUPING', grouping }), []);
  const reload = useCallback(() => { forced.current = true; setTick((t) => t + 1); }, []);
  const cancel = useAnalysisCancel(base, head, plan, () => setTick((t) => t + 1));
  return { state, select, selectFinding, setGrouping, reload, cancel };
}
