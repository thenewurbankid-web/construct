'use client';

import { useCallback, useEffect, useState } from 'react';
import { getAllPages } from '../services/PagesBrowsing';

type State = { status: 'loading' | 'error' | 'ready'; pages: { feature: string; file: string }[]; error: string };
const LOADING: State = { status: 'loading', pages: [], error: '' };

/** Every page of the project, for the Pages screen's Browser list. `reload` is the error state's one next action. */
export function useAllPages() {
  const [state, setState] = useState<State>(LOADING);
  const load = useCallback(() => {
    setState(LOADING);
    getAllPages()
      .then((r) => setState(r.ok && Array.isArray(r.pages) ? { status: 'ready', pages: r.pages, error: '' } : { status: 'error', pages: [], error: r.error ?? 'The server could not list the pages.' }))
      .catch(() => setState({ status: 'error', pages: [], error: 'The server did not answer.' }));
  }, []);
  useEffect(load, [load]);
  return { ...state, reload: load };
}
