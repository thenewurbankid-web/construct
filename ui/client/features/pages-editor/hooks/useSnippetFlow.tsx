'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { buildSnippetFlowGraph } from '../domain/SnippetFlowGraph';
import { parseSnippetTree } from '../services/SnippetApi';
import type { PagesEditorNode } from '../types';

// Re-exported so components (e.g. JsxFlowNode) can type against the graph's
// node-data shape without importing the domain module directly —
// COMPONENT-003 only allows a component to import a hook.
export type { SnippetFlowNodeData } from '../domain/SnippetFlowGraph';

const PARSE_DEBOUNCE_MS = 250;

/**
 * Ticket F.1 (#120, epic #119) — derives the visual composer's React Flow
 * graph by re-parsing the snippet's own *live* text on every change
 * (debounced), never a cached/persisted layout — #119's constraint 1. Takes
 * the exact same `snippet` string useSnippetEditor already holds as local
 * state (the text the user is actively editing), not the page-level tree
 * fetched once when the file was opened, so the canvas always reflects
 * unsaved in-progress edits too. Called directly from SnippetFlowCanvas — a
 * component may import a hook; only the hook may reach into domain/services
 * (COMPONENT-003).
 */
export function useSnippetFlow(snippet: string) {
  const [roots, setRoots] = useState<PagesEditorNode[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    const id = ++requestId.current;
    const timer = setTimeout(() => {
      parseSnippetTree(snippet).then((r) => {
        if (id !== requestId.current) return; // a newer keystroke already superseded this request
        setRoots(r.roots || []);
        setParseError(r.error ?? null);
      });
    }, PARSE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [snippet]);

  const graph = useMemo(() => buildSnippetFlowGraph(roots), [roots]);

  return { roots, nodes: graph.nodes, edges: graph.edges, parseError };
}
