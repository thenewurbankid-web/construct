// The Trace canvas layer of the fit screen. It only READS the page: it finds the real elements (a part's data-id, an
// endpoint chip in the Contract rail), turns their rectangles into paths, and animates a pulse along each one as the part
// resolves. It never changes a result, a state or any generated output; the only DOM it writes is its own (the rail, the
// list of facts, the Map's panel, the replay button and view toggle).
//
// Everything the canvas shows is also text: the rail lists the endpoints with their counts, and "The trace, as a list"
// says, for every part, what it is and where it comes from. The canvases are aria-hidden and decorative.
import { buildParts, buildMap, breakdownByEndpoint, partTotal } from "./parts.mjs";
import { createPulseQueue } from "./queue.mjs";
import { routeFor, pulsePhase, rectRight, rectLeft, rectVisible } from "./geometry.mjs";
import { readPalette, sizeCanvas, drawSettled, drawPulse } from "./render.mjs";
import { createMap } from "./map.mjs";
import { TERMS } from "../vocab.mjs";

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const RING_MS = 520;

// host: { present(), reduced(), toast(msg), contract(example) -> Promise<apis[]> }
export function createTrace(host) {
  const canvas = $("#traceCanvas"), ctx = canvas.getContext("2d");
  const mid = $("#stageMid"), body = $("#stageBody"), pv = $("#pv"), rail = $("#rail"), railEps = $("#railEps"), railHead = $("#railHead"), railStub = $("#railStub");
  const bReplay = $("#bTrace"), vPage = $("#vPage"), vMap = $("#vMap"), mapBox = $("#map"), list = $("#traceList"), listHome = $("#traceDetails"), mapSide = $("#mapSide"), mapPick = $("#mapPick");

  let apis = [], parts = [], entries = new Map(), pal = null, raf = 0, painting = false, dpr = 1, size = { w: 0, h: 0 };
  let active = false, view = "page", runId = 0, slowKey = "";
  const queue = createPulseQueue();
  const metrics = { paints: 0, frames: 0, ms: 0, max: 0 };
  const map = createMap({ box: mapBox, canvas: $("#mapCanvas"), onSelect: (n) => pick(n?.id ?? null), onHover: () => {} });

  const S = () => (host.present() ? 1.4 : 1);
  const slow = () => (host.present() ? 1.6 : 1);

  // ---------- reading the page: where things are, in the overlay canvas's own coordinates ----------
  let origin = { x: 0, y: 0 }, bodyBox = null, railBox = null, chipRects = new Map();
  function measure() {
    const o = mid.getBoundingClientRect(); origin = { x: o.left, y: o.top };
    const shift = (r) => ({ left: r.left - o.left, right: r.right - o.left, top: r.top - o.top, bottom: r.bottom - o.top });
    bodyBox = shift(body.getBoundingClientRect()); railBox = shift(rail.getBoundingClientRect());
    chipRects = new Map();
    for (const li of railEps.children) chipRects.set(li.dataset.ep, shift(li.getBoundingClientRect()));
    if (!railStub.hidden) chipRects.set("stub", shift(railStub.getBoundingClientRect()));
    chipRects.set("head", shift(railHead.getBoundingClientRect()));
  }
  const elOf = (e) => (e.el?.isConnected ? e.el : (e.el = pv.querySelector(`[data-id="${CSS.escape(e.id)}"]`)));
  // Is the part's middle inside the page's scroller right now? (Only what can be seen is animated.)
  function onScreen(el) {
    const r = el.getBoundingClientRect(), b = body.getBoundingClientRect(), y = (r.top + r.bottom) / 2;
    return y >= b.top && y <= b.bottom && r.right > b.left && r.left < b.right;
  }
  function anchorOf(e) {
    const el = elOf(e);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const rr = { left: r.left - origin.x, right: r.right - origin.x, top: r.top - origin.y, bottom: r.bottom - origin.y };
    if (!rectVisible(rr, bodyBox)) return null; // scrolled out of the page's view: nothing to draw from
    const a = rectRight(rr, 3);
    a.x = Math.min(a.x, bodyBox.right - 6);
    return a;
  }
  function targetOf(e) {
    const { term, src } = e.part;
    let key = src.endpoint;
    if (term === "stub") key = "stub";
    else if (!key) key = term === "gap" || term === "wait" ? "head" : null;
    const r = key ? chipRects.get(key) : null;
    if (!r) return { to: null, chip: null };
    const y = Math.min(Math.max((r.top + r.bottom) / 2, railBox.top + 12), railBox.bottom - 12); // a chip scrolled out of the rail: aim at its edge
    return { to: { x: r.left - 2, y }, chip: key === "head" || key === "stub" ? null : r };
  }
  function routeOf(e) {
    const from = anchorOf(e);
    if (!from) return null;
    const { to, chip } = targetOf(e);
    const kind = e.part.term === "fit" && !to ? "kept" : e.part.term;
    return { route: routeFor(kind, from, to, { id: e.id }), chip };
  }

  // ---------- painting ----------
  function syncSize() {
    const r = mid.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    size = { w: r.width, h: r.height };
    sizeCanvas(canvas, r.width, r.height, dpr);
  }
  function paint(now) {
    const t0 = performance.now();
    pal = pal ?? readPalette();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    if (view !== "page" || !active || size.w < 10) return;
    measure();
    const S1 = S();
    for (const e of entries.values()) {
      if (e.state === "queued") continue;
      const r = routeOf(e);
      if (!r) continue;
      if (e.state === "travelling" || e.state === "ringing") drawPulse(ctx, r.route, pulsePhase(now - e.item.startedAt, e.item.dur, RING_MS), pal, S1, r.chip);
      else drawSettled(ctx, r.route, pal, S1);
    }
    const dt = performance.now() - t0;
    metrics.paints++; metrics.ms += dt; metrics.max = Math.max(metrics.max, dt);
  }
  // A frame while something moves. When the line is empty and no ring is fading the loop stops: no idle work.
  function frame(now) {
    raf = 0;
    if (document.hidden) return;
    queue.setSlow(slow());
    const { started, finished } = queue.step(now);
    for (const it of started) { const e = entries.get(it.id); if (e && e.item === it) e.state = "travelling"; }
    for (const it of finished) { const e = entries.get(it.id); if (e && e.item === it) e.state = "ringing"; }
    for (const e of entries.values()) if (e.state === "ringing" && now >= e.item.startedAt + e.item.dur + RING_MS) e.state = "settled";
    metrics.frames++;
    paint(now);
    if (!queue.idle || [...entries.values()].some((e) => e.state === "ringing")) raf = requestAnimationFrame(frame);
  }
  function wake() { if (!raf && !document.hidden && active && view === "page") raf = requestAnimationFrame(frame); }
  // One still repaint (scroll, resize, theme): coalesced to a frame, and no loop afterwards.
  function repaint() {
    if (painting || raf) return;
    painting = true;
    requestAnimationFrame((t) => { painting = false; if (!raf) paint(t); });
  }
  function settleAll() {
    for (const it of queue.drain()) { const e = entries.get(it.id); if (e && e.item === it) e.state = "settled"; }
    for (const e of entries.values()) if (e.state !== "settled") e.state = "settled";
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    repaint();
  }

  // ---------- a run: rail, entries, queue ----------
  async function begin(sc) {
    const id = ++runId;
    settleAll(); queue.drain();
    entries = new Map(); parts = []; apis = [];
    paintRail(); paintList(); map.setData(null);
    bReplay.disabled = true;
    setView("page");
    let got = [];
    try { got = await host.contract(sc.example); } catch { got = []; }
    if (id !== runId) return;
    apis = got;
    paintRail();
    repaint();
  }
  function stop() { runId++; queue.drain(); if (raf) { cancelAnimationFrame(raf); raf = 0; } for (const e of entries.values()) e.state = "settled"; }

  // Called with each matched result. Only a part whose outcome changed gets a new pulse.
  function update(tree, states) {
    // A skipped Ask leaves a Tie or Gap without the endpoint it was first matched to: keep what was known while the outcome is the same.
    const before = new Map([...entries].map(([id, e]) => [id, e.part]));
    parts = buildParts(tree, states, apis).map((p) => { const o = before.get(p.id); return o && o.term === p.term && p.term !== "fit" && !p.src.endpoint && o.src.endpoint ? { ...o, order: p.order } : p; });
    let queued = 0;
    for (const p of parts) {
      const had = entries.get(p.id);
      if (had && had.part.term === p.term) { had.part = p; continue; }
      if (had?.item) queue.remove((x) => x === had.item);
      const e = { id: p.id, part: p, el: null, state: "settled", item: null };
      entries.set(p.id, e);
      if (host.reduced() || document.hidden || view !== "page") continue; // no travelling (or nobody watching): the settled path is drawn as it is
      // a part that is off the page, or scrolled out of view, has nothing to animate from: it just settles
      e.el = pv.querySelector(`[data-id="${CSS.escape(p.id)}"]`);
      if (!e.el || !onScreen(e.el)) continue;
      e.state = "queued"; e.item = { id: p.id, weight: p.term === "tie" ? 1.2 : 1 };
      queue.push(e.item); queued++;
    }
    for (const id of [...entries.keys()]) if (!parts.some((p) => p.id === id)) entries.delete(id);
    paintRail(); paintList();
    map.setData(buildMap(parts, apis));
    bReplay.disabled = host.reduced() || !parts.length;
    if (queued) wake(); else repaint();
  }
  // Run the trace again over the settled result. No server call: it only replays the animation.
  function replay() {
    if (host.reduced() || !parts.length) return;
    setView("page");
    queue.drain();
    for (const e of entries.values()) { e.el = null; const el = elOf(e); if (!el || !onScreen(el)) { e.state = "settled"; continue; } e.state = "queued"; e.item = { id: e.id, weight: e.part.term === "tie" ? 1.2 : 1 }; queue.push(e.item); }
    wake();
  }

  // ---------- the text side of everything the canvas shows ----------
  function paintRail() {
    const by = breakdownByEndpoint(parts), stubs = parts.filter((p) => p.term === "stub").length;
    $("#railSub").textContent = apis.length ? `${apis.length} endpoint${apis.length === 1 ? "" : "s"}` : "";
    railEps.innerHTML = apis.map((a) => {
      const k = `${a.method} ${a.path}`, c = by.get(k);
      const bits = c ? ["fit", "wait", "gap", "tie"].filter((t) => c[t]).map((t) => `${c[t]} ${TERMS[t].word}`) : [];
      return `<li class="ep" data-ep="${esc(k)}" title="${esc(k)}"><span class="method ${esc(a.method)}">${esc(a.method)}</span><span class="ep-path">${esc(a.path).replace(/([/\-])/g, "$1<wbr>")}</span>${bits.length ? `<span class="ep-n">${bits.join(" · ")}</span>` : ""}</li>`;
    }).join("") || `<li class="ep-none">The contract shows here.</li>`;
    railStub.hidden = !stubs;
    $("#stubN").textContent = String(stubs);
  }
  function paintList() {
    $("#traceCount").textContent = parts.length ? `${partTotal(parts)} parts` : ""; // the same total as the ring: two buttons with one name are two parts, listed once as x2
    list.innerHTML = parts.map((p) => `<li><button type="button" class="tl-btn" data-part="${esc(p.id)}"><i class="sw ${p.term}" aria-hidden="true"></i><span class="tl-name">${esc(p.name)}</span><span class="tl-where">${esc(p.word)}, ${esc(p.where)}</span></button></li>`).join("");
    if (selectedId) list.querySelector(`[data-part="${CSS.escape(selectedId)}"]`)?.setAttribute("aria-current", "true");
  }

  // ---------- selecting a part: highlight it on the Map, and scroll to and mark it on the page ----------
  let selectedId = null, pickTimer = 0;
  function pick(id, { fromMap = true } = {}) {
    selectedId = id;
    $$(list, ".tl-btn").forEach((b) => b.removeAttribute("aria-current"));
    const p = id ? parts.find((x) => x.id === id) : null;
    if (!p) { mapPick.innerHTML = `<span class="mp-none">Pick a part to see where it comes from.</span>`; map.select(null); return; }
    list.querySelector(`[data-part="${CSS.escape(id)}"]`)?.setAttribute("aria-current", "true");
    list.querySelector(`[data-part="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest" });
    mapPick.innerHTML = `<span class="mp-text"><i class="sw ${p.term}" aria-hidden="true"></i>${esc(p.text)}</span><button class="btn sm" type="button" data-show="${esc(id)}">Show on the page</button>`;
    if (fromMap) map.select(id); else map.select(id, { center: true });
    markOnPage(id, false);
  }
  function $$(r, s) { return [...r.querySelectorAll(s)]; }
  // Scroll the page's own scroller so the part is mid-view (never the window), and mark it for a moment.
  function markOnPage(id, flash = true) {
    const els = $$(pv, `[data-id="${CSS.escape(id)}"]`);
    $$(pv, ".picked").forEach((el) => el.classList.remove("picked"));
    if (!els[0]) return;
    const r = els[0].getBoundingClientRect(), b = body.getBoundingClientRect();
    body.scrollTo({ top: Math.max(0, r.top - b.top + body.scrollTop - body.clientHeight / 2 + r.height / 2), behavior: host.reduced() || view === "map" ? "auto" : "smooth" });
    for (const el of els) el.classList.add("picked");
    clearTimeout(pickTimer);
    if (flash) pickTimer = setTimeout(() => $$(pv, ".picked").forEach((el) => el.classList.remove("picked")), 2600); // chosen on the Map: it stays marked until the next pick
  }
  function showOnPage(id) { setView("page"); markOnPage(id, true); }

  // ---------- Page / Map ----------
  function setView(v) {
    if (v === view) return;
    view = v;
    const isMap = v === "map";
    mid.dataset.view = v;
    mapBox.hidden = !isMap; canvas.hidden = isMap;
    vPage.setAttribute("aria-pressed", String(!isMap)); vMap.setAttribute("aria-pressed", String(isMap));
    body.inert = isMap; rail.inert = isMap; // the page is still laid out under the Map (so a part can be scrolled to), but out of reach
    if (isMap) { mapSide.append(list); listHome.hidden = true; map.show(true); settleAll(); if (selectedId) map.select(selectedId); }
    else { listHome.querySelector(".tl-holder").append(list); listHome.hidden = false; map.show(false); syncSize(); repaint(); }
  }
  function toggleView() { setView(view === "page" ? "map" : "page"); }

  // ---------- wiring ----------
  bReplay.addEventListener("click", replay);
  vPage.addEventListener("click", () => setView("page"));
  vMap.addEventListener("click", () => setView("map"));
  $("#mapFit").addEventListener("click", () => map.fit());
  $("#mapIn").addEventListener("click", () => map.zoomIn());
  $("#mapOut").addEventListener("click", () => map.zoomOut());
  list.addEventListener("click", (e) => {
    const b = e.target.closest(".tl-btn");
    if (!b) return;
    if (view === "map") pick(b.dataset.part, { fromMap: false });
    else markOnPage(b.dataset.part, true);
  });
  mapPick.addEventListener("click", (e) => { const b = e.target.closest("[data-show]"); if (b) showOnPage(b.dataset.show); });
  body.addEventListener("scroll", repaint, { passive: true });
  railEps.addEventListener("scroll", repaint, { passive: true });
  rail.addEventListener("scroll", repaint, { passive: true });
  new ResizeObserver(() => { syncSize(); repaint(); }).observe(mid);
  addEventListener("resize", () => { syncSize(); repaint(); });
  // theme and Presenter mode are attributes of <html>: re-read the colours and redraw
  new MutationObserver(() => { pal = null; map.repaintTheme(); repaint(); }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-present"] });
  const scheme = matchMedia("(prefers-color-scheme: dark)"); scheme.addEventListener?.("change", () => { pal = null; map.repaintTheme(); repaint(); });
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  motion.addEventListener?.("change", () => { if (motion.matches) settleAll(); bReplay.disabled = motion.matches || !parts.length; paintReplayHint(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) settleAll(); else repaint(); }); // a hidden tab does no work, and comes back settled
  function paintReplayHint() { bReplay.title = host.reduced() ? "Motion is reduced on this device, so the traced paths are already drawn." : "Run the trace again over the result. Nothing is sent to the server."; }
  paintReplayHint();
  pick(null);

  return {
    begin, update, stop, replay, toggleView, setView,
    // the fit screen was shown or hidden: a screen that comes back is drawn settled
    screen(name) { active = name === "fit"; if (active) { syncSize(); settleAll(); } else { stop(); } },
    get view() { return view; },
    metrics: () => ({ ...metrics, queue: { waiting: queue.waiting, travelling: queue.travelling, speed: queue.speed }, map: { ...map.stats }, entries: entries.size }),
    map, canvas, // for the stress test (the Map's own numbers) and screenshots
    debug: { entries: () => [...entries.values()].map((e) => ({ id: e.id, state: e.state, term: e.part.term, ep: e.part.src.endpoint })), parts: () => parts, queue },
  };
}
