'use client';

import { useEffect, useState } from 'react';
import { fetchTests, type TestsListing } from '@/features/tests';

export type PageTestsCoverage = { ok: true; data: TestsListing } | { ok: false; error: string };

/** Inspector "Tests" section (#830, design 8.2/9's "Tests N pass"): the open page's FEATURE's scenario
 * coverage, from the same /api/tests/:feature the standalone Tests screen already reads — no new coverage
 * engine. Coverage is a property of the feature's workflow, not of which page file happens to be open, so
 * this refetches on feature change only (unlike useImpact, which is per-file). */
export function useTestsCoverage(feature: string) {
  const [coverage, setCoverage] = useState<PageTestsCoverage | null>(null);

  useEffect(() => {
    let cancelled = false;
    setCoverage(null);
    fetchTests(feature).then((r) => {
      if (!cancelled) setCoverage(r);
    });
    return () => {
      cancelled = true;
    };
  }, [feature]);

  return coverage;
}
