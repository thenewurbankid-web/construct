// The Map view's behaviour: pan (drag), zoom (wheel and pinch), hover, click to select. It owns one canvas and redraws only
// when something changed (no loop, so nothing runs while the Map is idle). All the arithmetic is in layout.mjs and all the
// drawing in render.mjs; this file only turns pointer events into view changes.
import { layoutColumns, identityView, fitView, zoomAt, panBy, pinch, pickAt, centerOn } from "./layout.mjs";
import { readPalette, sizeCanvas, drawMap } from "./render.mjs";

export function createMap({ box, canvas, onSelect, onHover }) {
  const ctx = canvas.getContext("2d");
  let idx = null, view = identityView(), size = { w: 300, h: 200 }, dpr = 1, pal = null, raf = 0, visible = false;
  let hover = -1, selected = -1, userMoved = false;
  const pointers = new Map(); // pointerId -> {x, y}; two of them is a pinch
  let drag = null;
  const stats = { draws: 0, lastMs: 0, maxMs: 0, totalMs: 0, nodes: 0, edges: 0 };

  const rectOf = () => canvas.getBoundingClientRect();
  const local = (e) => { const r = rectOf(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  function resize() {
    const r = rectOf();
    if (r.width < 2 || r.height < 2) return;
    dpr = window.devicePixelRatio || 1;
    size = { w: r.width, h: r.height };
    sizeCanvas(canvas, r.width, r.height, dpr);
    if (idx && !userMoved) view = fitView(idx.bounds, size.w, size.h);
    draw();
  }
  function draw() {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; paint(); });
  }
  function paint() {
    if (!visible || document.hidden) return;
    pal = pal ?? readPalette();
    const t0 = performance.now();
    const r = drawMap(ctx, idx, view, size, dpr, pal, { hover, selected });
    const dt = performance.now() - t0;
    stats.draws++; stats.lastMs = dt; stats.totalMs += dt; stats.maxMs = Math.max(stats.maxMs, dt); stats.nodes = r.nodes; stats.edges = r.edges; stats.drawnEdges = r.drawnEdges;
  }

  function setData(data) {
    // keep the selected part (by id) across a re-layout, so the tint updates do not lose your place
    const keep = selected >= 0 ? idx?.nodes[selected]?.id : null;
    idx = data ? layoutColumns(data) : null;
    selected = keep && idx ? idx.byId.get(keep) ?? -1 : -1;
    hover = -1;
    if (idx && !userMoved) view = fitView(idx.bounds, size.w, size.h);
    draw();
  }
  function fit() { userMoved = false; if (idx) view = fitView(idx.bounds, size.w, size.h); draw(); }
  function zoomBy(f, cx = size.w / 2, cy = size.h / 2) { userMoved = true; view = zoomAt(view, cx, cy, f); draw(); }
  function select(id, { center = false } = {}) {
    const i = id == null ? -1 : idx?.byId.get(id) ?? -1;
    selected = i;
    if (center && i >= 0) { userMoved = true; view = centerOn(view, idx.nodes[i], size.w, size.h); }
    draw();
  }
  function setHover(i) { if (i !== hover) { hover = i; onHover?.(i >= 0 ? idx.nodes[i] : null); draw(); } }

  // ---- pointer input (positions are CSS px; only the drawing is scaled by the device pixel ratio) ----
  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, local(e));
    drag = pointers.size === 1 ? { ...local(e), moved: 0 } : null;
  });
  canvas.addEventListener("pointermove", (e) => {
    const p = local(e);
    if (pointers.has(e.pointerId)) {
      const prev = [...pointers.values()];
      pointers.set(e.pointerId, p);
      if (pointers.size === 2) {
        const next = [...pointers.values()];
        const g = pinch(prev, next);
        userMoved = true; view = panBy(zoomAt(view, g.cx, g.cy, g.factor), g.dx, g.dy); draw();
        return;
      }
      if (drag) {
        const dx = p.x - drag.x, dy = p.y - drag.y;
        drag.moved += Math.abs(dx) + Math.abs(dy);
        if (drag.moved > 4) { userMoved = true; view = panBy(view, dx, dy); canvas.style.cursor = "grabbing"; draw(); }
        drag.x = p.x; drag.y = p.y;
        return;
      }
    }
    if (e.pointerType !== "touch" && idx) setHover(pickAt(idx, view, p.x, p.y));
  });
  const end = (e) => {
    const p = local(e);
    if (drag && drag.moved <= 4 && pointers.size === 1 && e.type === "pointerup" && idx) {
      const i = pickAt(idx, view, p.x, p.y);
      selected = i; draw();
      onSelect?.(i >= 0 ? idx.nodes[i] : null);
    }
    pointers.delete(e.pointerId); drag = null; canvas.style.cursor = "";
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
  canvas.addEventListener("pointerleave", () => { if (!pointers.size) setHover(-1); });
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const p = local(e), unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    zoomBy(Math.exp(-e.deltaY * unit * (e.ctrlKey ? 0.01 : 0.0015)), p.x, p.y);
  }, { passive: false });

  const ro = new ResizeObserver(() => resize());
  ro.observe(canvas);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) draw(); });

  return {
    setData, select, fit, resize,
    zoomIn: () => zoomBy(1.4), zoomOut: () => zoomBy(1 / 1.4),
    show(on) { visible = on; if (on) { pal = null; resize(); } },
    repaintTheme() { pal = null; draw(); },
    get view() { return view; }, set view(v) { view = v; userMoved = true; draw(); },
    get index() { return idx; }, get size() { return size; }, get stats() { return stats; }, get selected() { return selected; },
    paintNow: paint,
  };
}
