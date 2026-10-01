'use client';

import { useEffect, useState } from 'react';
import { getPageImpact, type PageImpact } from '../services/ImpactApi';

/** Inspector "Impact" section (#379): computed once per open file (not per node selection), since
 * the blast radius is a property of the file, not of which element inside it happens to be selected.
 * Refetches when the file's content hash changes (i.e. after every save), ignoring stale responses. */
export function useImpact(feature: string, file: string, contentHash: string) {
  const [impact, setImpact] = useState<PageImpact | null>(null);

  useEffect(() => {
    let cancelled = false;
    setImpact(null);
    getPageImpact(feature, file).then((r) => {
      if (!cancelled) setImpact(r);
    });
    return () => {
      cancelled = true;
    };
  }, [feature, file, contentHash]);

  return impact;
}
