'use client';

import { useEffect, useState } from 'react';
import { getComponentWorkflow } from '../services/ComponentsApi';
import type { ComponentWorkflowResponse } from '../types';

/** #380 "State switcher": the machine driving this component (same-name-file convention), or `machines: []`
 * when it has none -- that is the common case, not a failure. `null` while loading or with nothing selected. */
export function useComponentWorkflow(path: string | null) {
  const [response, setResponse] = useState<{ path: string; result: ComponentWorkflowResponse } | null>(null);
  useEffect(() => {
    if (path === null) return;
    let live = true;
    getComponentWorkflow(path)
      .then((result) => live && setResponse({ path, result }))
      .catch(() => live && setResponse({ path, result: { ok: false, code: 'NETWORK', error: 'The server did not answer.' } }));
    return () => {
      live = false;
    };
  }, [path]);
  const current = response && response.path === path ? response.result : null;
  return { workflow: path === null ? null : current, loading: path !== null && current === null };
}
