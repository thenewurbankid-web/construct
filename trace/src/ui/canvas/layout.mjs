// The Map's numbers: where each node sits, the view (pan and zoom), which nodes and edges are on screen, what is under
// the pointer, and how much detail to draw at a zoom level. No DOM and no canvas: everything is arithmetic, so it is
// unit-tested in node, and a 2,000-node stress graph is generated here too. World units are px at zoom 1.
import { clamp, mulberry32 } from "./geometry.mjs";

export const ROW_H = 24, ROW_GAP = 6, NODE_W = 200, COL_GAP = 210, HEAD_GAP = 16, CELL = 96;
export const TERM_INDEX = { fit: 0, gap: 1, tie: 2, stub: 3, wait: 4 }; // wait comes last so the first four keep their numbers
export const TERM_ORDER = ["fit", "gap", "tie", "stub", "wait"];

// Two columns of nodes and the edges between them. left / right: [{ id, label, term?, kind? }], edges: [{ from, to, term }].
// An endpoint node on the right (kind "endpoint") starts a new group, so it gets a little air above it.
export function layoutColumns({ left, right, edges }, o = {}) {
  const rowH = o.rowH ?? ROW_H, gap = o.gap ?? ROW_GAP, w = o.w ?? NODE_W, colGap = o.colGap ?? COL_GAP, head = o.headGap ?? HEAD_GAP;
  const nodes = [], byId = new Map();
  left.forEach((n, i) => { byId.set(n.id, nodes.length); nodes.push({ ...n, side: 0, x: 0, y: i * (rowH + gap), w, h: rowH }); });
  let y = 0;
  right.forEach((n, i) => {
    if (n.kind === "endpoint" && i > 0) y += head;
    byId.set(n.id, nodes.length); nodes.push({ ...n, side: 1, x: w + colGap, y, w, h: rowH });
    y += rowH + gap;
  });
  const m = edges.length;
  const ex0 = new Float32Array(m), ey0 = new Float32Array(m), ex1 = new Float32Array(m), ey1 = new Float32Array(m), et = new Uint8Array(m), ea = new Int32Array(m), eb = new Int32Array(m);
  const adj = nodes.map(() => []);
  let k = 0;
  for (const e of edges) {
    const a = byId.get(e.from), b = byId.get(e.to);
    if (a == null || b == null) continue; // an edge to a node that is not there is dropped, never drawn to nowhere
    const A = nodes[a], B = nodes[b];
    ex0[k] = A.x + A.w; ey0[k] = A.y + A.h / 2; ex1[k] = B.x; ey1[k] = B.y + B.h / 2; et[k] = TERM_INDEX[e.term] ?? 0; ea[k] = a; eb[k] = b;
    adj[a].push(k); adj[b].push(k);
    k++;
  }
  const bounds = { left: 0, top: -30 /* room for the column headings */, right: 2 * w + colGap, bottom: Math.max(1, ...nodes.map((n) => n.y + n.h)) };
  const idx = { rightX: w + colGap, nodes, byId, edges: { n: k, x0: ex0, y0: ey0, x1: ex1, y1: ey1, term: et, a: ea, b: eb }, adj, bounds, grid: buildGrid(nodes) };
  return idx;
}

// A uniform grid over the nodes: a query touches only the cells it covers, however many nodes there are.
export function buildGrid(nodes, cell = CELL) {
  const cells = new Map();
  nodes.forEach((n, i) => {
    for (let cy = Math.floor(n.y / cell); cy <= Math.floor((n.y + n.h) / cell); cy++)
      for (let cx = Math.floor(n.x / cell); cx <= Math.floor((n.x + n.w) / cell); cx++) {
        const key = cy * 8192 + cx;
        (cells.get(key) ?? cells.set(key, []).get(key)).push(i);
      }
  });
  return { cell, cells };
}
// Node indices touching a world rect (deduplicated).
export function queryNodes(idx, r) {
  const { cell, cells } = idx.grid, seen = new Set(), out = [];
  for (let cy = Math.floor(r.top / cell); cy <= Math.floor(r.bottom / cell); cy++)
    for (let cx = Math.floor(r.left / cell); cx <= Math.floor(r.right / cell); cx++) {
      const list = cells.get(cy * 8192 + cx);
      if (list) for (const i of list) if (!seen.has(i)) { seen.add(i); out.push(i); }
    }
  return out.filter((i) => { const n = idx.nodes[i]; return n.x <= r.right && n.x + n.w >= r.left && n.y <= r.bottom && n.y + n.h >= r.top; });
}
// The node under a world point, or -1. slop widens each node a little (in world units) so a thin node is still easy to hit.
export function hitNode(idx, wx, wy, slop = 0) {
  const list = queryNodes(idx, { left: wx - slop, right: wx + slop, top: wy - slop, bottom: wy + slop });
  let best = -1, bd = Infinity;
  for (const i of list) {
    const n = idx.nodes[i];
    const dx = wx < n.x ? n.x - wx : wx > n.x + n.w ? wx - n.x - n.w : 0, dy = wy < n.y ? n.y - wy : wy > n.y + n.h ? wy - n.y - n.h : 0, d = Math.hypot(dx, dy);
    if (d <= slop && d < bd) { bd = d; best = i; }
  }
  return best;
}
// Edges whose bounding box touches a world rect. A curve that leaves and arrives horizontally stays inside its two end
// points' box, so the box test is exact enough. Calls fn(edgeIndex).
export function forEachEdgeInRect(idx, r, fn) {
  const { n, x0, y0, x1, y1 } = idx.edges;
  for (let i = 0; i < n; i++) {
    const ylo = y0[i] < y1[i] ? y0[i] : y1[i], yhi = y0[i] < y1[i] ? y1[i] : y0[i];
    if (yhi < r.top || ylo > r.bottom || x1[i] < r.left || x0[i] > r.right) continue;
    fn(i);
  }
}

// ---------- the view: screen = world * k + (tx, ty), all in CSS px ----------
export const identityView = () => ({ k: 1, tx: 0, ty: 0 });
export const toWorld = (v, sx, sy) => ({ x: (sx - v.tx) / v.k, y: (sy - v.ty) / v.k });
export const toScreen = (v, wx, wy) => ({ x: wx * v.k + v.tx, y: wy * v.k + v.ty });
export const visibleRect = (v, w, h) => ({ left: (0 - v.tx) / v.k, top: (0 - v.ty) / v.k, right: (w - v.tx) / v.k, bottom: (h - v.ty) / v.k });
export const MIN_K = 0.01, MAX_K = 4;
// Zoom keeping the world point under (sx, sy) where it is.
export function zoomAt(v, sx, sy, factor, min = MIN_K, max = MAX_K) {
  const k = clamp(v.k * factor, min, max), f = k / v.k;
  return { k, tx: sx - (sx - v.tx) * f, ty: sy - (sy - v.ty) * f };
}
export const panBy = (v, dx, dy) => ({ k: v.k, tx: v.tx + dx, ty: v.ty + dy });
export function fitView(b, w, h, pad = 24, maxK = 1.4) {
  const bw = Math.max(1, b.right - b.left), bh = Math.max(1, b.bottom - b.top);
  const k = clamp(Math.min((w - 2 * pad) / bw, (h - 2 * pad) / bh), MIN_K, maxK);
  return { k, tx: (w - bw * k) / 2 - b.left * k, ty: pad - b.top * k };
}
export function centerOn(v, node, w, h) {
  const cx = node.x + node.w / 2, cy = node.y + node.h / 2;
  return { k: v.k, tx: w / 2 - cx * v.k, ty: h / 2 - cy * v.k };
}
// A two-finger gesture: how much the fingers spread, and where their midpoint moved. prev / next: [{x, y}, {x, y}].
export function pinch(prev, next) {
  const d0 = Math.hypot(prev[0].x - prev[1].x, prev[0].y - prev[1].y) || 1, d1 = Math.hypot(next[0].x - next[1].x, next[0].y - next[1].y) || 1;
  const c0 = { x: (prev[0].x + prev[1].x) / 2, y: (prev[0].y + prev[1].y) / 2 }, c1 = { x: (next[0].x + next[1].x) / 2, y: (next[0].y + next[1].y) / 2 };
  return { factor: d1 / d0, cx: c1.x, cy: c1.y, dx: c1.x - c0.x, dy: c1.y - c0.y };
}
// The canvas matrix for a device pixel ratio. Drawing and hit-testing share one view in CSS px, so a click lands on the
// node it visually covers at any zoom and any DPR: only the drawing is scaled by dpr, never the pointer position.
export const deviceMatrix = (v, dpr) => [v.k * dpr, 0, 0, v.k * dpr, v.tx * dpr, v.ty * dpr];
export function pickAt(idx, v, sx, sy, slopPx = 3) {
  const p = toWorld(v, sx, sy);
  return hitNode(idx, p.x, p.y, slopPx / v.k);
}

// How much to draw at this zoom (row height in screen px decides): labels only when they can be read, dots when a node
// is smaller than a pixel or two, thinner and fainter edges when there are many of them on screen.
export function lod(v, edgesOnScreen = 0, rowH = ROW_H) {
  const rowPx = v.k * rowH;
  return {
    labels: rowPx >= 11,
    shape: rowPx >= 4 ? "box" : "dot",
    edgeWidth: clamp(1.1 + (v.k - 0.5) * 0.6, 0.6, 2.2),
    edgeAlpha: edgesOnScreen > 1200 ? 0.13 : edgesOnScreen > 400 ? 0.2 : 0.32,
  };
}

// ---------- a synthetic graph for the stress test ----------
// nodes: total (half on each side), edges: total. locality: share of edges that go to a nearby row (like a real page, where
// a part's field sits near where the previous one did); the rest go anywhere, which is the worst case for culling.
export function stressGraph({ nodes = 2000, edges = 4000, seed = 7, locality = 0.7 } = {}) {
  const rnd = mulberry32(seed), n = Math.floor(nodes / 2);
  const left = [], right = [], list = [];
  for (let i = 0; i < n; i++) left.push({ id: `l${i}`, label: `Part ${i + 1}`, term: TERM_ORDER[Math.floor(rnd() * 4)] });
  for (let i = 0; i < n; i++) right.push({ id: `r${i}`, label: `field_${i + 1}`, kind: i % 25 === 0 ? "endpoint" : "field" });
  for (let e = 0; e < edges; e++) {
    const a = e % n;
    const b = rnd() < locality ? clamp(a + Math.floor((rnd() - 0.5) * 80), 0, n - 1) : Math.floor(rnd() * n);
    list.push({ from: `l${a}`, to: `r${b}`, term: left[a].term });
  }
  return { left, right, edges: list };
}
