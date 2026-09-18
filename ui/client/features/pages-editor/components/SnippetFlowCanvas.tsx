'use client';

import { useCallback } from 'react';
import { ReactFlow, Background, Controls, type NodeTypes, type Edge, type Connection } from '@xyflow/react';
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
export function SnippetFlowCanvas({ snippet, onSnippetChange }: SnippetFlowCanvasProps) {
  const { nodes, edges, parseError, wireError, rewireWire } = useSnippetFlow(snippet, onSnippetChange);

  const handleReconnect = useCallback(
    (oldEdge: WireEdge, newConnection: Connection) => {
      const { propName, parentId, childId: fromChildId } = oldEdge.data!;
      if (newConnection.source !== parentId) return; // dragging the parent-side endpoint isn't supported (F.2 scope)
      if (!newConnection.target || newConnection.target === fromChildId) return; // dropped back where it was, or nowhere
      rewireWire(parentId, propName, fromChildId, newConnection.target);
    },
    [rewireWire],
  );

  return (
    <div className="snippet-flow-canvas">
      {parseError && <p className="status-error snippet-flow-error">Can&apos;t render the diagram — {parseError}</p>}
      {!parseError && nodes.length === 0 && <p className="hint">Nothing to visualize yet.</p>}
      {wireError && <p className="status-error snippet-flow-wire-error">{wireError}</p>}
      <div className="snippet-flow-viewport">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          nodesDraggable={false}
          nodesConnectable
          edgesReconnectable
          onReconnect={handleReconnect}
          elementsSelectable={false}
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  );
}
