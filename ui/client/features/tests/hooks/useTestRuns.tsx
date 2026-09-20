'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { cancelRun, fetchRuns, startRun } from '../services/RunApi';
import type { RunSnapshot, RunTarget } from '../types';

const POLL_MS = 1000;

/** Running the selected feature's tests (#305): the live run, the latest result per test and the newest problem, read
 * from the server; starting a run, cancelling it, and copying a bug report. The run itself is a Process in the Processes
 * drawer; this only starts it and watches it. Every rule (what may run, where) lives on the server. */
export function useTestRuns(feature: string) {
  const [snap, setSnap] = useState<RunSnapshot | null>(null);
  const [address, setAddress] = useState('');
  const [refused, setRefused] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const current = useRef(feature);
  current.current = feature;

  const refresh = useCallback(async () => {
    const name = current.current;
    if (!name) return;
    const r = await fetchRuns(name);
    if (current.current !== name) return;
    if (r.ok) setSnap(r.snap);
  }, []);

  useEffect(() => {
    setSnap(null);
    setRefused(null);
    setCopied(null);
    if (feature) void refresh();
  }, [feature, refresh]);

  // the server's default address is only a starting point; what the person typed is never overwritten
  useEffect(() => {
    if (snap && address === '') setAddress(snap.defaultBaseUrl);
  }, [snap, address]);

  const live = !!snap?.live;
  useEffect(() => {
    if (!live) return undefined;
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [live, refresh]);

  const start = useCallback(async (target: RunTarget = null) => {
    if (!feature) return;
    setRefused(null);
    setCopied(null);
    const r = await startRun(feature, target, address);
    if (r.ok) setSnap(r.snap);
    else {
      setRefused(r.error);
      if (r.snap) setSnap(r.snap);
    }
  }, [feature, address]);

  const cancel = useCallback(async () => {
    if (!feature) return;
    await cancelRun(feature);
    await refresh();
  }, [feature, refresh]);

  /** Copy text for a ticket. When the browser will not let a page write the clipboard, say so and leave the text to select. */
  const copy = useCallback(async (key: string, text: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      return true;
    } catch {
      setCopied(null);
      return false;
    }
  }, []);

  return { snap, live: snap?.live ?? null, address, setAddress, refused, copied, start, cancel, copy, refresh };
}
