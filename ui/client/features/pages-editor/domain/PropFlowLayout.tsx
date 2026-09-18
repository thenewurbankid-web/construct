import type { PagesEditorNode } from '../types';
import { findRenameLinks, buildRenameUnionFind } from './PropFlowRename';
import { layoutPillHierarchy } from './PropFlowGeometry';
import type { NodeLayout, PillPosition, GeometryOptions } from './PropFlowGeometry';

// Pill height in px — must match PropFlowGeometry's own (unexported) copy,
// used there for row-y placement and here for edge endpoint offsets. Kept
// as a small local duplicate rather than a cross-file export so
// PropFlowGeometry stays within MODULE-001's 3-primary-exports-per-file
// budget (`layoutPillHierarchy` + `namedProps` already use it).
const PILL_H = 22;

// Pure (DOMAIN-001) — the prop-flow diagram's edge-building and color
// assignment. #75 revises #55's flat "colored edge per node-box" diagram
// into a real pill/hierarchy view (geometry in ./PropFlowGeometry.tsx):
// lines connect an outgoing pill to every same-named received pill one
// level down (fan-out when more than one child uses that name); #77 adds
// cross-level rename tracing (./PropFlowRename.tsx) on top of that.

export type { NodeLayout, PillPosition } from './PropFlowGeometry';
export { layoutPillHierarchy } from './PropFlowGeometry';

const PALETTE = ['#5b8cff', '#3fae5a', '#d98c2b', '#e05a5a', '#b25be0', '#2bc4d9', '#e0c62b', '#e05ba0'];

export function colorFor(name: string, map: Map<string, string>): string {
  if (!map.has(name)) map.set(name, PALETTE[map.size % PALETTE.length]);
  return map.get(name)!;
}

// Line endpoints, in pixels, already offset to the pill's own top/bottom
// edge (not its center) — precomputed here so the component only ever
// renders an <svg><line> without needing to import layout constants
// (COMPONENT-003: components render props/hook output, not domain internals).
// `traced: true` marks the #77 rename-tracing edges below (a same-node
// received-pill -> outgoing-pill connector, not a cross-level one) so the
// component/tests can style or assert on them distinctly.
export type PillEdge = { x1: number; y1: number; x2: number; y2: number; color: string; traced?: boolean };

/** Builds the hierarchy layout plus one line per (parent outgoing pill,
 * child received pill) pair that share a prop name — fanning out from a
 * single outgoing pill when more than one child receives that name — plus
 * (#77) one same-node connector edge per traced rename link, and colors
 * that group renamed pill names together instead of purely by literal
 * name. */
export function buildPillFlow(
  roots: PagesEditorNode[],
  options: GeometryOptions = {},
): {
  layouts: Map<string, NodeLayout>;
  edges: PillEdge[];
  colorMap: Map<string, string>;
} {
  const layouts = layoutPillHierarchy(roots, options);
  const colorMap = new Map<string, string>();
  const edges: PillEdge[] = [];

  const renameLinks = findRenameLinks(roots);
  const uf = buildRenameUnionFind(renameLinks);

  // Color by canonical (traced) group, then also register the color under
  // every literal name in that group — so `colorMap.get(<literal pill
  // name>)` (used by both the legend and PropFlowDiagram's pill rendering)
  // keeps working unchanged, but renamed names resolve to the same color.
  const colorForTraced = (name: string): string => {
    const canonical = uf.canonical(name);
    const color = colorFor(canonical, colorMap);
    colorMap.set(name, color);
    return color;
  };

  for (const layout of layouts.values()) {
    for (const outPill of layout.outgoing) colorForTraced(outPill.name);
  }

  for (const layout of layouts.values()) {
    if (layout.node.children.length === 0) continue;
    for (const child of layout.node.children) {
      const childLayout = layouts.get(child.id);
      if (!childLayout) continue;
      for (const outPill of layout.outgoing) {
        const toPill = childLayout.received.find((p) => p.name === outPill.name);
        if (!toPill) continue;
        edges.push({
          x1: outPill.x,
          y1: outPill.y + PILL_H / 2,
          x2: toPill.x,
          y2: toPill.y - PILL_H / 2,
          color: colorForTraced(outPill.name),
        });
      }
    }
  }

  for (const link of renameLinks) {
    const layout = layouts.get(link.node.id);
    if (!layout) continue;
    const fromPill = layout.received.find((p) => p.name === link.receivedName);
    const toPill = layout.outgoing.find((p) => p.name === link.outgoingAttrName);
    if (!fromPill || !toPill) continue;
    edges.push({
      x1: fromPill.x,
      y1: fromPill.y + PILL_H / 2,
      x2: toPill.x,
      y2: toPill.y - PILL_H / 2,
      color: colorForTraced(link.receivedName),
      traced: true,
    });
  }

  return { layouts, edges, colorMap };
}
