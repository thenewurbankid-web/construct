'use client';

import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { cancelRun, startRun } from '../services/RunApi';
import type { RunSnapshot, RunTarget } from '../types';

type ActionsInput = {
  feature: string;
  address: string;
  setSnap: Dispatch<SetStateAction<RunSnapshot | null>>;
  refresh: () => Promise<void>;
};

/** Start a run (every test, or one) and cancel the live one (#305). The server decides what may run and where; a
 * refusal (a bad address, a run already in progress) is kept as `refused` in its own words. */
export function useRunActions({ feature, address, setSnap, refresh }: ActionsInput) {
  const [refused, setRefused] = useState<string | null>(null);
  useEffect(() => setRefused(null), [feature]);

  const start = useCallback(async (target: RunTarget = null) => {
    if (!feature) return;
    setRefused(null);
    const r = await startRun(feature, target, address);
    if (r.ok) return setSnap(r.snap);
    setRefused(r.error);
    if (r.snap) setSnap(r.snap);
  }, [feature, address, setSnap]);

  const cancel = useCallback(async () => {
    if (!feature) return;
    await cancelRun(feature);
    await refresh();
  }, [feature, refresh]);

  return { refused, start, cancel };
}
