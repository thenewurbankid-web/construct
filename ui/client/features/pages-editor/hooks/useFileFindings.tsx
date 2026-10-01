'use client';

import { useEffect, useState } from 'react';
import { fetchReviewBranches, fetchReviewChange, type Finding } from '@/features/review';

export type FileFindings = { ok: true; ready: false } | { ok: true; ready: true; findings: Finding[] } | { ok: false; error: string };

/** Inspector "Findings" section (#831): the SAME Review data (prHealth via /api/review), filtered to the open
 * page file's path (as resolved by useImpact's /api/pages/impact, not recomputed here) -- no new findings engine.
 * Deliberately never calls requestAnalysis the way the Review screen's own hooks (useReviewList/useReviewChange)
 * do: opening a page in the Pages editor must not silently kick off a background PR-health run. `ready: false`
 * is the honest "this file hasn't been reviewed yet" state, not an error. */
export function useFileFindings(relPath: string | null) {
  const [result, setResult] = useState<FileFindings | null>(null);

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    if (!relPath) return;
    (async () => {
      const branches = await fetchReviewBranches();
      if (cancelled) return;
      if (!branches.ok) return setResult({ ok: false, error: branches.error });
      const current = branches.data.branches.find((b) => b.current);
      const base = branches.data.base;
      if (!current || !base || current.analysis.state !== 'done') {
        setResult({ ok: true, ready: false });
        return;
      }
      const change = await fetchReviewChange(base, current.name);
      if (cancelled) return;
      if (!change.ok) return setResult({ ok: false, error: change.error });
      if (change.data.state !== 'done' || !change.data.report) {
        setResult({ ok: true, ready: false });
        return;
      }
      const findings = change.data.report.findings.filter((f) => f.files?.includes(relPath));
      setResult({ ok: true, ready: true, findings });
    })();
    return () => {
      cancelled = true;
    };
  }, [relPath]);

  return result;
}
