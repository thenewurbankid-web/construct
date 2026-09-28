'use client';

import { useCallback, useEffect, useState } from 'react';
import { fetchOllamaStatus } from '@/features/ollama';
import { loadMode, saveMode } from '../services/ModeStorage.ts';
import type { ActionKind, GenerateMode } from '../types.ts';

/** Owns the remembered Mechanical/AI choice for one action kind, plus whether the local
 * model is currently reachable (docs/design/ia-five-screens.md section 8.6: "reset to
 * Mechanical when the model is offline"). One instance per action kind; several actions of
 * the same kind on screen share the choice by using the same `actionKind`. */
export function useGenerateMode(actionKind: ActionKind) {
  const [mode, setMode] = useState<GenerateMode>(() => loadMode(actionKind));
  const [modelOffline, setModelOffline] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchOllamaStatus()
      .then((status) => {
        if (!cancelled) setModelOffline(!status.running);
      })
      .catch(() => {
        if (!cancelled) setModelOffline(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (modelOffline && mode === 'ai') setMode('mechanical');
  }, [modelOffline, mode]);

  const chooseMode = useCallback(
    (next: GenerateMode) => {
      setMode(next);
      saveMode(actionKind, next);
    },
    [actionKind],
  );

  return { mode, modelOffline, chooseMode };
}
