'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { buildSnippetFlowGraph } from '../domain/SnippetFlowGraph';
import { parseSnippetTree, rewireSnippetWire } from '../services/SnippetFlowApi';
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
 *
 * Ticket F.2 (#121, epic #119) follow-up: also exposes `rewireWire`, called
 * from the canvas's onReconnect handler when a wire's child-side endpoint is
 * dragged onto a different sibling. On success the new snippet text is
 * handed to `onSnippetChange` (wired to useSnippetEditor's `setSnippet` +
 * `requestSave`, so it lands in the existing diff-preview-before-save flow
 * rather than a second write path) — on rejection, `wireError` carries the
 * inline message and the snippet is left untouched.
 */
export function useSnippetFlow(snippet: string, onSnippetChange: (next: string) => void) {
  const [roots, setRoots] = useState<PagesEditorNode[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [wireError, setWireError] = useState<string | null>(null);
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

  async function rewireWire(parentId: string, propName: string, fromChildId: string, toChildId: string) {
    setWireError(null);
    const result = await rewireSnippetWire({ snippet, parentId, propName, fromChildId, toChildId });
    if (!result.ok || !result.snippet) {
      setWireError(result.error || 'That rewire is not supported.');
      return;
    }
    onSnippetChange(result.snippet);
  }

  return { roots, nodes: graph.nodes, edges: graph.edges, parseError, wireError, rewireWire };
}
