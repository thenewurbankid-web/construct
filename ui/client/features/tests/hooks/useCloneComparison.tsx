'use client';

import { useEffect, useState } from 'react';
import { freshnessModel } from '../domain/FreshnessView';
import { fetchComparison } from '../services/ComparisonApi';
import type { ComparisonView, TestSelection, YourTest } from '../types';

/** What changed under the selected clone (#306). Reads only when the clone is flagged or its flow changed elsewhere;
 * a clone that is up to date, or has no lineage, costs no request. */
export function useCloneComparison(feature: string, selected: TestSelection | null, test: YourTest | null | undefined) {
  const [view, setView] = useState<ComparisonView>({ status: 'none' });
  const name = selected?.area === 'yours' ? selected.name : null;
  const state = test?.freshness?.state;
  const wanted = !!feature && !!name && (state === 'scenario-changed' || state === 'scenario-removed' || state === 'machine-changed');

  useEffect(() => {
    if (!wanted || !name) {
      setView({ status: 'none' });
      return undefined;
    }
    let cancelled = false;
    setView({ status: 'loading' });
    fetchComparison(feature, name).then((r) => {
      if (!cancelled) setView(r.ok ? { status: 'ready', data: r.data } : { status: 'error', message: r.error });
    });
    return () => {
      cancelled = true;
    };
  }, [feature, name, wanted, state]);

  // "It is still fine": hides the note for this visit only. Nothing is written; the clone's lineage is untouched.
  const [hidden, setHidden] = useState<string[]>([]);
  return { model: freshnessModel(view), dismissed: !!name && hidden.includes(name), dismiss: () => name && setHidden((h) => [...h, name]) };
}
