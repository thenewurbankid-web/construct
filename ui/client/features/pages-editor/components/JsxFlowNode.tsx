import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import type { InteractiveNodeData } from '../hooks/useSnippetFlow';

// Ticket F.1 (#120, epic #119) — one JSX element/fragment as a React Flow
// node: its tag as the label, its own received props as target handles
// along the top edge, the props it hands down to children as source
// handles along the bottom edge — same pill data PropFlowDiagram already
// renders, just as React Flow handles instead of absolutely-positioned
// pills, so a wire can actually be dragged (F.2) instead of only drawn.
// Imports the node-data type from the hook layer, not domain directly
// (COMPONENT-003 — a component may import a hook, never domain/services/
// workflows itself; useSnippetFlow re-exports the type it hands back).
// Ticket F.2 (#121, epic #119) follow-up — one additional, always-present
// "drop zone" target handle (`in:*`) covering the node's label area, so a
// wire can be rewired onto a sibling that doesn't already expose a same-
// named handle to aim at. Rendered first (so the visible named handles/
// label stack above it) and fully transparent — real per-name handles stay
// individually targetable too, for a node that happens to already have one.
// Ticket F.3 (#122) follow-up — stops above the toolbar row (`bottom`
// instead of a full `height: 100%`) so its own buttons stay clickable
// instead of the wildcard intercepting pointer events meant for them.
export const WILDCARD_RECEIVED_HANDLE = 'in:*';
const TOOLBAR_RESERVED_HEIGHT = 28;

export function JsxFlowNode({ data, isConnectable }: NodeProps<JsxNodeType>) {
  return (
    <div className={`jsx-flow-node${data.isCustomComponent ? ' component' : ''}`} style={{ width: data.width }}>
      <Handle
        id={WILDCARD_RECEIVED_HANDLE}
        type="target"
        position={Position.Top}
        isConnectable={isConnectable}
        className="jsx-flow-handle-wildcard"
        style={{ left: 0, top: 0, right: 0, bottom: TOOLBAR_RESERVED_HEIGHT, width: 'auto', height: 'auto', transform: 'none', borderRadius: 6 }}
      />
      {data.received.map((p) => (
        <Handle
          key={p.id}
          id={p.id}
          type="target"
          position={Position.Top}
          isConnectable={isConnectable}
          style={{ left: p.offset, background: p.color, borderColor: p.color }}
          className="jsx-flow-handle jsx-flow-handle-received"
          title={p.label}
        />
      ))}
      <div className="jsx-flow-node-label">{data.isFragment ? '<>' : `<${data.label}>`}</div>
      {/* Ticket F.3 (#122, epic #119) — per-node structural toolbar. `nodrag
          nopan` (React Flow's own opt-out classes) keep a click here from
          being read as a canvas pan/node-drag gesture. */}
      <div className="jsx-flow-node-toolbar nodrag nopan">
        <button type="button" title="Move up" onClick={data.onMoveUp}>
          ↑
        </button>
        <button type="button" title="Move down" onClick={data.onMoveDown}>
          ↓
        </button>
        <button type="button" title="Add child <div />" onClick={data.onAddChild}>
          +
        </button>
        {data.canRemove && (
          <button type="button" title="Remove" onClick={data.onRemove}>
            ×
          </button>
        )}
      </div>
      {data.outgoing.map((p) => (
        <Handle
          key={p.id}
          id={p.id}
          type="source"
          position={Position.Bottom}
          isConnectable={isConnectable}
          style={{ left: p.offset, background: p.color, borderColor: p.color }}
          className="jsx-flow-handle jsx-flow-handle-outgoing"
          title={p.label}
        />
      ))}
    </div>
  );
}

export type JsxNodeType = Node<InteractiveNodeData, 'jsxNode'>;
