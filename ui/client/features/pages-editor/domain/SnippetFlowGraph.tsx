import type { PagesEditorNode } from '../types';
import { layoutPillHierarchy } from './PropFlowGeometry';
import { colorFor } from './PropFlowLayout';

// Ticket F.1 (#120, epic #119) — pure (DOMAIN-001) transform from the
// already-parsed JSX node tree into React Flow's (@xyflow/react) node/edge
// model. Reuses PropFlowGeometry's layoutPillHierarchy (#75/#77) for
// positions/pill placement instead of re-deriving structure a second way,
// per the epic's own instruction to adapt the existing AST-derived layout
// rather than recompute it. Nothing here touches the DOM/network/disk —
// same input (a PagesEditorNode[] tree), same output shape, every render.

export type FlowPill = { id: string; name: string; label: string; color: string; offset: number };

export type SnippetFlowNodeData = {
  label: string;
  isFragment: boolean;
  isCustomComponent: boolean;
  width: number;
  received: FlowPill[];
  outgoing: FlowPill[];
};

export type SnippetFlowNode = { id: string; type: 'jsxNode'; position: { x: number; y: number }; data: SnippetFlowNodeData };

export type SnippetFlowEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle: string;
  targetHandle: string;
  label: string;
  data: { propName: string; parentId: string; childId: string };
};

/** Handle id prefixes — shared between here and the JsxFlowNode renderer so
 * an edge's sourceHandle/targetHandle always matches a Handle id the node
 * actually rendered. */
export const RECEIVED_HANDLE_PREFIX = 'in:';
export const OUTGOING_HANDLE_PREFIX = 'out:';

export function buildSnippetFlowGraph(roots: PagesEditorNode[]): { nodes: SnippetFlowNode[]; edges: SnippetFlowEdge[] } {
  const layouts = layoutPillHierarchy(roots);
  const colorMap = new Map<string, string>();
  const nodes: SnippetFlowNode[] = [];
  const edges: SnippetFlowEdge[] = [];

  for (const layout of layouts.values()) {
    const boxLeft = layout.x - layout.width / 2;
    nodes.push({
      id: layout.node.id,
      type: 'jsxNode',
      position: { x: boxLeft, y: layout.y },
      data: {
        label: layout.label,
        isFragment: layout.node.isFragment,
        isCustomComponent: layout.node.isCustomComponent,
        width: layout.width,
        received: layout.received.map((p) => ({
          id: `${RECEIVED_HANDLE_PREFIX}${p.name}`,
          name: p.name,
          label: p.label,
          color: colorFor(p.name, colorMap),
          offset: p.x - boxLeft,
        })),
        outgoing: layout.outgoing.map((p) => ({
          id: `${OUTGOING_HANDLE_PREFIX}${p.name}`,
          name: p.name,
          label: p.label,
          color: colorFor(p.name, colorMap),
          offset: p.x - boxLeft,
        })),
      },
    });
  }

  // Same match rule as PropFlowLayout.buildPillFlow: one edge per (parent's
  // outgoing pill, child's same-named received pill) pair — just emitting
  // node/handle references here instead of pixel line coordinates.
  for (const layout of layouts.values()) {
    for (const child of layout.node.children) {
      const childLayout = layouts.get(child.id);
      if (!childLayout) continue;
      for (const outPill of layout.outgoing) {
        const toPill = childLayout.received.find((p) => p.name === outPill.name);
        if (!toPill) continue;
        edges.push({
          id: `e:${layout.node.id}:${child.id}:${outPill.name}`,
          source: layout.node.id,
          sourceHandle: `${OUTGOING_HANDLE_PREFIX}${outPill.name}`,
          target: child.id,
          targetHandle: `${RECEIVED_HANDLE_PREFIX}${outPill.name}`,
          label: outPill.name,
          data: { propName: outPill.name, parentId: layout.node.id, childId: child.id },
        });
      }
    }
  }

  return { nodes, edges };
}
