// The Map view's behaviour: pan (drag), zoom (wheel and pinch), hover, click to select. It owns one canvas and redraws only
// when something changed (no loop, so nothing runs while the Map is idle). All the arithmetic is in layout.mjs and all the
// drawing in render.mjs; this file only turns pointer events into view changes.
import { layoutColumns, identityView, fitView, zoomAt, panBy, pinch, pickAt, centerOn, isDraggableTie } from "./layout.mjs";
import { readPalette, sizeCanvas, drawMap } from "./render.mjs";

const reducedMotion = () => (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) ?? false;
const REJECT_MS = 260; // a one-shot flash on the card a rejected drop was released over; see drawMap's state.reject

export function createMap({ box, canvas, onSelect, onHover, compatibleOf, onAttach }) {
  const ctx = canvas.getContext("2d");
  let idx = null, view = identityView(), size = { w: 300, h: 200 }, dpr = 1, pal = null, raf = 0, visible = false;
  let hover = -1, selected = -1, userMoved = false;
  const pointers = new Map(); // pointerId -> {x, y}; two of them is a pinch
  let drag = null;
  // LIN-257 §4-5: a field-drag replaces the pan gesture when pointer-down lands on an eligible node (a Tie wire
  // still pointed at "tie:none" — layout.mjs's isDraggableTie). fieldDrag: { i, id, compatible: Set<string>, px,
  // py, moved } | null. pinned: nodeId -> endpointNodeId, a transient visual-only "resolved" override this file
  // owns (never persisted — a fresh setData() naturally drops it, same as any other transient UI state here).
  let fieldDrag = null;
  const pinned = new Map();
  let reject = null; // { nodeId: string|null } while the one-shot rejection flash is showing
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
    const dragState = fieldDrag ? { i: fieldDrag.i, compatible: fieldDrag.compatible, px: fieldDrag.x, py: fieldDrag.y } : null;
    const r = drawMap(ctx, idx, view, size, dpr, pal, { hover, selected, drag: dragState, pinned: pinned.size ? Object.fromEntries(pinned) : null, reject });
    const dt = performance.now() - t0;
    stats.draws++; stats.lastMs = dt; stats.totalMs += dt; stats.maxMs = Math.max(stats.maxMs, dt); stats.nodes = r.nodes; stats.edges = r.edges; stats.drawnEdges = r.drawnEdges;
  }

  function setData(data) {
    // keep the selected part (by id) across a re-layout, so the tint updates do not lose your place
    const keep = selected >= 0 ? idx?.nodes[selected]?.id : null;
    idx = data ? layoutColumns(data) : null;
    selected = keep && idx ? idx.byId.get(keep) ?? -1 : -1;
    hover = -1;
    fieldDrag = null; pinned.clear(); reject = null; // a new layout clears every transient drag/pin: LIN-257 scoping note
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
    const p = local(e);
    pointers.set(e.pointerId, p);
    if (pointers.size === 1 && idx) {
      const i = pickAt(idx, view, p.x, p.y);
      if (i >= 0 && isDraggableTie(idx, i)) {
        // LIN-257 §4: pointer-down on an eligible node begins a field-drag instead of the usual pan. A plain
        // click (no movement past the same moved>4 threshold the pan gesture uses) still falls back to select.
        fieldDrag = { i, id: idx.nodes[i].id, compatible: compatibleOf?.(idx.nodes[i].id) ?? new Set(), x: p.x, y: p.y, moved: 0 };
        reject = null; drag = null;
        return;
      }
    }
    drag = pointers.size === 1 ? { ...p, moved: 0 } : null;
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
      if (fieldDrag) {
        fieldDrag.moved += Math.abs(p.x - fieldDrag.x) + Math.abs(p.y - fieldDrag.y);
        fieldDrag.x = p.x; fieldDrag.y = p.y;
        canvas.style.cursor = "grabbing";
        draw();
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
    if (e.pointerType !== "touch" && idx) {
      const i = pickAt(idx, view, p.x, p.y);
      setHover(i);
      canvas.style.cursor = i >= 0 && isDraggableTie(idx, i) ? "grab" : "";
    }
  });
  // LIN-257 §4: a drop. moved<=4 is the same "it was really a click" threshold the pan gesture already uses —
  // falls back to the ordinary click-to-select instead of resolving/rejecting a drag that never really started.
  function finishFieldDrag(p, cancelled) {
    const drag_ = fieldDrag; fieldDrag = null;
    if (drag_.moved <= 4) { selected = drag_.i; draw(); onSelect?.(idx.nodes[drag_.i]); return; }
    const i = !cancelled && idx ? pickAt(idx, view, p.x, p.y) : -1;
    const hitId = i >= 0 ? idx.nodes[i].id : null;
    if (hitId && drag_.compatible.has(hitId)) {
      pinned.set(drag_.id, hitId);
      onAttach?.(drag_.id, hitId);
      draw();
      return;
    }
    // Rejected: snap back to the normal tie:none edge (nothing pinned) with a short, reduced-motion-respecting flash.
    if (reducedMotion()) { reject = null; draw(); return; }
    reject = { nodeId: hitId };
    draw();
    setTimeout(() => { reject = null; draw(); }, REJECT_MS);
  }
  const end = (e) => {
    const p = local(e);
    if (fieldDrag) {
      finishFieldDrag(p, e.type === "pointercancel");
      pointers.delete(e.pointerId); canvas.style.cursor = "";
      return;
    }
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
    // LIN-257: plain-old-data snapshots for the ?canvasdebug hook / an automated test — never the live Set/Map.
    get drag() { return fieldDrag ? { nodeId: fieldDrag.id, compatible: [...fieldDrag.compatible] } : null; },
    get pinned() { return Object.fromEntries(pinned); },
    paintNow: paint,
  };
}
