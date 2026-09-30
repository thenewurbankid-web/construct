'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ReactFlow, Background, Controls, type NodeTypes, type Edge, type Connection, type EdgeMouseHandler } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useSnippetFlow } from '../hooks/useSnippetFlow';
import { JsxFlowNode } from './JsxFlowNode';

const NODE_TYPES: NodeTypes = { jsxNode: JsxFlowNode };

type SnippetFlowCanvasProps = { snippet: string; onSnippetChange: (next: string) => void };

type WireEdge = Edge<{ propName: string; parentId: string; childId: string }>;

// Ticket F.1 (#120)/F.2 (#121, epic #119) — React Flow canvas over the
// snippet's live AST-derived structure (usePropFlow's underlying layout,
// reshaped for React Flow by useSnippetFlow/SnippetFlowGraph). Node
// positions are purely derived from the current parse and never persisted
// (#119 constraint 1 — no metadata in the filesystem), so dragging a node
// around would just snap back on the next re-parse; nodesDraggable stays
// off permanently. Wires *are* draggable (F.2): dragging an existing
// wire's child-side endpoint onto a different sibling calls the hook's
// rewireWire, which computes the real source-text edit and hands it to
// the existing save-back-to-source + diff-preview flow — an invalid drag
// (cross-parent, name collision, stale ids) shows inline instead of
// writing anything. Calls only the hook (COMPONENT-003 — a component may
// import a hook, never domain/services/workflows directly).
//
// LIN-162 follow-up — click-to-pick-up/click-to-drop, alongside (not instead
// of) F.2's drag-and-hold: React Flow has no native click-reconnect, so
// which wire is "carried" is plain component state here, not in the hook —
// it's ephemeral UI state, not derived snippet data. Clicking a wire carries
// it (highlighting every other node as a drop target); clicking a target
// commits through the *same* rewireWire the drag path uses; clicking the
// carried wire again, the canvas background, or Escape cancels without
// writing. An invalid drop (cross-parent, name collision, stale id) surfaces
// the existing inline wireError and leaves the wire carried, rather than
// silently dropping it nowhere.
export function SnippetFlowCanvas({ snippet, onSnippetChange }: SnippetFlowCanvasProps) {
  const { nodes, edges, parseError, wireError, rewireWire } = useSnippetFlow(snippet, onSnippetChange);
  const [carriedEdge, setCarriedEdge] = useState<WireEdge | null>(null);

  const handleReconnect = useCallback(
    (oldEdge: WireEdge, newConnection: Connection) => {
      const { propName, parentId, childId: fromChildId } = oldEdge.data!;
      if (newConnection.source !== parentId) return; // dragging the parent-side endpoint isn't supported (F.2 scope)
      if (!newConnection.target || newConnection.target === fromChildId) return; // dropped back where it was, or nowhere
      rewireWire(parentId, propName, fromChildId, newConnection.target);
    },
    [rewireWire],
  );

  const handleEdgeClick = useCallback<EdgeMouseHandler<WireEdge>>((event, edge) => {
    event.stopPropagation();
    setCarriedEdge((current) => (current?.id === edge.id ? null : edge));
  }, []);

  const handlePaneClick = useCallback(() => setCarriedEdge(null), []);

  useEffect(() => {
    if (!carriedEdge) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setCarriedEdge(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [carriedEdge]);

  const handleDropTargetClick = useCallback(
    (targetNodeId: string) => {
      if (!carriedEdge?.data) return;
      const { propName, parentId, childId: fromChildId } = carriedEdge.data;
      if (targetNodeId === fromChildId) {
        setCarriedEdge(null); // dropped back where it started — a no-op, same as the drag path
        return;
      }
      rewireWire(parentId, propName, fromChildId, targetNodeId).then((ok) => {
        if (ok) setCarriedEdge(null);
        // else: keep the wire carried, wireError already shows the inline reason
      });
    },
    [carriedEdge, rewireWire],
  );

  const canvasNodes = useMemo(
    () =>
      nodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          isDropTarget: !!carriedEdge && node.id !== carriedEdge.data?.childId,
          onDropTargetClick: carriedEdge ? () => handleDropTargetClick(node.id) : undefined,
        },
      })),
    [nodes, carriedEdge, handleDropTargetClick],
  );

  const canvasEdges = useMemo(
    () => edges.map((edge) => (edge.id === carriedEdge?.id ? { ...edge, className: 'wire-carried', zIndex: 1000 } : edge)),
    [edges, carriedEdge],
  );

  return (
    <div className="snippet-flow-canvas">
      {parseError && <p className="status-error snippet-flow-error">Can&apos;t render the diagram — {parseError}</p>}
      {!parseError && nodes.length === 0 && <p className="hint">Nothing to visualize yet.</p>}
      {wireError && <p className="status-error snippet-flow-wire-error">{wireError}</p>}
      <div className="snippet-flow-viewport">
        <ReactFlow
          nodes={canvasNodes}
          edges={canvasEdges}
          nodeTypes={NODE_TYPES}
          nodesDraggable={false}
          nodesConnectable
          edgesReconnectable
          onReconnect={handleReconnect}
          onEdgeClick={handleEdgeClick}
          onPaneClick={handlePaneClick}
          fitView
          proOptions={{ hideAttribution: true }}
          colorMode="dark"
        >
          <Background />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  );
}
