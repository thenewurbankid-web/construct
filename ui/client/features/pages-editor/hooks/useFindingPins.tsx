'use client';

import { useEffect, useState } from 'react';
import type { Finding } from '@/features/review';
import type { LivePreviewPin, PreviewRect, PreviewRectQuery } from '@/features/live-preview';

const POLL_MS = 1000;

/** #835 -- numbered pins for findings that carry a `line` (today, only the `rule-regressions` indicator
 * does; a finding with no line simply gets no pin -- an honest limitation of what `Finding` carries, not
 * a bug here). Re-measured on a short poll, not a resize observer: the preview is a cross-origin iframe,
 * so the Cockpit cannot observe its content directly -- only ask the bridge, which is what `requestRects`
 * already does. This keeps a pin roughly in place as the preview resizes or the app re-renders. */
export function useFindingPins(
  findings: Finding[],
  relPath: string | null,
  requestRects: (queries: PreviewRectQuery[]) => Promise<Record<string, PreviewRect | null>>,
  active: boolean,
) {
  const [pins, setPins] = useState<LivePreviewPin[]>([]);
  const withLine = findings.filter((f): f is Finding & { line: number } => typeof f.line === 'number');
  const key = withLine.map((f) => `${f.id}:${f.line}`).join(',');

  useEffect(() => {
    if (!active || !relPath || withLine.length === 0) {
      setPins([]);
      return undefined;
    }
    let cancelled = false;
    const measure = () => {
      const queries = withLine.map((f) => ({ key: f.id, file: relPath, line: f.line }));
      requestRects(queries).then((rects) => {
        if (cancelled) return;
        setPins(withLine.map((f, i) => ({ id: f.id, number: i + 1, rect: rects[f.id] ?? null })));
      });
    };
    measure();
    const timer = setInterval(measure, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // `key` (not `findings`/`withLine`) is the real dependency: a new array reference with the same
    // (id, line) pairs must not restart the poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, relPath, requestRects, key]);

  return pins;
}
