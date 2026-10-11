'use client';

import { useCallback, useMemo, useReducer, useRef, useState } from 'react';
import { suggestName } from '../domain/ChangeText';
import { lineApi } from '../services/LineApi';
import { idleChange, lineChangeReducer } from '../workflows/LineChange';
import type { ApplyResult, ChangeControls, LineApi } from '../types';

/** "Base on this" and "Promote to library": one change at a time, sent to the server (which writes only through
 * Construct's writer), its ApplyResult sentence kept as the page's notice. `onLanded` runs after a change landed
 * (re-read the project, re-run validate). */
export function useLineChanges(features: string[], onLanded: () => void, api: LineApi = lineApi): ChangeControls {
  const [change, dispatch] = useReducer(lineChangeReducer, idleChange);
  const [notice, setNotice] = useState<ApplyResult | null>(null);
  const current = useRef(change);
  current.current = change;

  const submit = useCallback(() => {
    const c = current.current;
    if (c.status !== 'base-on' && c.status !== 'promote') return;
    dispatch({ type: 'SUBMIT' });
    const sent = c.status === 'base-on' ? api.baseOn({ libraryId: c.libraryId, feature: c.feature, name: c.name }) : api.promote({ featureItemId: c.featureItemId });
    sent.then((result) => {
      dispatch({ type: 'DONE', result });
      if (!result.ok) return;
      setNotice(result);
      onLanded();
    });
  }, [api, onLanded]);

  const first = features[0] ?? '';
  const openBaseOn = useCallback((libraryId: string, libraryName: string) => {
    setNotice(null);
    dispatch({ type: 'OPEN_BASE_ON', libraryId, libraryName, feature: first, name: suggestName(first, libraryName) });
  }, [first]);
  const libraryName = change.status === 'base-on' ? change.libraryName : '';
  const setFeature = useCallback((feature: string) => dispatch({ type: 'SET_FEATURE', feature, name: suggestName(feature, libraryName) }), [libraryName]);
  const setName = useCallback((name: string) => dispatch({ type: 'SET_NAME', name }), []);
  const openPromote = useCallback((featureItemId: string, name: string) => {
    setNotice(null);
    dispatch({ type: 'OPEN_PROMOTE', featureItemId, name });
  }, []);
  const cancel = useCallback(() => dispatch({ type: 'CANCEL' }), []);
  const fixApplied = useCallback(
    (result: ApplyResult) => {
      setNotice(result);
      if (result.ok) onLanded();
    },
    [onLanded],
  );

  return useMemo(
    () => ({ change, notice, features, openBaseOn, setFeature, setName, openPromote, cancel, submit, fixApplied }),
    [change, notice, features, openBaseOn, setFeature, setName, openPromote, cancel, submit, fixApplied],
  );
}
