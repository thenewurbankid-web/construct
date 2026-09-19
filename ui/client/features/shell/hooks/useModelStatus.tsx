'use client';

import { useEffect, useState } from 'react';
import { fetchOllamaStatus } from '@/features/ollama';
import type { ModelStatus } from '../types';

/** Local-model (Ollama) status for the top-bar pill: real data from the existing
 * ollama feature. Checked once on mount and again when the window regains focus. */
export function useModelStatus(): ModelStatus {
  const [status, setStatus] = useState<ModelStatus>('checking');

  useEffect(() => {
    let alive = true;
    const check = () =>
      fetchOllamaStatus()
        .then((s) => alive && setStatus(s.running ? 'ready' : 'offline'))
        .catch(() => alive && setStatus('offline'));
    check();
    window.addEventListener('focus', check);
    return () => {
      alive = false;
      window.removeEventListener('focus', check);
    };
  }, []);

  return status;
}
