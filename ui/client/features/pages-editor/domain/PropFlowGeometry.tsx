import type { PagesEditorNode } from '../types';

// Pure (DOMAIN-001) — the prop-flow diagram's pill/hierarchy geometry math,
// split out of PropFlowLayout.tsx (READ-002, ≤200 lines/file). Every node
// that has children reserves an *outgoing* pill row (one pill per distinct
// prop name any of its direct children receive — since in JSX, a child's
// attribute list is literally written by its parent), and every node
// reserves its own *received* pill row (its own named props, one level
// below whichever node's outgoing row produced them) — see PropFlowLayout
// for how those rows get connected into edges/colors.

const LEVEL_H = 112;
const GROUP_GAP = 26;
const PILL_GAP = 8;
const CHAR_W = 6.5;
const PILL_PAD = 18;
const MIN_PILL_W = 36;
const MIN_GROUP_W = 64;
// Margin reserved on every side so a pill/label sitting exactly at a node's
// own edge doesn't get visually clipped by the SVG/container boundary once
// its `translate(-50%, -50%)` centering is applied.
const PAD_X = 16;
const PAD_Y = 20;

// Row placement within a node's own depth slot (label at the top, its own
// received pills next, the pills it hands down to children at the bottom).
const ROW_Y = { label: 0, received: 24, outgoing: 50 };
const PILL_H = 22;

export function namedProps(node: PagesEditorNode): string[] {
  return node.props.filter((p) => p.kind !== 'spread').map((p) => p.name);
}

function dedupe(names: string[]): string[] {
  return [...new Set(names)];
}

function pillWidth(name: string): number {
  return Math.max(MIN_PILL_W, Math.round(name.length * CHAR_W) + PILL_PAD);
}

function rowWidth(names: string[]): number {
  if (names.length === 0) return 0;
  return names.reduce((sum, n) => sum + pillWidth(n), 0) + PILL_GAP * (names.length - 1);
}

function outgoingNames(node: PagesEditorNode): string[] {
  return dedupe(node.children.flatMap(namedProps));
}

function groupWidth(node: PagesEditorNode): number {
  const label = (node.isFragment ? '<>' : node.tag).length * CHAR_W + PILL_PAD;
  return Math.max(label, rowWidth(dedupe(namedProps(node))), rowWidth(outgoingNames(node)), MIN_GROUP_W);
}

export type PillPosition = { name: string; x: number; y: number };

export type NodeLayout = {
  node: PagesEditorNode;
  x: number; // center x of this node's slot
  y: number; // top y of this node's slot (depth * LEVEL_H)
  width: number;
  label: string;
  received: PillPosition[]; // this node's own named props (may be empty)
  outgoing: PillPosition[]; // union of names its direct children receive (may be empty)
};

function layoutRow(names: string[], centerX: number, y: number): PillPosition[] {
  const w = rowWidth(names);
  let x = centerX - w / 2;
  const result: PillPosition[] = [];
  for (const name of names) {
    const pw = pillWidth(name);
    result.push({ name, x: x + pw / 2, y });
    x += pw + PILL_GAP;
  }
  return result;
}

/** A node's own pill/label content can be *wider* than its children
 * collectively are (e.g. a parent handing down 4 differently-named props to
 * two narrow leaf children) — so simple bottom-up centering (a parent's x
 * is just the midpoint of its children) isn't enough; it lets a wide parent
 * row overhang past the horizontal space its children actually reserved,
 * clipping against the diagram's edge. This does it in two passes instead,
 * like a standard tree layout: bottom-up, reserve each subtree at least as
 * much width as its own content needs (own group width, or its children's
 * reserved widths summed, whichever is bigger); top-down, place each node
 * centered within its reserved span, and center its children as a block
 * within that same span. */
function subtreeWidths(roots: PagesEditorNode[]): Map<string, number> {
  const widths = new Map<string, number>();
  const compute = (node: PagesEditorNode): number => {
    const own = groupWidth(node);
    const childrenWidth =
      node.children.length === 0
        ? 0
        : node.children.reduce((sum, c) => sum + compute(c), 0) + GROUP_GAP * (node.children.length - 1);
    const width = Math.max(own, childrenWidth);
    widths.set(node.id, width);
    return width;
  };
  for (const r of roots) compute(r);
  return widths;
}

/** Lays out every node in the tree into a pill hierarchy: one row of
 * "outgoing" pills per parent, one row of "received" pills per child, one
 * level of depth apart — each slot's reserved width comes from
 * subtreeWidths above, its actual pill content from groupWidth, instead of
 * #55's fixed node-box size. */
export function layoutPillHierarchy(roots: PagesEditorNode[]): Map<string, NodeLayout> {
  const widths = subtreeWidths(roots);
  const layouts = new Map<string, NodeLayout>();
  const place = (node: PagesEditorNode, startX: number, depth: number): void => {
    const totalW = widths.get(node.id)!;
    const centerX = startX + totalW / 2;
    const y = depth * LEVEL_H + PAD_Y;
    layouts.set(node.id, {
      node,
      x: centerX,
      y,
      width: groupWidth(node),
      label: node.isFragment ? '<>' : node.tag,
      received: layoutRow(dedupe(namedProps(node)), centerX, y + ROW_Y.received),
      outgoing: layoutRow(outgoingNames(node), centerX, y + ROW_Y.outgoing),
    });
    if (node.children.length === 0) return;
    const childrenTotal =
      node.children.reduce((sum, c) => sum + widths.get(c.id)!, 0) + GROUP_GAP * (node.children.length - 1);
    let childStart = startX + (totalW - childrenTotal) / 2;
    for (const child of node.children) {
      place(child, childStart, depth + 1);
      childStart += widths.get(child.id)! + GROUP_GAP;
    }
  };
  let rootStart = PAD_X;
  for (const r of roots) {
    place(r, rootStart, 0);
    rootStart += widths.get(r.id)! + GROUP_GAP;
  }
  return layouts;
}
