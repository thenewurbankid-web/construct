'use client';

import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { BlockPatch } from '../domain/BlockTypes';
import { loadBlocks, saveBlocks } from '../services/BlocksApi';
import { initialScreen, screenReducer } from '../workflows/BlocksMachine';

/**
 * Everything the Blocks tab does: read the catalogue when it opens, and save a change to one block at a time. Saves are
 * chained, so two quick clicks never race on the same `rev`. A change shows on screen only once the server confirmed it;
 * a refusal keeps the old copy and says why in the server's own words. No model is called from here.
 */
export function useBlocks() {
  const [state, dispatch] = useReducer(screenReducer, initialScreen);
  // The rev the next save is made against, moved the moment the server answers (not on the next render), so a chained
  // save never uses the rev the one before it just replaced.
  const rev = useRef(0);
  const chain = useRef<Promise<void>>(Promise.resolve());

  const load = useCallback(async () => {
    dispatch({ type: 'LOAD_START' });
    const r = await loadBlocks();
    if (r.ok) rev.current = r.data.rev;
    dispatch(r.ok ? { type: 'LOADED', data: r.data } : { type: 'LOAD_FAILED', error: r.error });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback((id: string | null, blocks: Record<string, BlockPatch>) => {
    chain.current = chain.current.then(async () => {
      dispatch({ type: 'SAVE_START', id });
      const r = await saveBlocks(rev.current, blocks);
      if (r.ok) rev.current = r.data.rev;
      else if (r.current) rev.current = r.current.rev;
      dispatch(r.ok ? { type: 'SAVED', data: r.data } : { type: 'SAVE_REFUSED', id, code: r.code, message: r.error, ...(r.current ? { current: r.current } : {}) });
    });
    return chain.current;
  }, []);

  const setFilter = useCallback((text: string) => dispatch({ type: 'FILTER', text }), []);
  const patch = useCallback((id: string, change: BlockPatch) => save(id, { [id]: change }), [save]);
  const reset = useCallback(() => save(null, {}), [save]);
  return { state, load, setFilter, patch, reset };
}
