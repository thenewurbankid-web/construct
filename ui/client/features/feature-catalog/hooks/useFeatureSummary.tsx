'use client';

import { useCallback, useEffect, useState } from 'react';
import { buildFeatureView } from '../domain/FeatureView';
import { getFeatureSummary } from '../services/FeaturesApi';
import type { FeatureView } from '../types';

type Loaded = { name: string; view: FeatureView | null; error: string | null };

/** The details of one feature (its unit summary), or null with nothing selected. `reload` retries after a failure. */
export function useFeatureSummary(name: string | null) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (name === null) return;
    let live = true;
    getFeatureSummary(name)
      .then((r) => live && setLoaded({ name, view: buildFeatureView(r), error: r.ok ? null : (r.error?.message ?? 'That feature could not be summarized.') }))
      .catch(() => live && setLoaded({ name, view: null, error: 'The server did not answer.' }));
    return () => {
      live = false;
    };
  }, [name, attempt]);
  const reload = useCallback(() => {
    setLoaded(null);
    setAttempt((a) => a + 1);
  }, []);
  const current = name !== null && loaded?.name === name ? loaded : null;
  return { view: current?.view ?? null, error: current?.error ?? null, loading: name !== null && current === null, reload };
}
