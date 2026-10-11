import type { Diagram, DiagramEdge, DiagramNode, LineWorkflow } from '../types';

const W = 150;
const H = 48;
const GAP_X = 90;
const GAP_Y = 36;
const PAD = 24;

/** Each state's column: its distance from the first state along the transitions; states never reached go last. */
function columns(w: LineWorkflow): Map<string, number> {
  const col = new Map<string, number>();
  const start = w.initial ?? w.states[0]?.id;
  if (start) col.set(start, 0);
  const queue = start ? [start] : [];
  while (queue.length) {
    const at = queue.shift() as string;
    for (const t of w.transitions.filter((x) => x.from === at && x.to && !col.has(x.to))) {
      col.set(t.to as string, (col.get(at) ?? 0) + 1);
      queue.push(t.to as string);
    }
  }
  const last = Math.max(-1, ...col.values()) + 1;
  for (const s of w.states) if (!col.has(s.id)) col.set(s.id, last);
  return col;
}

/** One arrow: forward arrows go right to left edge; back arrows and arrows within a column curve below; a self arrow loops above. */
function edgePath(a: DiagramNode, b: DiagramNode, n: number): { d: string; lx: number; ly: number } {
  if (a.id === b.id) {
    const x = a.x + a.w / 2;
    return { d: `M ${x - 18} ${a.y} C ${x - 30} ${a.y - 40}, ${x + 30} ${a.y - 40}, ${x + 18} ${a.y}`, lx: x, ly: a.y - 34 };
  }
  if (b.x > a.x) {
    const x1 = a.x + a.w;
    const y1 = a.y + a.h / 2 + n * 8;
    const x2 = b.x;
    const y2 = b.y + b.h / 2 + n * 8;
    return { d: `M ${x1} ${y1} C ${x1 + 40} ${y1}, ${x2 - 40} ${y2}, ${x2} ${y2}`, lx: (x1 + x2) / 2, ly: (y1 + y2) / 2 - 6 };
  }
  const x1 = a.x + a.w / 2;
  const y1 = a.y + a.h;
  const x2 = b.x + b.w / 2;
  const y2 = b.y + b.h;
  const dip = Math.max(y1, y2) + 34 + n * 16;
  return { d: `M ${x1} ${y1} C ${x1} ${dip}, ${x2} ${dip}, ${x2} ${y2}`, lx: (x1 + x2) / 2, ly: dip - 8 };
}

/** The workflow as a state diagram: states as boxes in columns (the first state on the left), transitions as labelled
 * arrows, and the same thing as plain sentences for a screen reader. Layout is computed, never stored. */
export function workflowDiagram(w: LineWorkflow): Diagram {
  const col = columns(w);
  const rows = new Map<number, number>();
  const nodes: DiagramNode[] = w.states.map((s) => {
    const c = col.get(s.id) ?? 0;
    const r = rows.get(c) ?? 0;
    rows.set(c, r + 1);
    return {
      id: s.id, label: s.label, sub: s.role ? (s.page ? `${s.role} page` : 'page not chosen') : s.final ? 'end' : 'step',
      x: PAD + c * (W + GAP_X), y: PAD + 30 + r * (H + GAP_Y), w: W, h: H, initial: s.initial, final: s.final, page: s.role !== null,
    };
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const pairCount = new Map<string, number>();
  const edges: DiagramEdge[] = [];
  for (const t of w.transitions) {
    const a = byId.get(t.from);
    const b = t.to ? byId.get(t.to) : a;
    if (!a || !b) continue;
    const pair = `${a.id}>${b.id}`;
    const n = pairCount.get(pair) ?? 0;
    pairCount.set(pair, n + 1);
    edges.push({ id: t.id, label: t.event, own: t.origin === 'feature', ...edgePath(a, b, n) });
  }
  const width = Math.max(...nodes.map((n) => n.x + n.w), 0) + PAD;
  const height = Math.max(...nodes.map((n) => n.y + n.h), 0) + PAD + 60;
  const text = w.transitions.map((t) => `${t.when} ${t.do}`);
  return { nodes, edges, width, height, text };
}
