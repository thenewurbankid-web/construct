'use client';

import { useCallback, useMemo, useReducer, useRef } from 'react';
import { suggestName } from '../domain/ChangeText';
import { idleChange, lineChangeReducer } from '../workflows/LineChange';
import type { AddPlanStep, ApplyResult, ChangeControls } from '../types';

/** "Base on this" and "Promote to library": one change at a time, added as a step of the project's plan (cp1). The
 * form closes once the step waits for approval in the Plan panel; a refusal (bad name, name taken) keeps it open
 * with the sentence. Nothing is written here: the person approves the step in the Plan panel, and `notice` is the
 * sentence of the step that ran. */
export function useLineChanges(features: string[], addStep: AddPlanStep, notice: ApplyResult | null): ChangeControls {
  const [change, dispatch] = useReducer(lineChangeReducer, idleChange);
  const current = useRef(change);
  current.current = change;

  const submit = useCallback(() => {
    const c = current.current;
    if (c.status !== 'base-on' && c.status !== 'promote') return;
    dispatch({ type: 'SUBMIT' });
    const req = c.status === 'base-on'
      ? { tool: 'line.baseOn', args: { libraryId: c.libraryId, feature: c.feature, name: c.name } }
      : { tool: 'line.promote', args: { featureItemId: c.featureItemId } };
    void addStep(req).then((r) => dispatch({ type: 'DONE', result: { ok: r.ok, sentence: r.sentence, files: [], findings: [] } }));
  }, [addStep]);

  const first = features[0] ?? '';
  const openBaseOn = useCallback((libraryId: string, libraryName: string) => {
    dispatch({ type: 'OPEN_BASE_ON', libraryId, libraryName, feature: first, name: suggestName(first, libraryName) });
  }, [first]);
  const libraryName = change.status === 'base-on' ? change.libraryName : '';
  const setFeature = useCallback((feature: string) => dispatch({ type: 'SET_FEATURE', feature, name: suggestName(feature, libraryName) }), [libraryName]);
  const setName = useCallback((name: string) => dispatch({ type: 'SET_NAME', name }), []);
  const openPromote = useCallback((featureItemId: string, name: string) => {
    dispatch({ type: 'OPEN_PROMOTE', featureItemId, name });
  }, []);
  const cancel = useCallback(() => dispatch({ type: 'CANCEL' }), []);

  return useMemo(
    () => ({ change, notice, features, openBaseOn, setFeature, setName, openPromote, cancel, submit }),
    [change, notice, features, openBaseOn, setFeature, setName, openPromote, cancel, submit],
  );
}
