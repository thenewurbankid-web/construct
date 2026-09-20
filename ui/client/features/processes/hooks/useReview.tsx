'use client';

import { useCallback, type Dispatch } from 'react';
import { fetchReview, sendDecision } from '../services/ReviewApi';
import type { ProcessesAction } from '../types';

/**
 * The approval gate's review and the person's decisions (#341). One decision on one file at a time; the
 * hash sent is the one the review showed, and who decided is the server's business, so it is not sent.
 */
export function useReview(dispatch: Dispatch<ProcessesAction>) {
  const loadReview = useCallback(async (id: string) => {
    dispatch({ type: 'REVIEW', id, result: { status: 'loading' } });
    const res = await fetchReview(id);
    dispatch({ type: 'REVIEW', id, result: res.ok ? { status: 'ready', review: res.review } : { status: 'error', message: res.error } });
  }, [dispatch]);

  const decide = useCallback(async (id: string, path: string, verdict: 'approve' | 'reject', diffSha256: string | null) => {
    const key = `${id}\n${path}`;
    dispatch({ type: 'DECIDING', key });
    const result = await sendDecision(id, path, verdict, diffSha256);
    dispatch({
      type: 'DECIDED',
      id,
      key,
      note: result.ok ? null : { error: result.error, refusals: result.refusals },
      validation: result.ok ? result.validation : null,
    });
    // Whatever happened, show the gate's current word: the verdict just recorded, or the fresh diff after a stale refusal.
    await loadReview(id);
  }, [dispatch, loadReview]);

  return { loadReview, decide };
}
