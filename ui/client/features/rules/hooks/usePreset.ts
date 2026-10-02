'use client';

import { useCallback, useReducer, useRef } from 'react';
import { previewPreset, savePreset } from '../services/RulesApi';
import { presetEditReducer } from '../workflows/PresetEdit';
import type { PresetApi } from '../types';

/** Switching to a named preset as a reviewable diff (#395 slice 6): preview the per-rule severity
 * changes it would make, then confirm to save (or cancel). `onSaved` re-reads the rules list and
 * project settings so severities and the active-preset label reflect the change immediately. */
export function usePreset(active: string, onSaved: () => void): PresetApi {
  const [state, dispatch] = useReducer(presetEditReducer, null);
  const current = useRef<string | null>(null);

  const start = useCallback((preset: string) => {
    current.current = preset;
    dispatch({ type: 'START', preset });
    previewPreset(preset).then((r) => {
      if (current.current !== preset) return; // cancelled, or a different preset was started meanwhile
      if (r.ok) dispatch({ type: 'PREVIEW_OK', before: r.before, after: r.after, contentHash: r.contentHash, changes: r.changes });
      else dispatch({ type: 'PREVIEW_FAIL', error: r.error });
    });
  }, []);

  const cancel = useCallback(() => {
    current.current = null;
    dispatch({ type: 'CANCEL' });
  }, []);

  const confirm = useCallback(() => {
    if (!state || state.status !== 'ready') return;
    const { preset, contentHash } = state;
    dispatch({ type: 'SAVE' });
    savePreset(preset, contentHash).then((r) => {
      if (current.current !== preset) return;
      if (r.ok) {
        current.current = null;
        dispatch({ type: 'CANCEL' });
        onSaved();
      } else {
        dispatch({ type: 'SAVE_FAIL', error: r.error });
      }
    });
  }, [state, onSaved]);

  return { active, state, start, confirm, cancel };
}
