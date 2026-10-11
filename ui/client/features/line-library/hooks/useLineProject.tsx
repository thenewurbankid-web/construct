'use client';

import { useCallback, useEffect, useReducer } from 'react';
import { lineApi } from '../services/LineApi';
import { initialLineProject, lineProjectReducer } from '../workflows/LineProject';
import type { LineApi } from '../types';

/** The Line view of the open project, read once on mount; `reload` reads it again. The API is injectable so a
 * test or story can pass the contract mock (services/LineApi.mock.ts). */
export function useLineProject(api: LineApi = lineApi) {
  const [state, dispatch] = useReducer(lineProjectReducer, initialLineProject);
  const load = useCallback(() => {
    dispatch({ type: 'LOAD' });
    api.getLineProject().then((r) => dispatch(r.ok ? { type: 'LOADED', project: r.project } : { type: 'FAILED', sentence: r.sentence }));
  }, [api]);
  useEffect(load, [load]);
  return { state, reload: load };
}
