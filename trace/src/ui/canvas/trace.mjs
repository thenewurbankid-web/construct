// The Trace canvas layer of the fit screen. It only READS the page: it finds the real elements (a part's data-id, an
// endpoint chip in the Contract rail), turns their rectangles into paths, and animates a pulse along each one as the part
// resolves. It never changes a result, a state or any generated output; the only DOM it writes is its own (the rail, the
// list of facts, the Map's panel, the replay button and view toggle).
//
// Everything the canvas shows is also text: the rail lists the endpoints with their counts, and "The trace, as a list"
// says, for every part, what it is and where it comes from. The canvases are aria-hidden and decorative.
import { buildParts, buildMap, breakdownByEndpoint, partTotal, endpointKey, tieCandidateRows, missingRows, fitRowGroups, fieldsOf, compatibleEndpoints } from "./parts.mjs";
import { createPulseQueue } from "./queue.mjs";
import { routeFor, pulsePhase, rectRight, rectLeft, rectVisible } from "./geometry.mjs";
import { readPalette, sizeCanvas, drawSettled, drawPulse } from "./render.mjs";
import { createMap } from "./map.mjs";
import { TERMS, plainOption } from "../vocab.mjs";
import { parseEdited, patchExample } from "./contract-edit.mjs";
import { transformKindsFor, previewTransform, transformLabel } from "./adapter.mjs";

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const RING_MS = 520;

// LIN-224: the rail glyph + "Bind this condition" treatment "if" got in R6.50 (docs/design/mark-as-list-
// managed-expression.md), extended to "ternary" and "switch" -- same ⚡ glyph, a kind-specific title so the two
// read differently on hover/VO. "list" is not in this map: its rows group under the endpoint panel instead
// (see the "Fields used by this run" ×N grouping), not a rail glyph.
const EXPR_GLYPH_TITLE = { if: "Conditional", ternary: "Ternary", switch: "Switch" };
function exprGlyphHtml(exprKind) {
  const title = EXPR_GLYPH_TITLE[exprKind];
  return title ? `<span class="expr-glyph" aria-hidden="true" title="${esc(title)}">⚡</span>` : "";
}

// host: { present(), reduced(), toast(msg), contract(example) -> Promise<apis[]>,
//         rawContract(example) -> {raw: string|null, file: string|null} (sync; LIN-90 §2's Edit),
//         saveContract(example, text) -> Promise<{ok: true}|{ok: false, error: string}>,
//         saveAdapter(example, entry) -> Promise<{ok: true, adapter, resolved}|{ok: false, error}> (LIN-190:
//           `resolved` says whether the run's open Tie was answered in the same request),
//         runId() -> string|null (LIN-190: the live run to resolve, if any) }
export function createTrace(host) {
  const canvas = $("#traceCanvas"), ctx = canvas.getContext("2d");
  const mid = $("#stageMid"), body = $("#stageBody"), pv = $("#pv"), rail = $("#rail"), railEps = $("#railEps"), railHead = $("#railHead"), railStub = $("#railStub");
  const bReplay = $("#bTrace"), vPage = $("#vPage"), vMap = $("#vMap"), mapBox = $("#map"), list = $("#traceList"), listHome = $("#traceDetails"), mapSide = $("#mapSide"), mapPick = $("#mapPick");
  const epSlot = $("#focusSlot"); // LIN-117 §5: "the focus slot" — one mount, API details or a part's own details, never both

  let apis = [], parts = [], entries = new Map(), pal = null, raf = 0, painting = false, dpr = 1, size = { w: 0, h: 0 }, openQuestion = null, exampleId = null, editing = null;
  let pageEpKey = null, epTarget = mapPick; // the Page view's own details card (LIN-90 owner comment 2026-09-29 §1-2): opens in #epSlot instead of switching to the Map
  let focusedPart = null; // LIN-117 §5: the other thing #epSlot ("the focus slot") can hold — a part's own details, mutually exclusive with pageEpKey
  let highlightId = null; // LIN-130: the part whose wire glows on the canvas, symmetric with the .picked ring highlightPart() puts on the page
  let adapterDraft = null; // LIN-90 §5: the "Create adapter" dialog's in-progress choice, when a Tie has zero compatible endpoints: { partId, endpoint, field, transform, params, saving, saveError }
  let adapterMap = {}; // LIN-117 §7: every saved adapter this run, { [operationId]: { [field]: {transform, params, savedAt} } } — read once per run, not a lookup per rail chip
  // R6.50: client-side-only binding of a managed-expression part ("if" kind, so far) to an API field — no
  // persistence, no contract write. A later release (R6.51) gives each kind's option its own body/persistence;
  // this is only the rail's immediate visual feedback for "bind this condition".
  let exprBindings = new Map(); // part id -> { endpoint, field }
  let lastTree = null, lastStates = null, lastQuestion = null, lastExprKinds = []; // so a binding can re-run update() with the same args it last had
  let adapterView = null; // LIN-117 §7: the endpoint key whose saved adapters are shown in the focus slot — the slot's third occupant, mutually exclusive with pageEpKey/focusedPart
  let active = false, view = "page", runId = 0, slowKey = "";
  const queue = createPulseQueue();
  const metrics = { paints: 0, frames: 0, ms: 0, max: 0 };
  // LIN-257: compatibleOf is computed once per drag-start (never per frame — parts/apis don't change mid-drag) from
  // the same deterministic compatibleEndpoints() the API panel's own "no match -> Create adapter" path already
  // uses. onAttach is a no-op here for now: persisting a drop as a recorded decision is a separate ticket's work.
  const map = createMap({
    box: mapBox, canvas: $("#mapCanvas"), onSelect: (n) => pick(n?.id ?? null), onHover: () => {},
    compatibleOf: (partId) => new Set(compatibleEndpoints(parts.find((p) => p.id === partId), apis).map((a) => `ep:${endpointKey(a)}`)),
    onAttach: () => {},
  });

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
      const hl = e.id === highlightId;
      if (e.state === "travelling" || e.state === "ringing") drawPulse(ctx, r.route, pulsePhase(now - e.item.startedAt, e.item.dur, RING_MS), pal, S1, r.chip, hl);
      else drawSettled(ctx, r.route, pal, S1, hl);
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
    entries = new Map(); parts = []; apis = []; exampleId = sc.example; editing = null; adapterDraft = null; adapterMap = {};
    exprBindings = new Map(); lastTree = null; lastStates = null; lastQuestion = null; lastExprKinds = [];
    pageEpKey = null; focusedPart = null; adapterView = null; highlightId = null; epSlot.hidden = true; epSlot.classList.remove("open"); epSlot.innerHTML = "";
    paintRail(); paintList(); map.setData(null);
    bReplay.disabled = true;
    setView("page");
    let got = [];
    try { got = await host.contract(sc.example); } catch { got = []; }
    if (id !== runId) return;
    apis = got;
    paintRail();
    repaint();
    try { adapterMap = (await host.adapters?.(sc.example)) ?? {}; } catch { adapterMap = {}; } // LIN-117 §7: not on the critical path — the rail chips fade in once this resolves
    if (id !== runId) return;
    paintRail();
  }
  function stop() { runId++; queue.drain(); if (raf) { cancelAnimationFrame(raf); raf = 0; } for (const e of entries.values()) e.state = "settled"; }

  // docs/design/panel-layout-focus-slot.md §4: re-lays the Map with the open endpoint's own Gap wires retargeted to
  // their own row instead of the shared "gap" node — called on every new result and whenever pageEpKey changes.
  function refreshMap() { map.setData(buildMap(parts, apis, { openEndpoint: pageEpKey })); }

  // Called with each matched result. Only a part whose outcome changed gets a new pulse.
  // exprKindParts: managed-expression synthetic rows (R6.50, "if" kind so far — src/inspector/expr-kinds.mjs),
  // one more part per record, not merged onto any existing leaf's row (docs/design/mark-as-list-managed-
  // expressions.md §1: a registry entry's key is the part's own id).
  function update(tree, states, question = null, exprKindParts = []) {
    openQuestion = question ?? null;
    lastTree = tree; lastStates = states; lastQuestion = question; lastExprKinds = exprKindParts;
    // A skipped Ask leaves a Tie or Gap without the endpoint it was first matched to: keep what was known while the outcome is the same.
    const before = new Map([...entries].map(([id, e]) => [id, e.part]));
    const built = buildParts(tree, states, apis);
    for (const ek of exprKindParts) {
      if (built.some((p) => p.id === ek.id)) continue; // already represented as a real leaf: don't double it
      // LIN-221: seed the client-side Map from the server's persisted bind before reading it, so a part bound in
      // a previous session (or applied and then reloaded) shows "fit" immediately, not just after a fresh click.
      if (ek.bind && !exprBindings.has(ek.id)) exprBindings.set(ek.id, ek.bind);
      const bound = exprBindings.get(ek.id);
      const term = bound ? "fit" : "gap", word = TERMS[term].word;
      const where = bound ? `from ${bound.endpoint} (${bound.field})` : "nothing behind it in the API";
      built.push({
        id: ek.id, group: "exprKind", name: ek.label, term, word, where, count: 1,
        text: `${ek.label}: ${word}, ${where}`,
        src: { endpoint: bound?.endpoint ?? null, field: bound?.field ?? null, need: null, kept: false },
        dataType: null, order: built.length, exprKind: ek.exprKind, exprCondition: ek.exprCondition,
      });
    }
    parts = built.map((p) => { const o = before.get(p.id); return o && o.term === p.term && p.term !== "fit" && !p.src.endpoint && o.src.endpoint ? { ...o, order: p.order } : p; });
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
    refreshMap();
    bReplay.disabled = host.reduced() || !parts.length;
    if (pageEpKey && !editing) pickPageEp(pageEpKey); // LIN-117 §3: the open details card's tie-row list tracks the live question, not just its own open/close
    else if (focusedPart) { const p = parts.find((x) => x.id === focusedPart); if (p) epSlot.innerHTML = partDetailsHtml(p); else closePageEp(); } // LIN-117 §5: a focused part's own facts track the live run too
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
      // LIN-117 §7: "⇄ adapter" — the persistent indicator that this endpoint has a saved adapter, visible even
      // when the focus slot holds something else. A real <button aria-expanded>, same disclosure convention as
      // §2's pinned Ask bar; text, not an icon-only glyph, so its meaning doesn't depend on reading "⇄".
      const adapterCount = Object.keys(adapterMap[k] ?? {}).length;
      const adapterChip = adapterCount ? `<button type="button" class="adapter-chip" data-adapter-chip="${esc(k)}" aria-expanded="${adapterView === k}">⇄ adapter</button>` : "";
      return `<li class="ep${k === pageEpKey ? " active" : ""}" data-ep="${esc(k)}" title="${esc(k)}" tabindex="0" role="button" aria-pressed="${k === pageEpKey}" aria-label="${esc(k)}, open contract"><span class="method ${esc(a.method)}">${esc(a.method)}</span><span class="ep-path">${esc(a.path).replace(/([/\-])/g, "$1<wbr>")}</span>${bits.length ? `<span class="ep-n">${bits.join(" · ")}</span>` : ""}${adapterChip}</li>`;
    }).join("") || `<li class="ep-none">The contract shows here.</li>`;
    railStub.hidden = !stubs;
    $("#stubN").textContent = String(stubs);
  }
  function paintList() {
    $("#traceCount").textContent = parts.length ? `${partTotal(parts)} parts` : ""; // the same total as the ring: two buttons with one name are two parts, listed once as x2
    list.innerHTML = parts.map((p) => `<li><button type="button" class="tl-btn" data-part="${esc(p.id)}"><i class="sw ${p.term}" aria-hidden="true"></i>${exprGlyphHtml(p.exprKind)}<span class="tl-name">${esc(p.name)}</span><span class="tl-where">${esc(p.word)}, ${esc(p.where)}</span></button></li>`).join("");
    if (selectedId) list.querySelector(`[data-part="${CSS.escape(selectedId)}"]`)?.setAttribute("aria-current", "true");
  }

  // ---------- the API contract panel: what clicking an API card (an ep:* node) shows ----------
  // Re-upload and "gaps in the contract" are not wired here yet. See docs/design/run-api-panel-and-wires.md §3.
  // Edit (§2): only offered when the contract is a JSON-format file (host.rawContract's `raw` is loaded) and
  // this endpoint has a response example to seed the textarea from — the one shape every generated contract in
  // examples/ actually has. Save re-validates as JSON, patches just this endpoint's example into the file's own
  // text (contract-edit.mjs, pure + unit-tested) and saves it through the existing POST /api/openapi.
  // LIN-117 §3: the open tie's own candidate fields, as clickable rows inside "Fields used by this run" — a
  // more specific drop target than the whole card (see docs/design/panel-layout-focus-slot.md §3). Reuses the
  // same `data-answer` -> answer(index) path attachChooserHtml() already wires from the Map's sidebar. The row
  // set itself is `tieCandidateRows()` (parts.mjs, pure + unit-tested); this just renders it.
  // LIN-224 §5 ("list"): a list's item fields share one `list.<field>` id namespace and tree group, so they
  // group into one row with a ×N badge instead of N flat rows — same links (`data-part`, same click target),
  // just nested under the list's own name. Grouping itself is `fitRowGroups()` (parts.mjs, pure + unit-tested).
  function fitRowsHtml(fit) {
    return fitRowGroups(fit).map((e) => e.kind === "single"
      ? `<li><button type="button" class="ep-field-link" data-part="${esc(e.part.id)}"><code>${esc(e.part.src.field)}</code> &rarr; ${esc(e.part.name)}</button></li>`
      : `<li class="ep-field-group"><h5 class="ep-field-group-head">${esc(e.group)}<span class="ep-n">&times;${e.parts.length}</span></h5><ul class="ep-fields">
          ${e.parts.map((p) => `<li><button type="button" class="ep-field-link" data-part="${esc(p.id)}"><code>${esc(p.src.field)}</code> &rarr; ${esc(p.name)}</button></li>`).join("")}
        </ul></li>`).join("");
  }
  function tieRowsHtml(tie) {
    if (!tie.length) return "";
    const rows = tieCandidateRows(openQuestion, tie);
    if (!rows.length) return `<li class="ep-field-note">${tie.length} part${tie.length === 1 ? "" : "s"} waiting on a tie here</li>`;
    return `<li class="ep-field-note">This tie is still open — attach it here or on the Ask card:</li>
      ${rows.map(({ i, field, option }) => `<li><button type="button" class="ep-field-link ep-field-target" data-answer="${i}"><kbd>${i + 1}</kbd><code>${esc(field)}</code> &rarr; ${esc(plainOption(option))}</button></li>`).join("")}`;
  }
  // LIN-117 §4: fields the design needs but this endpoint's contract doesn't have, as dashed "missing" rows
  // below "Fields used by this run" (see docs/design/panel-layout-focus-slot.md §4). Not draggable/clickable to
  // attach (a Gap has no field to attach to — the fix is a contract edit): the row opens the panel's existing
  // Edit mode instead. Row set is `missingRows()` (parts.mjs, pure + unit-tested).
  function missingHtml(gap) {
    if (!gap.length) return "";
    const rows = missingRows(gap);
    return `<h4>Missing (${rows.length})</h4><ul class="ep-fields ep-missing">
      ${rows.map((r) => `<li><button type="button" class="ep-field-link ep-missing-row" data-missing-row="${esc(r.id)}" title="Edit the contract to add this field"><span class="ep-missing-dash" aria-hidden="true">┄</span>${esc(r.text)}<span class="ep-missing-tag">missing</span></button></li>`).join("")}
    </ul>`;
  }
  // R6.50 ("if"), extended LIN-224 (ternary/switch): an unbound managed-expression part has no `src.endpoint`
  // of its own, so it doesn't belong to any one endpoint's "used" list — it is offered against every endpoint's
  // own fields, same as a Tie would be. "list" is excluded: it binds through the endpoint panel's own ×N row,
  // not a condition-to-field link.
  function bindExprHtml(api) {
    const unbound = parts.filter((p) => p.exprKind in EXPR_GLYPH_TITLE && p.term === "gap");
    if (!unbound.length) return "";
    const fields = fieldsOf(api);
    if (!fields.length) return "";
    return `<h4>Bind this condition</h4><ul class="ep-fields">
      ${unbound.map((p) => fields.map((f) => `<li><button type="button" class="ep-field-link" data-bind-expr="${esc(p.id)}" data-bind-field="${esc(f.name)}">⚡ ${esc(p.exprCondition)} &rarr; <code>${esc(f.name)}</code></button></li>`).join("")).join("")}
    </ul>`;
  }
  function endpointPanelHtml(api) {
    const key = endpointKey(api);
    const used = parts.filter((p) => p.src.endpoint === key);
    const fit = used.filter((p) => p.term === "fit" && p.src.field);
    const tie = used.filter((p) => p.term === "tie");
    const gap = used.filter((p) => p.term === "gap");
    const isEditing = editing?.key === key;
    const canEdit = !isEditing && api.response !== undefined && !!host.rawContract?.(exampleId)?.raw;
    const body = (label, val) => val === undefined
      ? `<p class="ep-none">No example ${label} in the contract.</p>`
      : `<pre class="ep-json">${esc(JSON.stringify(val, null, 2))}</pre>`;
    const field = (label, name) => {
      const f = editing[name];
      if (!f) return "";
      return `<div class="ep-edit-field" data-field="${name}"><h4>${label}</h4><textarea class="ep-edit" data-ep-field="${name}" aria-label="${label} JSON" ${editing.busy ? "disabled" : ""}>${esc(f.text)}</textarea><div class="ep-edit-err" data-err="${name}">${f.error ? `<p class="ct-err">${esc(f.error)}</p>` : ""}</div></div>`;
    };
    const editBody = () => `${field("Request", "request")}${field("Response", "response")}
      ${editing.saveError ? `<p class="ct-err" data-save-err>${esc(editing.saveError)}</p>` : ""}
      <div class="ep-edit-actions"><button type="button" class="btn sm" data-cancel-edit ${editing.busy ? "disabled" : ""}>Cancel</button><button type="button" class="btn sm go" data-save-edit ${hasEditErrors() || editing.busy ? "disabled" : ""}>${editing.busy ? "Saving…" : "Save"}</button></div>`;
    return `<div class="ep-panel">
      <div class="ep-panel-head"><span class="method ${esc(api.method)}">${esc(api.method)}</span><code>${esc(api.path)}</code>${canEdit ? `<button type="button" class="btn sm" data-edit-ep>Edit</button>` : ""}<button type="button" class="btn sm icon-only" data-close-ep aria-label="Close">&#10005;</button></div>
      ${isEditing ? editBody() : `${api.request !== undefined ? `<h4>Request</h4>${body("request", api.request)}` : ""}<h4>Response</h4>${body("response", api.response)}`}
      ${fit.length || tie.length ? `<h4>Fields used by this run</h4><ul class="ep-fields">
        ${fitRowsHtml(fit)}
        ${tieRowsHtml(tie)}
      </ul>` : ""}
      ${missingHtml(gap)}
      ${bindExprHtml(api)}
    </div>`;
  }
  function hasEditErrors() { return !!(editing?.request?.error || editing?.response?.error); }
  function pickEndpoint(key) {
    epTarget = mapPick;
    const api = apis.find((a) => endpointKey(a) === key);
    if (editing && editing.key !== key) editing = null;
    epTarget.innerHTML = api ? endpointPanelHtml(api) : `<span class="mp-none">This API is not in the contract.</span>`;
  }
  function startEdit(api) {
    const key = endpointKey(api);
    editing = { key, method: api.method, path: api.path, busy: false, saveError: null };
    if (api.request !== undefined) editing.request = { text: JSON.stringify(api.request, null, 2), error: null };
    editing.response = { text: JSON.stringify(api.response, null, 2), error: null };
    epTarget.innerHTML = endpointPanelHtml(api);
  }
  function cancelEdit() {
    const api = apis.find((a) => endpointKey(a) === editing?.key);
    editing = null;
    if (api) epTarget.innerHTML = endpointPanelHtml(api);
  }
  function editInput(name, text) {
    if (!editing?.[name]) return;
    editing[name].text = text;
    const r = parseEdited(text);
    editing[name].error = r.ok ? null : r.error;
    const wrap = epTarget.querySelector(`.ep-edit-field[data-field="${name}"] .ep-edit-err`);
    if (wrap) wrap.innerHTML = editing[name].error ? `<p class="ct-err">${esc(editing[name].error)}</p>` : "";
    const save = epTarget.querySelector("[data-save-edit]");
    if (save) save.disabled = hasEditErrors();
  }
  async function saveEdit() {
    if (!editing || hasEditErrors() || editing.busy) return;
    const api = apis.find((a) => endpointKey(a) === editing.key);
    const raw = host.rawContract?.(exampleId)?.raw;
    if (!api || !raw) { editing.saveError = "This contract can't be edited here."; epTarget.innerHTML = endpointPanelHtml(api ?? {}); return; }
    let doc;
    try {
      doc = JSON.parse(raw);
      if (editing.request) doc = patchExample(doc, api, "request", parseEdited(editing.request.text).value);
      doc = patchExample(doc, api, "response", parseEdited(editing.response.text).value);
    } catch (e) {
      editing.saveError = e.message;
      epTarget.innerHTML = endpointPanelHtml(api);
      return;
    }
    editing.busy = true; editing.saveError = null;
    epTarget.innerHTML = endpointPanelHtml(api);
    const res = await host.saveContract(exampleId, JSON.stringify(doc, null, 2));
    if (!res.ok) {
      editing.busy = false; editing.saveError = res.error;
      epTarget.innerHTML = endpointPanelHtml(api);
      return;
    }
    const wasPage = epTarget === epSlot;
    let got = [];
    try { got = await host.contract(exampleId); } catch { got = []; }
    apis = got; editing = null; paintRail();
    if (wasPage) pickPageEp(endpointKey(api));
    else pickEndpoint(endpointKey(api));
  }

  // ---------- the Page view's own focus slot (#epSlot — LIN-90 owner comment 2026-09-29 §1-2, generalized by
  // LIN-117 §5): opens above the existing Ask/progress cards in #side, in place, instead of switching to the
  // Map. One slot, one thing at a time — API details (openContract) and a part's own details (focusPart) are
  // mutually exclusive, each clearing the other's state before it renders. The adapter card (§7) is not built
  // yet — a later block, and will be the slot's third occupant.
  function pickPageEp(key) {
    epTarget = epSlot;
    const api = apis.find((a) => endpointKey(a) === key);
    editing = null;
    epSlot.innerHTML = api ? endpointPanelHtml(api) : `<span class="mp-none">This API is not in the contract.</span>`;
  }
  function openSlot() {
    epSlot.hidden = false;
    if (host.reduced()) epSlot.classList.add("open");
    else requestAnimationFrame(() => epSlot.classList.add("open"));
    epSlot.focus();
    host.epChanged?.();
  }
  function openContract(key) {
    if (pageEpKey === key) return closePageEp();
    pageEpKey = key; focusedPart = null; adapterView = null;
    pickPageEp(key);
    paintRailActive();
    openSlot();
    refreshMap();
  }
  // LIN-117 §5: clicking a field row inside the API details card (previously a dead button — see the fit-row
  // link in endpointPanelHtml) now shows that part's own details in the same slot, replacing the API details —
  // the same facts and Tie chooser partPickHtml() gives the Map's own part-pick sidebar, in the panel-head/body
  // shape endpointPanelHtml() already established for this slot.
  function partDetailsHtml(p) {
    return `<div class="ep-panel">
      <div class="ep-panel-head"><span class="mp-text"><i class="sw ${p.term}" aria-hidden="true"></i>${esc(p.text)}</span><button type="button" class="btn sm icon-only" data-close-ep aria-label="Close">&#10005;</button></div>
      ${attachChooserHtml(p)}
      <button type="button" class="btn sm" data-show="${esc(p.id)}">Show on the page</button>
    </div>`;
  }
  function focusPart(id) {
    const p = parts.find((x) => x.id === id);
    if (!p) return;
    const hadEp = !!pageEpKey;
    pageEpKey = null; focusedPart = id; adapterView = null; editing = null;
    epTarget = epSlot;
    paintRailActive(); // pageEpKey is now null, so no rail chip stays marked active
    if (hadEp) refreshMap();
    epSlot.innerHTML = partDetailsHtml(p);
    openSlot();
  }
  // LIN-117 §7: the "⇄ adapter" chip's expand — the saved mapping(s) for this endpoint, read-only, in the same
  // "one thing in the slot" shape as endpointPanelHtml()/partDetailsHtml(). Editing an already-saved adapter
  // that isn't backing a currently-open Tie is out of scope here (see this release's changelog note) — the
  // create/edit dialog (adapterSectionHtml) stays reachable from an open Tie, same as before this block.
  function adapterViewHtml(key) {
    const api = apis.find((a) => endpointKey(a) === key);
    const rows = Object.entries(adapterMap[key] ?? {});
    return `<div class="ep-panel">
      <div class="ep-panel-head"><span class="method ${esc(api?.method ?? "")}">${esc(api?.method ?? "")}</span><code>${esc(api?.path ?? key)}</code><button type="button" class="btn sm icon-only" data-close-ep aria-label="Close">&#10005;</button></div>
      <h4>Adapter${rows.length === 1 ? "" : `s (${rows.length})`}</h4>
      <ul class="ep-fields">${rows.map(([field, m]) => `<li class="ep-field-note"><code>${esc(field)}</code> &rarr; ${esc(transformLabel(m.transform))}</li>`).join("")}</ul>
      <p class="mp-attach-label">Runtime-only: applies to this run, not saved into the contract file.</p>
    </div>`;
  }
  function focusAdapter(key) {
    if (!Object.keys(adapterMap[key] ?? {}).length) return;
    const hadEp = !!pageEpKey;
    pageEpKey = null; focusedPart = null; adapterView = key; editing = null; adapterDraft = null;
    epTarget = epSlot;
    paintRailActive();
    if (hadEp) refreshMap();
    epSlot.innerHTML = adapterViewHtml(key);
    openSlot();
  }
  function closePageEp() {
    if (!pageEpKey && !focusedPart && !adapterView) return;
    const hadEp = !!pageEpKey;
    pageEpKey = null; focusedPart = null; adapterView = null; editing = null;
    paintRailActive();
    if (hadEp) refreshMap();
    epSlot.classList.remove("open");
    host.epChanged?.();
    const done = () => { epSlot.hidden = true; epSlot.innerHTML = ""; };
    if (host.reduced()) done();
    else epSlot.addEventListener("transitionend", done, { once: true });
  }
  function paintRailActive() {
    for (const li of railEps.children) {
      const on = li.dataset.ep === pageEpKey;
      li.classList.toggle("active", on); li.setAttribute("aria-pressed", String(on));
      li.querySelector("[data-adapter-chip]")?.setAttribute("aria-expanded", String(li.dataset.ep === adapterView)); // LIN-117 §7
    }
  }

  // ---------- attaching an open Tie straight from the Map (LIN-90 §4, scoped) ----------
  // A Tie's question is still the same one the Ask card answers (the pipeline is the single source of truth for
  // "which field?"): reuse its own options and the existing `data-answer` -> answer(index) wiring in demo.mjs's
  // click handler, so this is not a second way to decide, just a second place to see and act on the same open
  // question. A Tie already skipped/settled has no `run.waiting` server-side to answer against (see LIN-90
  // comments), so it has no chooser here until that gets its own persistence.
  function attachChooserHtml(p) {
    if (p.term !== "tie" || !openQuestion || openQuestion.id.split("#")[0] !== p.id) return "";
    return `<div class="mp-attach">
      <p class="mp-attach-label">This tie is still open — attach it here or on the Ask card:</p>
      <ul class="mp-attach-list">${openQuestion.options.map((o, i) => `<li><button type="button" class="opt" data-answer="${i}"><kbd>${i + 1}</kbd><span>${esc(o.label)}</span></button></li>`).join("")}</ul>
      ${compatibleEndpoints(p, apis).length === 0 ? adapterSectionHtml(p) : ""}
    </div>`;
  }

  // ---------- LIN-90 §5: "Create adapter" — a field/type mapping when zero endpoints are directly compatible ----------
  // Save persists the mapping (host.saveAdapter -> POST /api/adapter, runtime-only, docs/ADAPTER-PERSISTENCE.md)
  // AND resolves the open Tie in the same request (LIN-190: the pipeline's answer path now accepts an
  // adapter-sourced value, ask.mjs's adapterAnswer) — the toast reflects whichever actually happened.
  function adapterSectionHtml(p) {
    if (adapterDraft?.partId !== p.id) return `<div class="mp-adapter"><p class="mp-attach-label">No matching API for this field.</p><button type="button" class="btn sm" data-adapter-open="${esc(p.id)}">Create adapter…</button></div>`;
    const d = adapterDraft;
    const api = apis.find((a) => endpointKey(a) === d.endpoint);
    const fields = api ? fieldsOf(api) : [];
    const field = fields.find((f) => f.name === d.field);
    const kinds = field ? transformKindsFor(field.type, p.dataType) : [];
    const preview = field && d.transform ? previewTransform(d.transform, d.params, field.value) : null;
    return `<div class="mp-adapter">
      <p class="mp-attach-label">Map ${esc(p.name)} through an adapter:</p>
      <label class="mp-adapter-row">from API<select data-adapter-endpoint><option value="">Choose an endpoint…</option>${apis.map((a) => `<option value="${esc(endpointKey(a))}" ${d.endpoint === endpointKey(a) ? "selected" : ""}>${esc(endpointKey(a))}</option>`).join("")}</select></label>
      ${api ? `<label class="mp-adapter-row">field<select data-adapter-field><option value="">Choose a field…</option>${fields.map((f) => `<option value="${esc(f.name)}" ${d.field === f.name ? "selected" : ""}>${esc(f.name)} (${esc(f.type)})</option>`).join("")}</select></label>` : ""}
      ${field ? `<label class="mp-adapter-row">mapping<select data-adapter-kind><option value="">Choose a mapping…</option>${kinds.map((k) => `<option value="${esc(k.id)}" ${d.transform === k.id ? "selected" : ""}>${esc(k.label)}</option>`).join("")}</select></label>` : ""}
      ${d.transform && field ? adapterParamsHtml(d, field) : ""}
      ${preview ? preview.ok ? `<p class="mp-adapter-preview ok">preview: ${esc(String(field.value))} &rarr; ${esc(String(preview.value))} &#10003; valid</p>` : `<p class="ct-err">${esc(preview.error)}</p>` : ""}
      ${d.saveError ? `<p class="ct-err">${esc(d.saveError)}</p>` : ""}
      <div class="ep-edit-actions">
        <button type="button" class="btn sm" data-adapter-cancel ${d.saving ? "disabled" : ""}>Cancel</button>
        <button type="button" class="btn sm go" data-adapter-save ${!preview?.ok || d.saving ? "disabled" : ""}>${d.saving ? "Saving…" : "Save adapter"}</button>
      </div>
    </div>`;
  }
  function adapterParamsHtml(d, field) {
    if (d.transform === "map") {
      const key = String(field.value), mapped = d.params.table?.[key] ?? "";
      return `<label class="mp-adapter-row">when ${esc(key)}, use<input type="text" data-adapter-map-value="${esc(key)}" value="${esc(mapped)}" placeholder="mapped value"></label>`;
    }
    if (d.transform === "substring") return `<label class="mp-adapter-row">start<input type="number" min="0" data-adapter-param="start" value="${d.params.start ?? 0}"></label><label class="mp-adapter-row">end<input type="number" min="0" data-adapter-param="end" value="${d.params.end ?? ""}"></label>`;
    if (d.transform === "regex") return `<label class="mp-adapter-row">pattern<input type="text" data-adapter-param="pattern" value="${esc(d.params.pattern ?? "")}"></label><label class="mp-adapter-row">replacement<input type="text" data-adapter-param="replacement" value="${esc(d.params.replacement ?? "")}"></label>`;
    return ""; // passthrough / stringify: no params to pick
  }
  function refreshAdapterHostFor(partId) {
    const p = parts.find((x) => x.id === partId);
    if (!p) return;
    if (selectedId === partId) mapPick.innerHTML = partPickHtml(p);
    if (focusedPart === partId) epSlot.innerHTML = partDetailsHtml(p);
  }
  // LIN-221: "Bind this condition" — persists through the same /api/part-apply (answers.json + history) as every
  // other part option, not just the client-side exprBindings Map. The Map still drives the immediate visual flip
  // to "fit" (no need to wait on a reload); it's just seeded from the server's own `bind` now too (see update()).
  async function bindExpr(partId, endpoint, field) {
    const ek = (lastExprKinds ?? []).find((p) => p.id === partId) ?? parts.find((p) => p.id === partId);
    const exprKind = ek?.exprKind;
    if (!exprKind) { host.toast?.("Could not tell what kind of condition this is."); return; }
    const res = await host.applyExprBind?.(exampleId, partId, exprKind, endpoint, field);
    if (!res?.ok) { host.toast?.(res?.error ?? "The bind could not be saved."); return; }
    exprBindings.set(partId, { endpoint, field });
    if (lastTree) update(lastTree, lastStates, lastQuestion, lastExprKinds);
    // update() re-renders the Page view's own open panel (pageEpKey) by itself; the Map's panel is a different
    // host (mapPick), refreshed here the same way the adapter dialog already does (refreshAdapterHostFor).
    if (selectedId?.startsWith("ep:")) pickEndpoint(selectedId.slice(3));
  }
  function openAdapterDraft(partId) { adapterDraft = { partId, endpoint: "", field: "", transform: "", params: {}, saving: false, saveError: null }; refreshAdapterHostFor(partId); }
  function cancelAdapterDraft() { const id = adapterDraft?.partId; adapterDraft = null; if (id) refreshAdapterHostFor(id); }
  function setAdapterEndpoint(v) { if (!adapterDraft) return; adapterDraft = { ...adapterDraft, endpoint: v, field: "", transform: "", params: {} }; refreshAdapterHostFor(adapterDraft.partId); }
  function setAdapterField(v) { if (!adapterDraft) return; adapterDraft = { ...adapterDraft, field: v, transform: "", params: {} }; refreshAdapterHostFor(adapterDraft.partId); }
  function setAdapterTransform(v) { if (!adapterDraft) return; adapterDraft = { ...adapterDraft, transform: v, params: {} }; refreshAdapterHostFor(adapterDraft.partId); }
  function setAdapterParam(key, v) { if (!adapterDraft) return; adapterDraft = { ...adapterDraft, params: { ...adapterDraft.params, [key]: v } }; refreshAdapterHostFor(adapterDraft.partId); }
  function setAdapterMapValue(fromKey, v) { if (!adapterDraft) return; adapterDraft = { ...adapterDraft, params: { ...adapterDraft.params, table: { ...(adapterDraft.params.table ?? {}), [fromKey]: v } } }; refreshAdapterHostFor(adapterDraft.partId); }
  async function saveAdapterDraft() {
    const d = adapterDraft;
    if (!d || d.saving) return;
    const p = parts.find((x) => x.id === d.partId);
    const api = apis.find((a) => endpointKey(a) === d.endpoint);
    const field = api ? fieldsOf(api).find((f) => f.name === d.field) : null;
    if (!p || !api || !field || !d.transform) return;
    const preview = previewTransform(d.transform, d.params, field.value);
    if (!preview.ok) return;
    adapterDraft = { ...d, saving: true, saveError: null };
    refreshAdapterHostFor(d.partId);
    // LIN-190: the run id lets the server resolve this same Tie in the same request (host.saveAdapter ->
    // POST /api/adapter's `run`/`questionId`, resolveRun in server.mjs) — "Save adapter & attach" in one action.
    const res = await host.saveAdapter(exampleId, { operationId: d.endpoint, field: d.field, transform: d.transform, params: d.params, fromType: field.type, toType: p.dataType, value: field.value, questionId: openQuestion?.id, run: host.runId?.() });
    if (!res.ok) { adapterDraft = { ...d, saving: false, saveError: res.error }; refreshAdapterHostFor(d.partId); return; }
    adapterDraft = null;
    adapterMap = { ...adapterMap, [d.endpoint]: { ...adapterMap[d.endpoint], [d.field]: res.adapter } }; // LIN-117 §7: the new chip shows right away, no re-fetch needed
    paintRail();
    host.toast?.(res.resolved ? "Adapter saved and attached." : "Adapter saved. It isn't attached to this tie yet — answer the Ask card to resolve it.");
    refreshAdapterHostFor(d.partId);
  }

  // A part's own facts, its Tie chooser (if it has one open) and a "Show on the page" button — the Map's
  // sidebar and the Page view's focus slot (LIN-117 §5) both render a part this same way, so there is one
  // shape for "part details" wherever it shows.
  function partPickHtml(p) { return `<span class="mp-text"><i class="sw ${p.term}" aria-hidden="true"></i>${esc(p.text)}</span>${attachChooserHtml(p)}<button class="btn sm" type="button" data-show="${esc(p.id)}">Show on the page</button>`; }

  // ---------- selecting a part: highlight it on the Map, and scroll to and mark it on the page ----------
  let selectedId = null, pickTimer = 0;
  function pick(id, { fromMap = true } = {}) {
    selectedId = id;
    $$(list, ".tl-btn").forEach((b) => b.removeAttribute("aria-current"));
    if (id?.startsWith("ep:")) { pickEndpoint(id.slice(3)); if (fromMap) map.select(id); else map.select(id, { center: true }); return; }
    const p = id ? parts.find((x) => x.id === id) : null;
    if (!p) { mapPick.innerHTML = `<span class="mp-none">Pick a part to see where it comes from.</span>`; map.select(null); return; }
    list.querySelector(`[data-part="${CSS.escape(id)}"]`)?.setAttribute("aria-current", "true");
    list.querySelector(`[data-part="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest" });
    mapPick.innerHTML = partPickHtml(p);
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
  // LIN-117 §6: a hover-only preview — the same accent ring markOnPage() uses, but no scroll (a passing hover
  // must never scroll-jack the page) and no auto-clear timer (mouseleave clears it explicitly, immediately).
  function highlightPart(id) {
    $$(pv, ".picked").forEach((el) => el.classList.remove("picked"));
    for (const el of $$(pv, `[data-id="${CSS.escape(id)}"]`)) el.classList.add("picked");
    highlightId = id; repaint(); // LIN-130: the wire glows too, symmetric with the ring above
  }
  function clearHighlight() { clearTimeout(pickTimer); $$(pv, ".picked").forEach((el) => el.classList.remove("picked")); highlightId = null; repaint(); }
  // Which part a hovered/clicked row in the focus slot or "the trace, as a list" names: a fit field link and a
  // missing row both carry the part id directly; a tie candidate row doesn't (its rows are keyed by option
  // index), but only one tie's rows are ever rendered at once — openQuestion's own part id — so that's it.
  function rowPartId(el) {
    return el.closest("[data-part]")?.dataset.part ?? el.closest("[data-missing-row]")?.dataset.missingRow
      ?? (el.closest(".ep-field-target") && openQuestion ? openQuestion.id.split("#")[0] : null);
  }
  // LIN-117 §6: click a part -> its API details open in the focus slot, scrolled to the field row it resolved
  // to (an anchor scroll, not a full re-render) — the one place hover-preview becomes a committed selection.
  // A part with nothing in the API (no src.endpoint) has no card to open: just mark it on the page, as before.
  function focusField(id) {
    const p = parts.find((x) => x.id === id);
    if (!p?.src.endpoint) return markOnPage(id, true);
    if (pageEpKey !== p.src.endpoint) { pageEpKey = p.src.endpoint; focusedPart = null; adapterView = null; pickPageEp(p.src.endpoint); paintRailActive(); openSlot(); refreshMap(); }
    markOnPage(id, true);
    requestAnimationFrame(() => {
      const anchor = epSlot.querySelector(`[data-part="${CSS.escape(id)}"], [data-missing-row="${CSS.escape(id)}"]`) ?? epSlot.querySelector(".ep-field-target, .ep-field-note");
      anchor?.scrollIntoView({ block: "nearest", behavior: host.reduced() ? "auto" : "smooth" });
    });
  }

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
    else focusField(b.dataset.part); // LIN-117 §6: opens/keeps the part's API details in the focus slot, scrolled to its field
  });
  // LIN-117 §6: hover a row in "the trace, as a list" -> a transient accent-ring preview on the design part,
  // symmetric with hovering a field row inside the focus slot below. Hover-only, so it has no keyboard path by
  // definition — the click path above (focusField) is the accessible route to the same information (Tab + Enter).
  list.addEventListener("mouseover", (e) => { const b = e.target.closest(".tl-btn"); if (b) highlightPart(b.dataset.part); });
  list.addEventListener("mouseout", (e) => { if (e.target.closest(".tl-btn") && !e.relatedTarget?.closest(".tl-btn")) clearHighlight(); });
  // LIN-90 §5: the "Create adapter" dialog's own click/change/input, shared by both hosts (mapPick, epSlot) the
  // same way the rest of this file's `data-*` handlers already are.
  function adapterClick(e) {
    const open = e.target.closest("[data-adapter-open]"); if (open) { openAdapterDraft(open.dataset.adapterOpen); return true; }
    if (e.target.closest("[data-adapter-cancel]")) { cancelAdapterDraft(); return true; }
    if (e.target.closest("[data-adapter-save]")) { saveAdapterDraft(); return true; }
    return false;
  }
  function adapterChange(e) {
    const ep = e.target.closest("select[data-adapter-endpoint]"); if (ep) { setAdapterEndpoint(ep.value); return; }
    const fl = e.target.closest("select[data-adapter-field]"); if (fl) { setAdapterField(fl.value); return; }
    const tr = e.target.closest("select[data-adapter-kind]"); if (tr) { setAdapterTransform(tr.value); return; }
  }
  function adapterInput(e) {
    const mv = e.target.closest("[data-adapter-map-value]"); if (mv) { setAdapterMapValue(mv.dataset.adapterMapValue, mv.value); return true; }
    const pm = e.target.closest("[data-adapter-param]"); if (pm) { setAdapterParam(pm.dataset.adapterParam, pm.type === "number" ? Number(pm.value) : pm.value); return true; }
    return false;
  }
  mapPick.addEventListener("click", (e) => {
    if (adapterClick(e)) return;
    const show = e.target.closest("[data-show]"); if (show) return showOnPage(show.dataset.show);
    if (e.target.closest("[data-close-ep]")) return pick(null);
    if (e.target.closest("[data-edit-ep]")) { const api = apis.find((a) => endpointKey(a) === selectedId?.slice(3)); if (api) startEdit(api); return; }
    if (e.target.closest("[data-cancel-edit]")) return cancelEdit();
    if (e.target.closest("[data-save-edit]")) return saveEdit();
    if (e.target.closest("[data-missing-row]")) { const api = apis.find((a) => endpointKey(a) === selectedId?.slice(3)); if (api) startEdit(api); return; }
    const bind = e.target.closest("[data-bind-expr]"); if (bind) { const api = apis.find((a) => endpointKey(a) === selectedId?.slice(3)); if (api) bindExpr(bind.dataset.bindExpr, endpointKey(api), bind.dataset.bindField); return; }
    const field = e.target.closest("[data-part]"); if (field) pick(field.dataset.part, { fromMap: false });
  });
  mapPick.addEventListener("change", adapterChange);
  mapPick.addEventListener("input", (e) => {
    if (adapterInput(e)) return;
    const ta = e.target.closest(".ep-edit[data-ep-field]");
    if (ta) editInput(ta.dataset.epField, ta.value);
  });
  epSlot.addEventListener("click", (e) => {
    if (adapterClick(e)) return;
    if (e.target.closest("[data-close-ep]")) return closePageEp();
    if (e.target.closest("[data-edit-ep]")) { const api = apis.find((a) => endpointKey(a) === pageEpKey); if (api) startEdit(api); return; }
    if (e.target.closest("[data-cancel-edit]")) return cancelEdit();
    if (e.target.closest("[data-save-edit]")) return saveEdit();
    if (e.target.closest("[data-missing-row]")) { const api = apis.find((a) => endpointKey(a) === pageEpKey); if (api) startEdit(api); return; }
    const bind = e.target.closest("[data-bind-expr]"); if (bind) { const api = apis.find((a) => endpointKey(a) === pageEpKey); if (api) bindExpr(bind.dataset.bindExpr, endpointKey(api), bind.dataset.bindField); return; }
    const show = e.target.closest("[data-show]"); if (show) return showOnPage(show.dataset.show);
    const partBtn = e.target.closest("[data-part]"); if (partBtn) return focusPart(partBtn.dataset.part); // LIN-117 §5: a fit-row link in the field list focuses that part in the same slot
  });
  epSlot.addEventListener("change", adapterChange);
  epSlot.addEventListener("input", (e) => {
    if (adapterInput(e)) return;
    const ta = e.target.closest(".ep-edit[data-ep-field]");
    if (ta) editInput(ta.dataset.epField, ta.value);
  });
  // LIN-117 §6: hover a field row in the open focus slot (fit, tie candidate or missing) -> the design part it
  // resolves to lights up, symmetric with hovering a part in "the trace, as a list" above.
  const focusRowSelector = "[data-part], [data-missing-row], .ep-field-target";
  epSlot.addEventListener("mouseover", (e) => { const row = e.target.closest(focusRowSelector); if (row) { const id = rowPartId(row); if (id) highlightPart(id); } });
  epSlot.addEventListener("mouseout", (e) => { const row = e.target.closest(focusRowSelector); if (row && !e.relatedTarget?.closest(focusRowSelector)) clearHighlight(); });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (view === "map" && selectedId?.startsWith("ep:")) return pick(null);
    if (pageEpKey || focusedPart || adapterView) closePageEp(); // LIN-117 §6/§7: Escape clears whichever the focus slot holds the same way
  });
  railEps.addEventListener("click", (e) => {
    const chip = e.target.closest("[data-adapter-chip]"); if (chip) return focusAdapter(chip.dataset.adapterChip); // LIN-117 §7: before the li's own open, since the chip is nested inside it
    const li = e.target.closest("li.ep[data-ep]"); if (li) openContract(li.dataset.ep);
  });
  railEps.addEventListener("keydown", (e) => {
    if (e.target.closest("[data-adapter-chip]")) return; // a real <button> handles its own Enter/Space natively
    const li = e.target.closest("li.ep[data-ep]");
    if (!li || (e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault(); openContract(li.dataset.ep);
  });
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
    get pageEpOpen() { return !!(pageEpKey || focusedPart || adapterView); }, // LIN-117 §2/§5/§7: the pinned Ask bar collapses whenever the focus slot holds anything
    metrics: () => ({ ...metrics, queue: { waiting: queue.waiting, travelling: queue.travelling, speed: queue.speed }, map: { ...map.stats }, entries: entries.size }),
    map, canvas, // for the stress test (the Map's own numbers) and screenshots
    debug: { entries: () => [...entries.values()].map((e) => ({ id: e.id, state: e.state, term: e.part.term, ep: e.part.src.endpoint })), parts: () => parts, queue, highlightId: () => highlightId },
  };
}
