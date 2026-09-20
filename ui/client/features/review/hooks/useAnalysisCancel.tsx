'use client';

import { useCallback } from 'react';
import { cancelAnalysis } from '../services/AnalysisApi';

/** Cancel the live analysis of one comparison (the machine's own CANCEL), then let the screen read its new state. */
export function useAnalysisCancel(base: string, head: string, plan: string | null, refresh: () => void) {
  return useCallback(async () => {
    await cancelAnalysis(base, head, plan);
    refresh();
  }, [base, head, plan, refresh]);
}
