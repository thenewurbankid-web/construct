'use client';

import { useCallback, useEffect, useReducer, useRef } from 'react';
import { fetchGlobs, previewGlob, saveGlob } from '../services/RulesApi';
import { globEditReducer, globListReducer, initialGlobList } from '../workflows/GlobList';
import type { GlobField, GlobListApi } from '../types';

/** #395 slice D -- one glob field (`nonLayer` or `frozen`) as a list plus one pending add/remove edit as a
 * reviewable diff. Structurally identical to useExceptions, generalized over which field. */
export function useGlobList(field: GlobField): GlobListApi {
  const [state, dispatch] = useReducer(globListReducer, initialGlobList);
  const [edit, editDispatch] = useReducer(globEditReducer, null);
  const inFlight = useRef(false);
  const pending = useRef<{ kind: 'add' | 'remove'; input: string | number } | null>(null);

  const run = useCallback(() => {
    if (inFlight.current) return;
    inFlight.current = true;
    dispatch({ type: 'RUN' });
    fetchGlobs(field).then((r) => {
      inFlight.current = false;
      if (r.ok) dispatch({ type: 'RESULT', rows: r.rows });
      else dispatch({ type: 'FAIL', error: r.error });
    });
  }, [field]);

  useEffect(() => {
    run();
  }, [run]);

  const start = useCallback(
    (kind: 'add' | 'remove', input: string | number) => {
      pending.current = { kind, input };
      editDispatch({ type: 'START', kind });
      previewGlob(field, kind, input).then((r) => {
        if (pending.current?.kind !== kind || pending.current.input !== input) return;
        if (r.ok) editDispatch({ type: 'PREVIEW_OK', before: r.before, after: r.after, contentHash: r.contentHash });
        else editDispatch({ type: 'PREVIEW_FAIL', error: r.error });
      });
    },
    [field],
  );

  const addGlob = useCallback((glob: string) => start('add', glob), [start]);
  const removeAt = useCallback((index: number) => start('remove', index), [start]);

  const cancel = useCallback(() => {
    pending.current = null;
    editDispatch({ type: 'CANCEL' });
  }, []);

  const confirm = useCallback(() => {
    if (!edit || edit.status !== 'ready' || !pending.current) return;
    const { kind, input } = pending.current;
    const { contentHash } = edit;
    editDispatch({ type: 'SAVE' });
    saveGlob(field, kind, input, contentHash).then((r) => {
      if (pending.current?.kind !== kind || pending.current.input !== input) return;
      if (r.ok) {
        pending.current = null;
        editDispatch({ type: 'CANCEL' });
        run();
      } else {
        editDispatch({ type: 'SAVE_FAIL', error: r.error });
      }
    });
  }, [edit, field, run]);

  return { field, state, edit, addGlob, removeAt, confirm, cancel };
}
