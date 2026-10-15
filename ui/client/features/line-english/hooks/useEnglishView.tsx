'use client';

import { useEffect, useState } from 'react';
import { englishStateOf } from '../domain/EnglishView';
import { lineEnglishApi } from '../services/LineEnglishApi';
import type { EnglishState, LineEnglishApi } from '../types';

/** The English view of `file`, read again when `revision` changes (a plan step landed). */
export function useEnglishView(file: string | null, revision: number, api: LineEnglishApi = lineEnglishApi): EnglishState {
  const [state, setState] = useState<EnglishState>({ phase: 'none' });
  useEffect(() => {
    if (!file) {
      setState({ phase: 'none' });
      return undefined;
    }
    let live = true;
    setState((s) => (s.phase === 'ready' && s.file === file ? s : { phase: 'loading', file }));
    void api
      .getEnglish(file)
      .then((r) => live && setState(englishStateOf(file, r)))
      .catch(() => live && setState({ phase: 'error', file, sentence: 'The Cockpit server did not answer.' }));
    return () => {
      live = false;
    };
  }, [api, file, revision]);
  return state;
}
