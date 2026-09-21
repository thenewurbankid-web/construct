'use client';

import { useCallback, useEffect, useReducer, useState } from 'react';
import { diffSourceLines } from '@/features/workflows';
import type { SourceDiagnostic } from '@/features/pages-editor';
import { commitComponentSave, getComponentSource, previewComponentSave } from '../services/ComponentsApi';
import { editReducer, initialEditState, isDirty } from '../workflows/ComponentEdit';

const violationText = (v?: { rule?: string; message?: string }[]) => (v ?? []).map((x) => `${x.rule ?? ''} ${x.message ?? ''}`.trim()).join('; ');

/** The plain-file editor of one component: load its text, edit it, review the diff, confirm the save. All writes go
 * through the server's reviewed path (preview, then hash-checked + architecture-gated commit). `onSaved` lets the
 * screen refresh what depends on the file (its props). */
export function useComponentEditor(path: string | null, onSaved: () => void) {
  const [state, dispatch] = useReducer(editReducer, initialEditState);
  const [diagnostics, setDiagnostics] = useState<SourceDiagnostic[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    if (path === null) return () => {};
    let live = true;
    setLoading(true);
    setLoadError(null);
    getComponentSource(path)
      .then((r) => {
        if (!live) return;
        if (r.ok) {
          dispatch({ type: 'LOAD', loaded: { path: r.path, source: r.source, contentHash: r.contentHash, editable: r.editable } });
          setDiagnostics(r.diagnostics);
        } else setLoadError(r.error ?? 'The file could not be read.');
      })
      .catch(() => live && setLoadError('The server did not answer.'))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [path]);
  useEffect(() => load(), [load]);

  const edit = useCallback((draft: string) => dispatch({ type: 'EDIT', draft }), []);
  const discard = useCallback(() => dispatch({ type: 'DISCARD' }), []);
  const cancelReview = useCallback(() => dispatch({ type: 'CANCEL_PREVIEW' }), []);

  const review = useCallback(async () => {
    if (path === null) return;
    dispatch({ type: 'CHECKING' });
    try {
      const r = await previewComponentSave(path, state.draft);
      if (r.ok) dispatch({ type: 'PREVIEW', hunks: diffSourceLines(r.before, r.after) });
      else dispatch({ type: 'FAILED', error: r.error ?? 'The change could not be checked.' });
    } catch {
      dispatch({ type: 'FAILED', error: 'The server did not answer.' });
    }
  }, [path, state.draft]);

  const confirm = useCallback(async () => {
    if (path === null || !state.loaded) return;
    dispatch({ type: 'SAVING' });
    try {
      const r = await commitComponentSave(path, state.draft, state.loaded.contentHash);
      if (r.ok) {
        dispatch({ type: 'SAVED', contentHash: r.contentHash });
        onSaved();
        getComponentSource(path).then((s) => s.ok && setDiagnostics(s.diagnostics)).catch(() => {});
      } else {
        const why = violationText(r.violations);
        dispatch({ type: 'FAILED', error: `${r.error ?? 'The save failed.'}${why ? ` ${why}` : ''}`, conflict: r.code === 'CHANGED_ON_DISK' });
      }
    } catch {
      dispatch({ type: 'FAILED', error: 'The server did not answer.' });
    }
  }, [path, state.draft, state.loaded, onSaved]);

  return { state, diagnostics, loadError, loading, dirty: isDirty(state), edit, discard, review, cancelReview, confirm, reload: load };
}
