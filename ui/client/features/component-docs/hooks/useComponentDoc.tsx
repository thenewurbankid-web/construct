'use client';

import { useEffect, useState } from 'react';
import { getComponentDescription } from '../services/ComponentsApi';
import type { DescribeResponse } from '../types';

/** The props of one component (react-docgen through the server), reloaded when `revision` changes (after a save).
 * `null` while loading or with nothing selected. A network failure is an ok:false answer, never a throw. */
export function useComponentDoc(path: string | null, revision: number) {
  const [response, setResponse] = useState<{ path: string; revision: number; result: DescribeResponse } | null>(null);
  useEffect(() => {
    if (path === null) return;
    let live = true;
    getComponentDescription(path)
      .then((result) => live && setResponse({ path, revision, result }))
      .catch(() => live && setResponse({ path, revision, result: { ok: false, code: 'NETWORK', error: 'The server did not answer.' } }));
    return () => {
      live = false;
    };
  }, [path, revision]);
  const current = response && response.path === path && response.revision === revision ? response.result : null;
  return { description: path === null ? null : current, loading: path !== null && current === null };
}
