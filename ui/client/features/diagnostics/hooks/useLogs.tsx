'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { lastId, mergeEntries } from '../domain/LogEntries';
import { fetchLogs } from '../services/LogsApi';
import type { LogEntry } from '../types';

const POLL_MS = 2500;

/** Recent server/command output, polled while the Logs tab is mounted.
 * "Clear" only hides what is already shown (the server keeps its own bounded buffer). */
export function useLogs() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const cursor = useRef(0);

  const refresh = useCallback(async () => {
    const next = await fetchLogs(cursor.current);
    if (next === null) {
      setError('Could not reach the Construct server.');
      return;
    }
    setError(null);
    if (next.length) {
      cursor.current = Math.max(cursor.current, lastId(next));
      setEntries((cur) => mergeEntries(cur, next));
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  const clear = useCallback(() => setEntries([]), []);
  return { entries, error, refresh, clear };
}
