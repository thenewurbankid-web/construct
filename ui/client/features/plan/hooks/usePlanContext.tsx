'use client';

import { useEffect, type Dispatch } from 'react';
import { fetchContext } from '../services/ContextApi';
import type { ScreenAction } from '../domain/PlanTypes';

/** Reads the project's constraints, features and the flow catalogue once, when the screen opens. */
export function usePlanContext(dispatch: Dispatch<ScreenAction>): void {
  useEffect(() => {
    let cancelled = false;
    dispatch({ type: 'CONTEXT_LOADING' });
    fetchContext().then((r) => {
      if (cancelled) return;
      dispatch(r.ok ? { type: 'CONTEXT_LOADED', context: r.data } : { type: 'CONTEXT_FAILED', error: r.error });
    });
    return () => {
      cancelled = true;
    };
  }, [dispatch]);
}
