'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { lintPageBuffer } from '../services/PageSourceApi';
import { diagnosticsToMarkers, describeSummary, summarizeDiagnostics } from '../domain/SourceMarkers';
import type { SourceDiagnostic } from '../types';

const DEBOUNCE_MS = 450;

/** #551 — replaces "diagnostics only after save": while `enabled` and `source`
 * is being edited, re-lints the unsaved buffer (never written to disk) a
 * debounce tick after the last keystroke, so Monaco markers track what is
 * typed rather than what was last saved. One in-flight request at a time —
 * a response that arrives after a newer one was already requested is
 * dropped, so a slow lint can never overwrite a fresher result. */
export function useBufferLint(feature: string, file: string, source: string, enabled: boolean) {
  const [diagnostics, setDiagnostics] = useState<SourceDiagnostic[]>([]);
  const [linting, setLinting] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    if (!enabled || source === '') return;
    const id = requestId.current + 1;
    requestId.current = id;
    const timer = setTimeout(() => {
      setLinting(true);
      lintPageBuffer(feature, file, source)
        .then((r) => {
          if (requestId.current !== id) return; // a newer edit superseded this request
          setDiagnostics(r.diagnostics || []);
        })
        .finally(() => {
          if (requestId.current === id) setLinting(false);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [feature, file, source, enabled]);

  const markers = useMemo(() => diagnosticsToMarkers(diagnostics, source), [diagnostics, source]);
  const summary = useMemo(() => summarizeDiagnostics(diagnostics), [diagnostics]);
  return { diagnostics, markers, summary, summaryText: describeSummary(summary), linting };
}
