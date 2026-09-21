'use client';

import { useCallback, useEffect, useState } from 'react';
import { getFeatureIndex } from '../services/FeaturesApi';
import type { FeatureListState } from '../types';

const LOADING: FeatureListState = { status: 'loading', features: [], error: '' };

/** Every feature of the open project, for the Browser pane. `reload` is the error state's one next action. */
export function useFeatureList() {
  const [state, setState] = useState<FeatureListState>(LOADING);
  const load = useCallback(() => {
    setState(LOADING);
    getFeatureIndex()
      .then((r) => setState(r.ok ? { status: 'ready', features: r.features, error: '' } : { status: 'error', features: [], error: r.error?.message ?? 'The server could not list the features.' }))
      .catch(() => setState({ status: 'error', features: [], error: 'The server did not answer.' }));
  }, []);
  useEffect(load, [load]);
  return { ...state, reload: load };
}
