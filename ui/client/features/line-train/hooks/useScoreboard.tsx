'use client';

import { useCallback, useEffect, useState } from 'react';
import { ask } from '../services/LineTrainApi';
import type { Scoreboard, TrainHttp } from '../types';

/** The scoreboard (GET /api/line/train/scoreboard) and "Run eval". `onError` gets a refusal's sentence. */
export function useScoreboard(api: TrainHttp, onError: (s: string | null) => void) {
  const [board, setBoard] = useState<Scoreboard | null>(null);
  const [running, setRunning] = useState(false);
  const reload = useCallback(async () => {
    const a = await ask(() => api.scoreboard());
    if (a.ok) setBoard(a.value);
    else onError(a.sentence);
  }, [api, onError]);
  const run = useCallback(async () => {
    setRunning(true);
    const a = await ask(() => api.runEval());
    setRunning(false);
    if (a.ok) { setBoard(a.value); onError(null); } else onError(a.sentence);
  }, [api, onError]);
  useEffect(() => { void reload(); }, [reload]);
  return { board, running, run, reload };
}
