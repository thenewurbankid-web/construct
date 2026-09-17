'use client';

import { useMemo, useState } from 'react';
import { buildFlowEdges } from '../domain/PropFlowLayout';
import type { PagesEditorNode } from '../types';

/** Derives the prop-flow diagram's layout/edges/legend from the tree (#55) —
 * called from the PropFlowDiagram component (components may import a hook;
 * only a direct domain/workflow/service import is banned). */
export function usePropFlow(roots: PagesEditorNode[]) {
  const [visible, setVisible] = useState(false);
  const { positions, edges, colorMap } = useMemo(() => buildFlowEdges(roots), [roots]);
  return { visible, toggle: () => setVisible((v) => !v), positions, edges, colorMap };
}
