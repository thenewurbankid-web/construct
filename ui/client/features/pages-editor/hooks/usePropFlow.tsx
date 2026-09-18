'use client';

import { useMemo, useState } from 'react';
import { buildPillFlow } from '../domain/PropFlowLayout';
import type { MeasureText } from '../domain/PropFlowGeometry';
import type { PagesEditorNode } from '../types';

// #77 follow-up to #75 — a real canvas-backed text measurer instead of
// domain's character-count heuristic. Canvas access is a DOM/browser
// concern (domain must stay pure per DOMAIN-001), so it lives here in the
// hook layer and is threaded into buildPillFlow as a plain function.
// Module-level + lazily created so every usePropFlow call across the app
// reuses one canvas/context instead of allocating per render; guarded for
// SSR (Next.js may evaluate this module server-side, where `document`
// doesn't exist) by falling back to `null`, which usePropFlow below treats
// the same as "not available yet" and lets buildPillFlow's own heuristic
// default take over.
let cachedMeasureText: MeasureText | null | undefined;

function getCanvasMeasureText(): MeasureText | null {
  if (cachedMeasureText !== undefined) return cachedMeasureText;
  if (typeof document === 'undefined') return (cachedMeasureText = null);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return (cachedMeasureText = null);
  // Matches .propflow-pill's font (via Badge's .attribution-label: 700
  // weight, 0.7rem/11.2px, uppercase) closely enough for real sizing —
  // uppercased because the CSS text-transform renders pills uppercase even
  // though the label text itself is written lowercase/mixed-case.
  ctx.font = "700 11.2px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
  cachedMeasureText = (label: string) => ctx.measureText(label.toUpperCase()).width;
  return cachedMeasureText;
}

/** Derives the prop-flow diagram's pill/hierarchy layout, connecting edges,
 * and legend colors from the tree (#55, revised to a pill hierarchy by #75;
 * #77 adds real text-metrics sizing and an optional prop-value display
 * toggle) — called from the PropFlowDiagram component (components may
 * import a hook; only a direct domain/workflow/service import is banned). */
export function usePropFlow(roots: PagesEditorNode[]) {
  const [visible, setVisible] = useState(false);
  const [showValues, setShowValues] = useState(false);
  const measureText = useMemo(() => getCanvasMeasureText() ?? undefined, []);
  const { layouts, edges, colorMap } = useMemo(
    () => buildPillFlow(roots, { measureText, showValues }),
    [roots, measureText, showValues],
  );
  return {
    visible,
    toggle: () => setVisible((v) => !v),
    showValues,
    toggleShowValues: () => setShowValues((v) => !v),
    layouts,
    edges,
    colorMap,
  };
}
