'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { memoryRows } from '../domain/MemoryRows';
import { loadAiStepsApi } from '../services/AiStepsApi';
import { forgetMemory, loadMemory, type MemoryAnswer } from '../workflows/ForgetMemory';
import type { MemoryPanel } from '../types';

const START: MemoryAnswer = { view: null, sentence: 'Reading what Line remembers for this project.', message: null };

/** im3 + j5: the open project's memory per step, read when Settings opens; Forget clears one step with one click. */
export function useMemoryPanel(): MemoryPanel {
  const [answer, setAnswer] = useState<MemoryAnswer>(START);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    void loadAiStepsApi()
      .then(loadMemory)
      .then((next) => {
        if (live) setAnswer(next);
      });
    return () => {
      live = false;
    };
  }, []);
  const forget = useCallback(
    (step: string) => {
      setBusy(true);
      void loadAiStepsApi()
        .then((api) => forgetMemory(api, step, answer))
        .then((next) => setAnswer(next))
        .finally(() => setBusy(false));
    },
    [answer],
  );
  return useMemo(() => ({ sentence: answer.sentence, rows: memoryRows(answer.view), message: answer.message, busy, forget }), [answer, busy, forget]);
}
