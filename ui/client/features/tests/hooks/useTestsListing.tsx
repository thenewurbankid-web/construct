'use client';

import { useCallback, useEffect, useReducer, useState } from 'react';
import { fetchTestFeatures, fetchTests } from '../services/TestsApi';
import type { TestSelection } from '../types';
import { initialTests, testsReducer } from '../workflows/TestsMachine';

/** Which feature, its tests and scenario coverage, and the selection. The other Tests hooks act on this state. */
export function useTestsListing() {
  const [state, dispatch] = useReducer(testsReducer, initialTests);
  const [features, setFeatures] = useState<string[] | null>(null);
  const { feature } = state;

  useEffect(() => {
    let cancelled = false;
    fetchTestFeatures().then((list) => {
      if (cancelled) return;
      setFeatures(list);
      if (list.length) dispatch({ type: 'PICK_FEATURE', feature: list[0] });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const reload = useCallback(async (name: string) => {
    dispatch({ type: 'LOADING' });
    const r = await fetchTests(name);
    dispatch(r.ok ? { type: 'LOADED', data: r.data } : { type: 'FAILED', message: r.error });
  }, []);

  useEffect(() => {
    if (feature) void reload(feature);
  }, [feature, reload]);

  const data = state.load.status === 'ready' ? state.load.data : null;
  const pickFeature = useCallback((f: string) => dispatch({ type: 'PICK_FEATURE', feature: f }), []);
  const select = useCallback((selection: TestSelection | null) => dispatch({ type: 'SELECT', selection }), []);
  return { state, dispatch, data, features, reload, pickFeature, select };
}
