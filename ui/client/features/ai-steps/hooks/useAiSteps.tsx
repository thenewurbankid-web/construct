'use client';

import { useEffect, useMemo, useState } from 'react';
import { aiStepsView } from '../domain/AiStepsView';
import { loadAiStepsApi } from '../services/AiStepsApi';
import { loadAiSteps } from '../workflows/LoadAiSteps';
import type { AiStepsState, AiStepsView } from '../types';

/** The AI steps panel's view: loaded once when Settings opens. */
export function useAiSteps(): AiStepsView {
  const [state, setState] = useState<AiStepsState>({ phase: 'loading' });
  useEffect(() => {
    let live = true;
    void loadAiStepsApi()
      .then(loadAiSteps)
      .then((next) => {
        if (live) setState(next);
      });
    return () => {
      live = false;
    };
  }, []);
  return useMemo(() => aiStepsView(state), [state]);
}
