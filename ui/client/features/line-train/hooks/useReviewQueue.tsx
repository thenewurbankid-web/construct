'use client';

import { useCallback, useEffect, useState } from 'react';
import { ask } from '../services/LineTrainApi';
import type { TrainCaseList, TrainCaseView, TrainHttp } from '../types';

const PAGE = 5;

/** Claude's cases in the owner's review sample, five at a time, unreviewed first; Agree / Disagree (with a note). */
export function useReviewQueue(api: TrainHttp, onChange: () => void, onError: (s: string | null) => void) {
  const [list, setList] = useState<TrainCaseList>({ total: 0, open: 0, cases: [] });
  const [limit, setLimit] = useState(PAGE);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async (n: number) => {
    const a = await ask(() => api.cases('sample', n));
    if (a.ok) setList(a.value);
    else onError(a.sentence);
  }, [api, onError]);
  useEffect(() => { void load(limit); }, [load, limit]);
  const replace = useCallback((c: TrainCaseView) => setList((l) => ({ ...l, open: Math.max(0, l.open - 1), cases: l.cases.map((x) => (x.id === c.id ? c : x)) })), []);
  const review = useCallback(async (id: string, verdict: 'agree' | 'disagree', note?: string) => {
    setBusy(true);
    const a = await ask(() => api.review(id, verdict, note));
    setBusy(false);
    if (!a.ok) { onError(a.sentence); return; }
    onError(null);
    replace(a.value.case);
    onChange();
  }, [api, onChange, onError, replace]);
  return {
    ...list,
    more: () => setLimit((n) => n + PAGE),
    review: { busy, agree: (id: string) => void review(id, 'agree'), disagree: (id: string, note: string) => void review(id, 'disagree', note) },
  };
}
