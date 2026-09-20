'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import type { FailureAction } from '../types';

/** What each "next action" of a failure notice does: retry, back to the list, review without a plan, or Settings. */
export function useFailureActions(handlers: { retry: () => void; list: () => void; noPlan?: () => void }) {
  const router = useRouter();
  const { retry, list, noPlan } = handlers;
  return useCallback((a: FailureAction) => {
    const run: Record<FailureAction, () => void> = {
      retry,
      list,
      'no-plan': noPlan ?? retry,
      settings: () => router.push('/settings'),
    };
    run[a]();
  }, [router, retry, list, noPlan]);
}
