'use client';

import { useEffect, useState } from 'react';
import { getComponentUsedBy } from '../services/ComponentsApi';
import type { UsedByResponse } from '../types';

/** #380 "Used by": the pages that import this component, transitively. `null` while loading or with nothing
 * selected. A network failure is an ok:false answer, never a throw. */
export function useComponentUsedBy(path: string | null) {
  const [response, setResponse] = useState<{ path: string; result: UsedByResponse } | null>(null);
  useEffect(() => {
    if (path === null) return;
    let live = true;
    getComponentUsedBy(path)
      .then((result) => live && setResponse({ path, result }))
      .catch(() => live && setResponse({ path, result: { ok: false, code: 'NETWORK', error: 'The server did not answer.' } }));
    return () => {
      live = false;
    };
  }, [path]);
  const current = response && response.path === path ? response.result : null;
  return { usedBy: path === null ? null : current, loading: path !== null && current === null };
}
