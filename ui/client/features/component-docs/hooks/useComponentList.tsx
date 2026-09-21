'use client';

import { useCallback, useEffect, useState } from 'react';
import { getComponents } from '../services/ComponentsApi';
import type { ListState } from '../types';

const LOADING: ListState = { status: 'loading', components: [], error: '' };

/** Every component of the open project, for the Browser pane. `reload` is the error state's one next action. */
export function useComponentList() {
  const [state, setState] = useState<ListState>(LOADING);
  const load = useCallback(() => {
    setState(LOADING);
    getComponents()
      .then((r) => setState(r.ok && Array.isArray(r.components) ? { status: 'ready', components: r.components, error: '' } : { status: 'error', components: [], error: r.error ?? 'The server could not list the components.' }))
      .catch(() => setState({ status: 'error', components: [], error: 'The server did not answer.' }));
  }, []);
  useEffect(load, [load]);
  return { ...state, reload: load };
}
