// The drawing: thin functions that turn the numbers from geometry.mjs and layout.mjs into strokes on a 2D canvas. They
// read nothing from the page except the colour tokens (readPalette, called at draw time so a theme switch is picked up)
// and they never change data: pure rendering. Canvas 2D only.
import { withAlpha, isDarkColor, slice, tickAt, partProgress, easeOutCubic, lerp } from "./geometry.mjs";
import { lod, visibleRect, forEachEdgeInRect, queryNodes, deviceMatrix, TERM_ORDER } from "./layout.mjs";

// Colours come from the demo's CSS custom properties (light "paper" and dark), never from constants here.
export function readPalette(root = document.documentElement) {
  const cs = getComputedStyle(root), v = (n, d) => cs.getPropertyValue(n).trim() || d;
  const bg = v("--bg", "#f3efe6");
  return {
    dark: isDarkColor(bg), bg, surface: v("--surface", "#faf7f0"), surface2: v("--surface-2", "#efeadf"), text: v("--text", "#29251e"), muted: v("--muted", "#6b655a"),
    border: v("--border", "#ddd6c7"), borderStrong: v("--border-strong", "#c9c0ad"),
    accent: v("--accent", "#3d4fd1"), glow: v("--mark-a", "#5a72f2"), fit: v("--fit", "#2b8a57"), wait: v("--wait", "#8a5300"), gap: v("--gap", "#c4453a"), tie: v("--tie", "#b06f10"), stub: v("--stub", "#7550cf"),
    font: v("--font", "system-ui, sans-serif"), mono: v("--mono", "ui-monospace, monospace"),
  };
}
export const tone = (pal, name) => pal[name] ?? pal.accent;

// Match the backing store to the CSS size and the device pixel ratio, so lines stay crisp on a HiDPI screen. Returns true
// when it changed (the caller then redraws).
export function sizeCanvas(canvas, cssW, cssH, dpr) {
  const w = Math.max(1, Math.round(cssW * dpr)), h = Math.max(1, Math.round(cssH * dpr));
  if (canvas.width === w && canvas.height === h) return false;
  canvas.width = w; canvas.height = h;
  return true;
}

const path = (ctx, flat) => { ctx.beginPath(); ctx.moveTo(flat[0], flat[1]); for (let i = 2; i < flat.length; i += 2) ctx.lineTo(flat[i], flat[i + 1]); };
const dot = (ctx, x, y, r) => { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); };

// ---------- the trace overlay ----------
// One entry of the overlay: { route, phase, kind, chip } where phase is null when settled, else the pulse's pulsePhase().
const SETTLED_ALPHA = { fit: 0.26, wait: 0.42, gap: 0.3, tie: 0.36, stub: 0.55 };

export function drawSettled(ctx, route, pal, S = 1) {
  const kind = route.kind;
  for (const part of route.parts) {
    const c = kind === "gap" ? pal.gap : tone(pal, part.tone);
    path(ctx, part.poly.pts);
    ctx.lineWidth = 1.3 * S; ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.strokeStyle = withAlpha(c, SETTLED_ALPHA[kind] ?? 0.3);
    ctx.setLineDash(part.dash ? [5 * S, 4 * S] : []);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  drawMarks(ctx, route, pal, S, 1);
}

// The marks at the ends of a route once it has arrived (or been cut short): a dot, a terminator, two small rings, a stub node.
function drawMarks(ctx, route, pal, S, k) {
  for (const m of route.marks) {
    const c = tone(pal, m.tone);
    if (m.type === "ring" && route.kind === "fit") { dot(ctx, m.at.x, m.at.y, 2.6 * S); ctx.fillStyle = withAlpha(c, 0.5 * k); ctx.fill(); }
    else if (m.type === "ring" && route.kind === "tie") { dot(ctx, m.at.x, m.at.y, 3 * S); ctx.lineWidth = 1.4 * S; ctx.strokeStyle = withAlpha(c, 0.75 * k); ctx.stroke(); ctx.fillStyle = withAlpha(c, 0.2 * k); ctx.fill(); }
    else if (m.type === "pause") { // waiting: an open ring, with a small dot in it (nothing is settled, so nothing is cut off)
      dot(ctx, m.at.x, m.at.y, 4 * S); ctx.lineWidth = 1.5 * S; ctx.strokeStyle = withAlpha(c, 0.85 * k); ctx.stroke(); ctx.fillStyle = withAlpha(c, 0.14 * k); ctx.fill();
      dot(ctx, m.at.x, m.at.y, 1.2 * S); ctx.fillStyle = withAlpha(c, 0.85 * k); ctx.fill();
    }
    else if (m.type === "fork") { dot(ctx, m.at.x, m.at.y, 2.2 * S); ctx.fillStyle = withAlpha(c, 0.7 * k); ctx.fill(); }
    else if (m.type === "break") {
      const t = tickAt(m.at, 11 * S);
      ctx.beginPath(); ctx.moveTo(t[0], t[1]); ctx.lineTo(t[2], t[3]);
      ctx.lineWidth = 2.2 * S; ctx.lineCap = "round"; ctx.strokeStyle = withAlpha(c, 0.9 * k); ctx.stroke();
    } else if (m.type === "node") {
      const r = 4.5 * S; ctx.beginPath(); ctx.roundRect(m.at.x - r, m.at.y - r, 2 * r, 2 * r, 2);
      ctx.setLineDash([2.5 * S, 2.5 * S]); ctx.lineWidth = 1.4 * S; ctx.strokeStyle = withAlpha(c, 0.85 * k); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = withAlpha(c, 0.16 * k); ctx.fill();
    }
  }
}

// A travelling pulse: a faint trail behind a bright head with a soft glow, then (once it has arrived) the outcome's mark
// blooms and the line eases down to its settled look. phase: from pulsePhase().
export function drawPulse(ctx, route, phase, pal, S = 1, chipRect = null) {
  const T = phase.T, arrived = phase.arrived, r = phase.ring;
  for (const part of route.parts) {
    const f = partProgress(part, T);
    if (f <= 0) continue;
    const c = tone(pal, part.tone), gapLine = route.kind === "gap";
    // the trail: everything travelled so far, settling toward the faint final look once the pulse has arrived
    const trailA = lerp(0.3, SETTLED_ALPHA[route.kind] ?? 0.3, arrived ? easeOutCubic(r) : 0);
    path(ctx, slice(part.poly, 0, f));
    ctx.lineWidth = 1.3 * S; ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.strokeStyle = withAlpha(gapLine && arrived ? pal.gap : c, trailA);
    ctx.setLineDash(part.dash ? [5 * S, 4 * S] : []); ctx.stroke(); ctx.setLineDash([]);
    if (arrived && r > 0.6) continue;
    // the head: a short bright stretch with a wide soft halo under it
    const tail = Math.max(0, f - 0.26), seg = slice(part.poly, tail, f);
    if (seg.length >= 4) {
      const a = 1 - (arrived ? easeOutCubic(r / 0.6) : 0);
      const g = ctx.createLinearGradient(seg[0], seg[1], seg[seg.length - 2], seg[seg.length - 1]);
      g.addColorStop(0, withAlpha(c, 0)); g.addColorStop(1, withAlpha(c, 0.95 * a));
      path(ctx, seg); ctx.lineWidth = 7 * S; ctx.strokeStyle = withAlpha(c, (pal.dark ? 0.11 : 0.08) * a); ctx.stroke();
      path(ctx, seg); ctx.lineWidth = 2.2 * S; ctx.strokeStyle = g; ctx.stroke();
      const hx = seg[seg.length - 2], hy = seg[seg.length - 1], rad = 11 * S;
      const rg = ctx.createRadialGradient(hx, hy, 0, hx, hy, rad);
      rg.addColorStop(0, withAlpha(c, 0.55 * a)); rg.addColorStop(1, withAlpha(c, 0));
      ctx.fillStyle = rg; dot(ctx, hx, hy, rad); ctx.fill();
    }
  }
  // fork and marks appear when the head gets there
  if (route.kind === "tie" && T >= 0.5) drawMarks(ctx, { ...route, marks: route.marks.filter((m) => m.type === "fork") }, pal, S, 1);
  if (!arrived) return;
  if (route.kind === "fit" || route.kind === "kept") {
    const m = route.marks[0], c = pal.fit, e = easeOutCubic(r);
    dot(ctx, m.at.x, m.at.y, lerp(3, 17, e) * S); ctx.lineWidth = 1.6 * S; ctx.strokeStyle = withAlpha(c, (1 - r) * 0.6); ctx.stroke();
    dot(ctx, m.at.x, m.at.y, lerp(2, 12, e) * S); ctx.fillStyle = withAlpha(c, (1 - r) * 0.14); ctx.fill();
    if (route.kind === "fit") drawMarks(ctx, route, pal, S, easeOutCubic(r));
  } else if (route.kind === "wait") { // the pulse pauses at the ring and breathes twice in amber: an open Ask, not a failure
    const m = route.marks[0], e = easeOutCubic(r), e2 = easeOutCubic(Math.max(0, r - 0.35) / 0.65);
    drawMarks(ctx, route, pal, S, 1);
    dot(ctx, m.at.x, m.at.y, lerp(4, 12, e) * S); ctx.lineWidth = 1.4 * S; ctx.strokeStyle = withAlpha(pal.wait, (1 - r) * 0.5); ctx.stroke();
    if (r > 0.35) { dot(ctx, m.at.x, m.at.y, lerp(4, 12, e2) * S); ctx.strokeStyle = withAlpha(pal.wait, (1 - r) * 0.4); ctx.stroke(); }
  } else if (route.kind === "gap") {
    const m = route.marks[0], e = easeOutCubic(r);
    drawMarks(ctx, route, pal, S, 1);
    dot(ctx, m.at.x, m.at.y, lerp(4, 13, e) * S); ctx.lineWidth = 1.4 * S; ctx.strokeStyle = withAlpha(pal.gap, (1 - r) * 0.5); ctx.stroke();
  } else {
    drawMarks(ctx, route, pal, S, easeOutCubic(Math.min(1, r * 1.6)));
  }
  if (chipRect && (route.kind === "fit" || route.kind === "tie")) drawChipGlow(ctx, chipRect, route.kind === "tie" ? pal.tie : pal.accent, (1 - r) * 0.55);
}

// A soft halo round the endpoint chip a pulse just reached (it "lights up" for a moment).
export function drawChipGlow(ctx, rect, color, a) {
  if (a <= 0.01) return;
  ctx.beginPath(); ctx.roundRect(rect.left - 2, rect.top - 2, rect.right - rect.left + 4, rect.bottom - rect.top + 4, 8);
  ctx.lineWidth = 2; ctx.strokeStyle = withAlpha(color, a); ctx.stroke();
}

// ---------- the Map ----------
const roundedFill = (ctx, x, y, w, h, r) => { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); };
const FONT_PX = 12;
export const EDGE_BUDGET = 1200; // most edges one frame strokes; beyond this the drawing is an even sample

// state: { hover, selected } are node indices (or -1). Returns how many nodes and edges were drawn (for the stress test).
export function drawMap(ctx, idx, view, size, dpr, pal, state = {}) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  if (!idx) return { nodes: 0, edges: 0 };
  ctx.setTransform(...deviceMatrix(view, dpr));
  const vis = visibleRect(view, size.w, size.h), pad = 40 / view.k;
  const rect = { left: vis.left - pad, top: vis.top - pad, right: vis.right + pad, bottom: vis.bottom + pad };
  const focus = state.hover >= 0 ? state.hover : state.selected ?? -1;
  const lit = focus >= 0 ? new Set(idx.adj[focus]) : null;
  // 1. edges: batched by outcome, one stroke per colour. Culled to the view by their boxes.
  const { x0, y0, x1, y1, term } = idx.edges, buckets = TERM_ORDER.map(() => []), hot = [];
  forEachEdgeInRect(idx, rect, (i) => { (lit && lit.has(i) ? hot : buckets[term[i]]).push(i); });
  const shown = buckets.reduce((n, b) => n + b.length, 0) + hot.length;
  const q = lod(view, shown), px = 1 / view.k;
  const curve = (i) => { const dx = Math.min(140, (x1[i] - x0[i]) * 0.5); ctx.moveTo(x0[i], y0[i]); ctx.bezierCurveTo(x0[i] + dx, y0[i], x1[i] - dx, y1[i], x1[i], y1[i]); };
  ctx.lineCap = "round";
  // When thousands of edges are on screen they blur into a haze anyway: draw an even sample (every nth) so a frame stays cheap.
  // The edges of the hovered or selected node are never sampled away.
  const stride = Math.max(1, Math.ceil((shown - hot.length) / EDGE_BUDGET));
  for (let t = 0; t < buckets.length; t++) {
    if (!buckets[t].length) continue;
    ctx.beginPath(); for (let j = 0; j < buckets[t].length; j += stride) curve(buckets[t][j]);
    ctx.lineWidth = q.edgeWidth * px; ctx.strokeStyle = withAlpha(tone(pal, TERM_ORDER[t]), lit ? q.edgeAlpha * 0.4 : q.edgeAlpha); ctx.stroke();
  }
  for (const i of hot) { ctx.beginPath(); curve(i); ctx.lineWidth = 2.4 * px; ctx.strokeStyle = withAlpha(tone(pal, TERM_ORDER[term[i]]), 0.95); ctx.stroke(); }
  // 2. nodes
  const list = queryNodes(idx, rect);
  const litNodes = new Set(); if (lit) for (const i of lit) { litNodes.add(idx.edges.a[i]); litNodes.add(idx.edges.b[i]); }
  if (q.shape === "dot") {
    // too small to read: one small square per node, batched by colour
    const groups = new Map();
    for (const i of list) { const n = idx.nodes[i], c = n.term ?? "accent"; (groups.get(c) ?? groups.set(c, []).get(c)).push(n); }
    for (const [name, ns] of groups) { ctx.fillStyle = withAlpha(tone(pal, name), 0.7); const s = Math.max(2, 2.5 * px * 1.2); for (const n of ns) ctx.fillRect(n.x + n.w * (n.side ? 0 : 0.94), n.y, Math.max(n.w * 0.06, s), Math.max(n.h, s)); }
  } else {
    ctx.font = `${FONT_PX}px ${pal.font}`; ctx.textBaseline = "middle";
    ctx.fillStyle = pal.muted; ctx.font = `600 ${FONT_PX}px ${pal.font}`;
    ctx.fillText("YOUR DESIGNED PAGE", 0, -14); ctx.fillText("THE CONTRACT", idx.rightX, -14);
    for (const i of list) {
      const n = idx.nodes[i], c = tone(pal, n.term ?? (n.kind === "endpoint" ? "accent" : "muted")), dim = lit && !litNodes.has(i) && i !== focus;
      ctx.globalAlpha = dim ? 0.4 : 1;
      roundedFill(ctx, n.x, n.y, n.w, n.h, 6);
      ctx.fillStyle = n.kind === "endpoint" ? withAlpha(pal.accent, pal.dark ? 0.16 : 0.1) : n.kind === "special" ? withAlpha(c, 0.13) : pal.surface2;
      ctx.fill();
      ctx.lineWidth = px * (i === state.selected ? 2.4 : i === focus ? 1.8 : 1);
      ctx.strokeStyle = i === state.selected ? pal.accent : i === focus ? withAlpha(pal.accent, 0.8) : n.kind === "special" && n.term === "stub" ? withAlpha(c, 0.8) : pal.border;
      ctx.setLineDash(n.kind === "special" && (n.term === "stub" || n.term === "gap") ? [4 * px * 2, 3 * px * 2] : []); ctx.stroke(); ctx.setLineDash([]);
      if (n.side === 0) { roundedFill(ctx, n.x, n.y, 4, n.h, 2); ctx.fillStyle = c; ctx.fill(); }
      if (q.labels) {
        ctx.fillStyle = pal.text;
        ctx.font = `${n.kind === "endpoint" ? "600 " : ""}${FONT_PX}px ${n.side === 1 && n.kind !== "special" ? pal.mono : pal.font}`;
        if (n._t == null) n._t = fitText(ctx, n.label, n.w - 18);
        ctx.fillText(n._t, n.x + (n.side === 0 ? 12 : 9), n.y + n.h / 2 + 0.5);
      }
      ctx.globalAlpha = 1;
    }
  }
  return { nodes: list.length, edges: shown, drawnEdges: Math.ceil((shown - hot.length) / stride) + hot.length, stride };
}
// Cut a label to a width with an ellipsis. Measured once per node (the width is the same at every zoom).
export function fitText(ctx, text, maxW) {
  const s = String(text ?? "");
  if (ctx.measureText(s).width <= maxW) return s;
  let lo = 1, hi = s.length;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (ctx.measureText(s.slice(0, mid) + "…").width <= maxW) lo = mid; else hi = mid - 1; }
  return s.slice(0, lo) + "…";
}
