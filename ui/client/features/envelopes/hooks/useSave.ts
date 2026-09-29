'use client';

import { useCallback, useReducer } from 'react';
import { saveComposedFlow } from '../services/EnvelopesApi';
import { initialSave, saveReducer } from '../workflows/Save';
import type { ComposeStep, SaveApi } from '../types';

/** "Save this flow" (#395/#772): name the draft, preview it (validated but not written), then confirm to
 * commit through #759's saveFlow -- the same preview/commit/Save/Cancel shape the Rules tab's writers use.
 * `onSaved` re-reads the saved-flows list so the new/updated flow shows up immediately. */
export function useSave(steps: ComposeStep[], onSaved: () => void): SaveApi {
  const [state, dispatch] = useReducer(saveReducer, initialSave);

  const setName = useCallback((name: string) => dispatch({ type: 'NAME', name }), []);

  const preview = useCallback(() => {
    const name = state.name.trim();
    if (!name) return;
    dispatch({ type: 'START' });
    saveComposedFlow(name, steps, false).then((r) => {
      if (r.ok) dispatch({ type: 'PREVIEW_OK' });
      else dispatch({ type: 'PREVIEW_FAIL', error: r.error });
    });
  }, [state.name, steps]);

  const confirm = useCallback(() => {
    if (state.status !== 'ready') return;
    const name = state.name.trim();
    dispatch({ type: 'SAVE' });
    saveComposedFlow(name, steps, true).then((r) => {
      if (r.ok) {
        dispatch({ type: 'SAVE_OK' });
        onSaved();
      } else {
        dispatch({ type: 'SAVE_FAIL', error: r.error });
      }
    });
  }, [state.status, state.name, steps, onSaved]);

  const cancel = useCallback(() => dispatch({ type: 'CANCEL' }), []);

  return { state, setName, preview, confirm, cancel };
}
