'use client';

import { useEffect, useRef } from 'react';
import type { DevServerStatus } from '../types';

/**
 * Tells the screen that owns the preview where the server can be reached: its address the moment it starts
 * answering, and `null` when it is no longer running. Called only on a change, never on every render.
 */
export function useDevServerUrl(status: DevServerStatus | null, onUrl?: (url: string | null) => void) {
  const url = status?.state === 'running' ? status.url : null;
  const announced = useRef<string | null>(null);
  useEffect(() => {
    if (url === announced.current) return;
    const wasRunning = announced.current !== null;
    announced.current = url;
    if (url || wasRunning) onUrl?.(url);
  }, [url, onUrl]);
}
