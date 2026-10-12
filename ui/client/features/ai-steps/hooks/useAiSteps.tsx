'use client';

import { useEffect, useMemo, useState } from 'react';
import { aiStepsView } from '../domain/AiStepsView';
import { loadAiStepsApi } from '../services/AiStepsApi';
import { loadAiSteps, loadMisses } from '../workflows/LoadAiSteps';
import type { AiStepsState, AiStepsView, MissView } from '../types';

/** The AI steps panel's view: loaded once when Settings opens. */
export function useAiSteps(): AiStepsView {
  const [state, setState] = useState<AiStepsState>({ phase: 'loading' });
  const [misses, setMisses] = useState<MissView | null>(null);
  useEffect(() => {
    let live = true;
    void loadAiStepsApi().then(async (api) => {
      const [next, report] = await Promise.all([loadAiSteps(api), loadMisses(api)]);
      if (!live) return;
      setState(next);
      setMisses(report);
    });
    return () => {
      live = false;
    };
  }, []);
  return useMemo(() => aiStepsView(state, misses), [state, misses]);
}
