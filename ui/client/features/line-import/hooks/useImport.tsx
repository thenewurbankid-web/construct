'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { isRefusal, refusalSentence } from '../domain/ImportRefusal';
import { importView } from '../domain/ImportView';
import { loadImportApi } from '../services/ImportApi';
import { importReducer, initialImport } from '../workflows/ImportFlow';
import type { ImportApi, ImportControls } from '../types';

/** The Import flow against the server (or the mock in Line mock mode): folders on open, then scan, answers, plan and
 * apply, one call at a time. Apply adds the plan's steps to the project's plan and runs them after the click's one
 * approval; every write happens on the server through Construct's writer, inside the chosen folder. */
export function useImport(given?: ImportApi): ImportControls {
  const [state, dispatch] = useReducer(importReducer, initialImport);
  const [api, setApi] = useState<ImportApi | null>(given ?? null);
  const current = useRef(state);
  current.current = state;

  useEffect(() => {
    if (given) return;
    let live = true;
    loadImportApi().then((a) => { if (live) setApi(a); });
    return () => { live = false; };
  }, [given]);

  useEffect(() => {
    if (!api) return;
    api.importFolders().then(
      (body) => { if (!isRefusal(body)) dispatch({ type: 'FOLDERS', folders: body }); },
      () => dispatch({ type: 'REFUSED', sentence: 'The Cockpit server did not answer.' }),
    );
  }, [api]);

  const call = useCallback(<T,>(send: (a: ImportApi) => Promise<T>, done: (body: T) => void) => {
    if (!api) return;
    send(api).then(
      (body) => (isRefusal(body) ? dispatch({ type: 'REFUSED', sentence: refusalSentence(body) }) : done(body)),
      () => dispatch({ type: 'REFUSED', sentence: 'The Cockpit server did not answer; nothing was changed.' }),
    );
  }, [api]);

  const setFolder = useCallback((folder: string) => dispatch({ type: 'SET_FOLDER', folder }), []);
  const scan = useCallback(() => {
    const folder = current.current.folder;
    dispatch({ type: 'SCAN' });
    call((a) => a.importScan({ folder }), (body) => dispatch({ type: 'SCANNED', scan: body as never }));
  }, [call]);
  const answer = useCallback((questionId: string, optionId: string) => dispatch({ type: 'ANSWER', questionId, optionId }), []);
  const plan = useCallback(() => {
    const { folder, answers } = current.current;
    dispatch({ type: 'PLAN' });
    call((a) => a.importPlan({ folder, answers }), (body) => dispatch({ type: 'PLANNED', plan: body as never }));
  }, [call]);
  const apply = useCallback(() => {
    const { folder, answers, plan: shown } = current.current;
    dispatch({ type: 'APPLY' });
    call((a) => a.importApply({ folder, answers }, shown), (body) => dispatch({ type: 'APPLIED', result: body as never }));
  }, [call]);

  const view = useMemo(() => importView(state), [state]);
  return useMemo(() => ({ state, view, setFolder, scan, answer, plan, apply }), [state, view, setFolder, scan, answer, plan, apply]);
}
