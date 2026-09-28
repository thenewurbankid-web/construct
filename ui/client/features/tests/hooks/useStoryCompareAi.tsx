'use client';

import { useCallback, useState } from 'react';
import type { GenerateMode, GenerateResult as ControlResult } from '@/features/generate-control';
import { storyCompareAi } from '../services/TestsWrites';

type Run = { running: boolean; result: ControlResult | null };
const IDLE: Run = { running: false, result: null };

/** Runs AI compare (#388) for the given feature through the inline Generate control. Mechanical mode makes no
 * call at all -- the three-list compare it stands for is already drawn as the Story column above, "0 model
 * calls" per design 8.6 guardrail 1. AI mode calls the model, which may only cite acceptance lines and code
 * units; every citation is verified mechanically server-side before it comes back, so an unverifiable one is
 * dropped there, never here. `onRun` is the control's only exit; nothing is written. */
export function useStoryCompareAi(feature: string) {
  const [run, setRun] = useState<Run>(IDLE);

  const start = useCallback(async (mode: GenerateMode) => {
    if (mode === 'mechanical') {
      setRun({ running: false, result: { ok: true, summary: 'Already shown in the Story column above (0 model calls).' } });
      return;
    }
    setRun({ running: true, result: null });
    const r = await storyCompareAi(feature);
    if (!r.ok) { setRun({ running: false, result: { ok: false, summary: r.error } }); return; }
    const summary = r.dropped.length > 0 ? `${r.verified.length} citation(s) verified, ${r.dropped.length} dropped` : `${r.verified.length} citation(s) verified`;
    setRun({ running: false, result: { ok: true, summary } });
  }, [feature]);

  const cancel = useCallback(() => setRun(IDLE), []);

  return { running: run.running, result: run.result, run: start, cancel };
}
