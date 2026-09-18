'use client';

import { ReactFlow, Background, Controls, type NodeTypes } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useSnippetFlow } from '../hooks/useSnippetFlow';
import { JsxFlowNode } from './JsxFlowNode';

const NODE_TYPES: NodeTypes = { jsxNode: JsxFlowNode };

type SnippetFlowCanvasProps = { snippet: string };

// Ticket F.1 (#120, epic #119) — read-only React Flow canvas over the
// snippet's live AST-derived structure (usePropFlow's underlying layout,
// reshaped for React Flow by useSnippetFlow/SnippetFlowGraph). Node
// positions are purely derived from the current parse and never persisted
// (#119 constraint 1 — no metadata in the filesystem), so dragging a node
// around would just snap back on the next re-parse; disabled outright here
// rather than offering a drag that silently does nothing durable.
// Calls only the hook (COMPONENT-003 — a component may import a hook, never
// domain/services/workflows directly).
export function SnippetFlowCanvas({ snippet }: SnippetFlowCanvasProps) {
  const { nodes, edges, parseError } = useSnippetFlow(snippet);

  return (
    <div className="snippet-flow-canvas">
      {parseError && <p className="status-error snippet-flow-error">Can&apos;t render the diagram — {parseError}</p>}
      {!parseError && nodes.length === 0 && <p className="hint">Nothing to visualize yet.</p>}
      <div className="snippet-flow-viewport">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          nodesDraggable={false}
          nodesConnectable={false}
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
