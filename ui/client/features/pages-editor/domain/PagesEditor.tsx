import type { PagesEditorNode, PropData } from '../types';

// Pure (DOMAIN-001) — every helper below only ever reads/derives from the
// parsed tree data it's given, never touches fetch/window/etc.

export function findNode(roots: PagesEditorNode[], id: string): PagesEditorNode | null {
  for (const r of roots) {
    if (r.id === id) return r;
    const hit = findNode(r.children, id);
    if (hit) return hit;
  }
  return null;
}

/** Maps a node's own id to its *parent's id* (or null for a root). */
export function flattenParentOf(roots: PagesEditorNode[]): Map<string, string | null> {
  const parentOf = new Map<string, string | null>();
  const walk = (nodes: PagesEditorNode[], parentId: string | null) => {
    for (const n of nodes) {
      parentOf.set(n.id, parentId);
      walk(n.children, n.id);
    }
  };
  walk(roots, null);
  return parentOf;
}

export function propLabel(p: PropData): string {
  if (p.kind === 'spread') return `{...${p.value}}`;
  if (p.kind === 'boolean' && p.value === true) return p.name;
  if (p.kind === 'string') return `${p.name}="${p.value}"`;
  return `${p.name}={${p.value}}`;
}

export function propInputKind(p: PropData): 'string' | 'number' | 'boolean' | 'expression' {
  if (p.kind === 'string' || p.kind === 'number' || p.kind === 'boolean') return p.kind;
  return 'expression'; // identifier/expression both edited as raw code
}

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
