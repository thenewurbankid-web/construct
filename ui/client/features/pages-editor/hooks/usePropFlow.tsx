'use client';

import { useMemo, useState } from 'react';
import { buildPillFlow } from '../domain/PropFlowLayout';
import type { PagesEditorNode } from '../types';

/** Derives the prop-flow diagram's pill/hierarchy layout, connecting edges,
 * and legend colors from the tree (#55, revised to a pill hierarchy by #75)
 * — called from the PropFlowDiagram component (components may import a
 * hook; only a direct domain/workflow/service import is banned). */
export function usePropFlow(roots: PagesEditorNode[]) {
  const [visible, setVisible] = useState(false);
  const { layouts, edges, colorMap } = useMemo(() => buildPillFlow(roots), [roots]);
  return { visible, toggle: () => setVisible((v) => !v), layouts, edges, colorMap };
}
