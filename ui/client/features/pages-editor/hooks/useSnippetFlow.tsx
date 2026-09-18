'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { buildSnippetFlowGraph, type SnippetFlowNode, type SnippetFlowNodeData } from '../domain/SnippetFlowGraph';
import { parseSnippetTree, rewireSnippetWire } from '../services/SnippetFlowApi';
import { removeSnippetNode, moveSnippetNode, addSnippetChild } from '../services/SnippetStructureApi';
import type { PagesEditorNode } from '../types';

// Re-exported so components (e.g. JsxFlowNode) can type against the graph's
// node-data shape without importing the domain module directly —
// COMPONENT-003 only allows a component to import a hook.
export type { SnippetFlowNodeData } from '../domain/SnippetFlowGraph';

/** Ticket F.3 (#122, epic #119) follow-up — the per-node toolbar actions
 * JsxFlowNode renders, attached to each node's `data` here (in the hook
 * layer, which is allowed to hold closures/React state) rather than in
 * domain's buildSnippetFlowGraph (which stays a pure, closure-free
 * transform per DOMAIN-001). `canRemove` is false only for the snippet's
 * own single root — a hard structural rule, not a runtime edge case — the
 * other three actions are always offered and rely on the same server-side
 * validation + inline-error pattern #121 already established (already at
 * the first/last sibling, or a self-closing element for add-child). */
export type NodeToolbarActions = {
  canRemove: boolean;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onAddChild: () => void;
};

export type InteractiveNodeData = SnippetFlowNodeData & NodeToolbarActions;
export type InteractiveFlowNode = Omit<SnippetFlowNode, 'data'> & { data: InteractiveNodeData };

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
 *
 * Ticket F.3 (#122, epic #119) follow-up: `nodes` also carry a per-node
 * toolbar (`removeNode`/`moveNode`/`addChild`, reusing the same
 * `wireError` inline-message state #121 introduced rather than a second
 * one — these are all "snippet edit failed" the same way a bad rewire is).
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
  const rootId = roots[0]?.id;

  async function rewireWire(parentId: string, propName: string, fromChildId: string, toChildId: string) {
    setWireError(null);
    const result = await rewireSnippetWire({ snippet, parentId, propName, fromChildId, toChildId });
    if (!result.ok || !result.snippet) {
      setWireError(result.error || 'That rewire is not supported.');
      return;
    }
    onSnippetChange(result.snippet);
  }

  async function removeNode(nodeId: string) {
    setWireError(null);
    const result = await removeSnippetNode({ snippet, nodeId });
    if (!result.ok || !result.snippet) {
      setWireError(result.error || 'That node cannot be removed.');
      return;
    }
    onSnippetChange(result.snippet);
  }

  async function moveNode(nodeId: string, direction: 'up' | 'down') {
    setWireError(null);
    const result = await moveSnippetNode({ snippet, nodeId, direction });
    if (!result.ok || !result.snippet) {
      setWireError(result.error || 'That node cannot be moved.');
      return;
    }
    onSnippetChange(result.snippet);
  }

  async function addChild(parentId: string) {
    setWireError(null);
    const result = await addSnippetChild({ snippet, parentId });
    if (!result.ok || !result.snippet) {
      setWireError(result.error || 'A child cannot be added there.');
      return;
    }
    onSnippetChange(result.snippet);
  }

  const nodes: InteractiveFlowNode[] = graph.nodes.map((node) => ({
    ...node,
    data: {
      ...node.data,
      canRemove: node.id !== rootId,
      onRemove: () => removeNode(node.id),
      onMoveUp: () => moveNode(node.id, 'up'),
      onMoveDown: () => moveNode(node.id, 'down'),
      onAddChild: () => addChild(node.id),
    },
  }));

  return { roots, nodes, edges: graph.edges, parseError, wireError, rewireWire };
}
