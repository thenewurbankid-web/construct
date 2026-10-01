'use client';

import { useEffect, useState } from 'react';
import { getPageSource } from '../services/PageSourceApi';
import type { SourceDiagnostic } from '../types';

export type PageDiagnostics = { ok: true; diagnostics: SourceDiagnostic[] } | { ok: false; error: string };

/** The same `/api/pages/source` diagnostics the Source tab's `usePageSource` already reads (#833) -- a separate
 * read here, not a shared one, the same way Impact/Tests/Findings each fetch independently; the whole file's
 * diagnostics are fetched once per save, and scoped to the selected node in `NodeDiagnostics.ts`. */
export function usePageDiagnostics(feature: string, file: string, contentHash: string) {
  const [result, setResult] = useState<PageDiagnostics | null>(null);

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    getPageSource(feature, file).then((r) => {
      if (cancelled) return;
      if (typeof r.source !== 'string') return setResult({ ok: false, error: r.error || 'Could not load diagnostics.' });
      setResult({ ok: true, diagnostics: r.diagnostics || [] });
    });
    return () => {
      cancelled = true;
    };
  }, [feature, file, contentHash]);

  return result;
}
