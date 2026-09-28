'use client';

import { useCallback, useEffect, useReducer, useRef } from 'react';
import { fetchExceptions, previewException, saveException } from '../services/RulesApi';
import { exceptionEditReducer, exceptionsReducer, initialExceptions } from '../workflows/Exceptions';
import type { ExceptionsApi, NewException } from '../types';

/** #395 slice C -- the exceptions list (read on mount, same run-once-and-on-demand shape as useRules) plus one
 * pending add/remove edit as a reviewable diff: pick an action, preview, then confirm to save or cancel. */
export function useExceptions(): ExceptionsApi {
  const [state, dispatch] = useReducer(exceptionsReducer, initialExceptions);
  const [edit, editDispatch] = useReducer(exceptionEditReducer, null);
  const inFlight = useRef(false);
  const pending = useRef<{ kind: 'add' | 'remove'; input: NewException | number } | null>(null);

  const run = useCallback(() => {
    if (inFlight.current) return;
    inFlight.current = true;
    dispatch({ type: 'RUN' });
    fetchExceptions().then((r) => {
      inFlight.current = false;
      if (r.ok) dispatch({ type: 'RESULT', rows: r.rows });
      else dispatch({ type: 'FAIL', error: r.error });
    });
  }, []);

  useEffect(() => {
    run();
  }, [run]);

  const start = useCallback((kind: 'add' | 'remove', input: NewException | number) => {
    pending.current = { kind, input };
    editDispatch({ type: 'START', kind });
    previewException(kind, input).then((r) => {
      if (pending.current?.kind !== kind || pending.current.input !== input) return;
      if (r.ok) editDispatch({ type: 'PREVIEW_OK', before: r.before, after: r.after, contentHash: r.contentHash });
      else editDispatch({ type: 'PREVIEW_FAIL', error: r.error });
    });
  }, []);

  const addDraft = useCallback((draft: NewException) => start('add', draft), [start]);
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
    saveException(kind, input, contentHash).then((r) => {
      if (pending.current?.kind !== kind || pending.current.input !== input) return;
      if (r.ok) {
        pending.current = null;
        editDispatch({ type: 'CANCEL' });
        run();
      } else {
        editDispatch({ type: 'SAVE_FAIL', error: r.error });
      }
    });
  }, [edit, run]);

  return { state, edit, addDraft, removeAt, confirm, cancel };
}
