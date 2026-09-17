import type { PagesEditorNode } from '../types';
import { flattenParentOf } from './TreeNodes';

// Pure (DOMAIN-001) — the prop-flow diagram's layout math.

const PALETTE = ['#5b8cff', '#3fae5a', '#d98c2b', '#e05a5a', '#b25be0', '#2bc4d9', '#e0c62b', '#e05ba0'];

export function colorFor(name: string, map: Map<string, string>): string {
  if (!map.has(name)) map.set(name, PALETTE[map.size % PALETTE.length]);
  return map.get(name)!;
}

export type NodePosition = { x: number; y: number; node: PagesEditorNode };

export function layoutTree(roots: PagesEditorNode[]): Map<string, NodePosition> {
  const positions = new Map<string, NodePosition>();
  let nextX = 0;
  const NODE_W = 130;
  const NODE_H = 70;
  const visit = (node: PagesEditorNode, depth: number): number => {
    if (node.children.length === 0) {
      positions.set(node.id, { x: nextX * NODE_W, y: depth * NODE_H, node });
      nextX += 1;
      return positions.get(node.id)!.x;
    }
    const childXs = node.children.map((c) => visit(c, depth + 1));
    const x = (Math.min(...childXs) + Math.max(...childXs)) / 2;
    positions.set(node.id, { x, y: depth * NODE_H, node });
    return x;
  };
  for (const r of roots) visit(r, 0);
  return positions;
}

export type FlowEdge = { from: NodePosition; to: NodePosition; prop: string; color: string; offset: number };

export function buildFlowEdges(roots: PagesEditorNode[]): { positions: Map<string, NodePosition>; edges: FlowEdge[]; colorMap: Map<string, string> } {
  const positions = layoutTree(roots);
  const colorMap = new Map<string, string>();
  const edges: FlowEdge[] = [];
  const parentOf = flattenParentOf(roots);
  for (const [id, pos] of positions) {
    const parentId = parentOf.get(id);
    if (!parentId) continue;
    const parentPos = positions.get(parentId);
    if (!parentPos) continue;
    const namedProps = pos.node.props.filter((p) => p.kind !== 'spread');
    namedProps.forEach((p, i) => {
      edges.push({ from: parentPos, to: pos, prop: p.name, color: colorFor(p.name, colorMap), offset: i });
    });
  }
  return { positions, edges, colorMap };
}
