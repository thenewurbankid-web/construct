'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchRuns } from '../services/RunApi';
import type { RunSnapshot } from '../types';

const POLL_MS = 1000;

/** Where the selected feature's test run stands (#305): read from the server when the feature changes, and again every
 * second while a run is live. A late answer for a feature that is no longer selected is dropped. */
export function useRunSnapshot(feature: string) {
  const [snap, setSnap] = useState<RunSnapshot | null>(null);
  const current = useRef(feature);
  current.current = feature;

  const refresh = useCallback(async () => {
    const name = current.current;
    if (!name) return;
    const r = await fetchRuns(name);
    if (current.current === name && r.ok) setSnap(r.snap);
  }, []);

  useEffect(() => {
    setSnap(null);
    if (feature) void refresh();
  }, [feature, refresh]);

  const live = !!snap?.live;
  useEffect(() => {
    if (!live) return undefined;
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [live, refresh]);

  return { snap, setSnap, refresh };
}
