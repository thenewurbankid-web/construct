'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { fetchBranches } from '../services/ReviewApi';
import { requestAnalysis } from '../services/AnalysisApi';
import { headsToStart, isLive } from '../domain/AnalysisStart';
import { initialList, listIsSettling, listReducer } from '../workflows/ListMachine';
import type { ListOrder } from '../types';

const POLL_MS = 1000;

/**
 * The branch list for the current project, ranked and kept current: the first read is immediate, the
 * analysis of every branch is requested once (the server queues it and runs it off its request thread),
 * and the list is re-read until every row has its badges.
 */
export function useReviewList(baseFromRoute: string | null) {
  const [state, dispatch] = useReducer(listReducer, initialList);
  const [base, setBase] = useState<string | null>(baseFromRoute);
  const [tick, setTick] = useState(0);
  const asked = useRef<string>('');
  const forced = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function read() {
      const r = await fetchBranches(base ?? undefined);
      if (cancelled) return;
      if (!r.ok) return dispatch({ type: 'FAILED', error: r.error, code: r.code });
      dispatch({ type: 'LOADED', data: r.data });
      const heads = headsToStart(r.data.branches, forced.current);
      forced.current = false;
      const key = `${r.data.base}|${r.data.branches.map((b) => b.sha).join(',')}`;
      if (r.data.base && heads.length && asked.current !== key) {
        asked.current = key;
        await requestAnalysis(r.data.base, heads);
      }
      const settling = r.data.branches.some((b) => isLive(b.analysis.state));
      if (!cancelled && settling) timer = setTimeout(read, POLL_MS);
    }
    read();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [base, tick]);

  const setOrder = useCallback((order: ListOrder) => dispatch({ type: 'ORDER', order }), []);
  const reanalyse = useCallback(() => { asked.current = ''; forced.current = true; setTick((t) => t + 1); }, []);

  return { state, base: base ?? state.data?.base ?? null, setBase, setOrder, reload: reanalyse, settling: listIsSettling(state) };
}
