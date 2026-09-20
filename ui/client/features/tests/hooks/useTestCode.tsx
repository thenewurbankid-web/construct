'use client';

import { useCallback, type Dispatch } from 'react';
import { fetchTestSource } from '../services/TestsApi';
import type { TestSelection, TestsAction } from '../types';

/** "Show code" / "Just show me the code": reads one listed test's text, read-only. `target` selects it first. */
export function useTestCode(feature: string, selected: TestSelection | null, dispatch: Dispatch<TestsAction>) {
  const showCode = useCallback(
    async (target?: TestSelection) => {
      const sel = target ?? selected;
      if (!sel || !feature) return;
      if (target) dispatch({ type: 'SELECT', selection: target });
      dispatch({ type: 'CODE_LOADING' });
      const r = await fetchTestSource(feature, sel.area, sel.name);
      dispatch(r.ok ? { type: 'CODE_READY', path: r.path, text: r.text } : { type: 'CODE_FAILED', message: r.error });
    },
    [selected, feature, dispatch],
  );
  const hideCode = useCallback(() => dispatch({ type: 'CODE_HIDE' }), [dispatch]);
  return { showCode, hideCode };
}
