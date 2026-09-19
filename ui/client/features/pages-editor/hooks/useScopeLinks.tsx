'use client';

import { useEffect, useMemo, useState } from 'react';
import { buildScopeView } from '../domain/ScopeLinkView';
import type { ScopeLinkGraph } from '../types';
import { getScopeLinks } from '../services/ScopeLinksApi';

/** The selected element's scope/binding view model (#223). Refetches when the node or the file's
 * content hash changes (i.e. after every save), ignoring stale responses. */
export function useScopeLinks(feature: string, file: string, nodeId: string, contentHash: string) {
  const [graph, setGraph] = useState<ScopeLinkGraph | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    getScopeLinks(feature, file, nodeId)
      .then((r) => {
        if (cancelled) return;
        if (r.error) {
          setGraph(null);
          setError(r.error);
        } else {
          setGraph(r);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(String(e?.message || e));
      });
    return () => {
      cancelled = true;
    };
  }, [feature, file, nodeId, contentHash]);

  const view = useMemo(() => (graph ? buildScopeView(graph) : null), [graph]);
  return { view, error };
}
