import dagre from '@dagrejs/dagre';
import type { GraphLayer, LineGraph, MapPicture, PlacedNode } from '@/lib/lineKnowsContract';
import { isCrossFeature, indexGraph } from './MapSentences.ts';

// Pure (DOMAIN-001): the picture around one item, laid out by dagre (MIT, no randomness: the same graph always gives
// the same picture). Only the item, its direct neighbours on the layers that are on and, for a feature, its items.
// Membership edges (IN_FEATURE, IN_LIBRARY) are left out of the picture: the sentences say them.

const HIDDEN = new Set(['IN_FEATURE', 'IN_LIBRARY']);
const W_CHAR = 7.2;

/** The picture of `focus` and its neighbours. Empty when the focus is unknown. */
export function mapPicture(g: LineGraph, focus: string, layers: GraphLayer[]): MapPicture {
  const ix = indexGraph(g);
  const center = ix.byId.get(focus);
  if (!center) return { nodes: [], edges: [], width: 0, height: 0 };
  const on = new Set(layers);
  const keep = new Set([focus]);
  if (center.kind === 'feature') for (const e of ix.inn.get(focus) ?? []) if (e.type === 'IN_FEATURE') keep.add(e.from);
  const core = [...keep];
  const edges = g.edges.filter((e) => on.has(e.layer) && !HIDDEN.has(e.type) && (core.includes(e.from) || core.includes(e.to)));
  for (const e of edges) { keep.add(e.from); keep.add(e.to); }
  const flagged = new Set(g.edges.filter((e) => e.type === 'FLAGS').map((e) => e.to));
  const lay = new dagre.graphlib.Graph({ multigraph: true });
  lay.setGraph({ rankdir: 'LR', nodesep: 18, ranksep: 60, marginx: 8, marginy: 8 });
  lay.setDefaultEdgeLabel(() => ({}));
  for (const id of keep) {
    const label = ix.byId.get(id)?.label ?? id;
    lay.setNode(id, { width: Math.min(220, Math.max(70, label.length * W_CHAR + 24)), height: 32 });
  }
  const seen = new Set<string>();
  const shown = edges.filter((e) => { const k = `${e.from}>${e.to}`; if (seen.has(k)) return false; seen.add(k); return true; });
  for (const e of shown) lay.setEdge(e.from, e.to, {}, `${e.from}>${e.to}`);
  dagre.layout(lay);
  const nodes: PlacedNode[] = [...keep].sort().map((id) => {
    const p = lay.node(id);
    const n = ix.byId.get(id);
    const area = n?.attrs?.area === 'library' || n?.kind === 'library' ? 'library' : n?.attrs?.area === 'feature' || n?.kind === 'feature' ? 'feature' : 'other';
    return { id, label: (n?.label ?? id).slice(0, 30), kind: n?.kind ?? 'item', area, x: p.x, y: p.y, width: p.width, height: p.height, focus: id === focus, flagged: flagged.has(id) };
  });
  const placed = shown.map((e) => ({ from: e.from, to: e.to, type: e.type, layer: e.layer, points: (lay.edge(e.from, e.to, `${e.from}>${e.to}`)?.points ?? []).map((q: { x: number; y: number }) => ({ x: q.x, y: q.y })), bad: isCrossFeature(ix, e) || e.type === 'FLAGS' }));
  const info = lay.graph();
  return { nodes, edges: placed, width: Math.ceil(info.width ?? 0), height: Math.ceil(info.height ?? 0) };
}
