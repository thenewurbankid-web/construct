'use client';

import { useEffect, useMemo, useState } from 'react';
import { getPageSource } from '../services/PageSourceApi';
import { diagnosticsToMarkers, describeSummary, summarizeDiagnostics } from '../domain/SourceMarkers';
import type { SourceDiagnostic } from '../types';

/** Loads a page's full source + diagnostics while `enabled`, and re-runs
 * whenever the page's contentHash changes (i.e. after any save), so the
 * markers always describe what is on disk. Derives editor-neutral markers
 * and the summary line; no editor library involved. */
export function usePageSource(feature: string, file: string, contentHash: string, enabled: boolean) {
  const [source, setSource] = useState('');
  const [diagnostics, setDiagnostics] = useState<SourceDiagnostic[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getPageSource(feature, file)
      .then((r) => {
        if (cancelled) return;
        if (typeof r.source !== 'string') {
          setError(r.error || 'Could not load the source.');
          return;
        }
        setSource(r.source);
        setDiagnostics(r.diagnostics || []);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [feature, file, contentHash, enabled]);

  const markers = useMemo(() => diagnosticsToMarkers(diagnostics, source), [diagnostics, source]);
  const summary = useMemo(() => summarizeDiagnostics(diagnostics), [diagnostics]);
  return { source, diagnostics, markers, summary, summaryText: describeSummary(summary), loading, error };
}
