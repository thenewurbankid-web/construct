// The Part inspector: spot an issue on any part, click it, fix it with clicks (and an AI-assisted Suggest), all
// deterministic and recorded. One shared click handler opens it for any element keyed by a part id (value.*, list.*,
// action.*, form.*). Everything shown comes from the server (src/inspector/*): the options in their fixed order, the
// proof on the design's own example values, the API source, the generated code, the preview and the history.
//   createInspector({ example, replay, toast, canOpen })
//     example()  the example (folder name) on screen        replay()  runs it again and resolves when it is done
//     canOpen()  false while a run is still waiting on an Ask
import { icon } from "/demo/icons.mjs";
import { ISSUES, badgeHtml } from "/inspector/issues.mjs";
import { createChat } from "/inspector/chat.mjs";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const PART_ID = /^(value|list|action|form|gap)\.[\w.-]+$/;
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const $$ = (s, r) => [...r.querySelectorAll(s)];
const TERM_WORD = { fit: "Fit", wait: "Waiting", gap: "Gap", tie: "Tie", stub: "Stub" };
const VERDICT = { reproduces: "Reproduces the design", differs: "Does not match the design", nothing: "Shows nothing", fixed: "Fixed text", unproven: "Cannot be checked yet", behaviour: "" };
const FOCUSABLE = 'button:not(:disabled), [href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary, [tabindex]:not([tabindex="-1"])';

export function createInspector({ example, replay = async () => {}, toast = () => {}, canOpen = () => true }) {
  const S = { open: false, id: null, data: null, sel: null, stub: { inputs: [], fn: "", expr: "", keep: false }, preview: null, previewErr: null, previewing: false, similar: [], simSel: new Set(), suggest: null, suggested: null, applied: null, busy: false, opener: null, seq: 0, edited: new Set() };
  let root = null, chat = null, timer = null;

  // ---------- server ----------
  const call = async (url, body) => {
    try {
      const r = await fetch(url, body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ example: example(), ...body }) });
      return { ok: r.ok, status: r.status, j: await r.json().catch(() => ({})) };
    } catch { return { ok: false, status: 0, j: { error: "The server is not reachable. Start it with npm run demo, then try again." } }; }
  };
  const getPart = (id) => call(`/api/part?example=${encodeURIComponent(example())}&id=${encodeURIComponent(id)}`);

  async function refreshEdited() {
    const r = await call(`/api/parts?example=${encodeURIComponent(example())}`);
    if (r.ok) S.edited = new Set(r.j.parts.filter((p) => p.edited).map((p) => p.id));
    return r.ok ? r.j : null;
  }

  // ---------- badges on the designed page ----------
  // An overlay of small buttons over the page, so nothing on the page reflows. One per part: the first place it appears.
  function paintBadges({ box, kinds = {}, unders = {} }) {
    const body = box.closest(".stage-body") ?? box.parentElement;
    let layer = body.querySelector(":scope > .pv-badges");
    if (!layer) { layer = document.createElement("div"); layer.className = "pv-badges"; layer.setAttribute("role", "group"); layer.setAttribute("aria-label", "Problems on the page. Each opens the part."); body.append(layer); }
    if (getComputedStyle(body).position === "static") body.style.position = "relative";
    const b = body.getBoundingClientRect();
    const seen = new Set(), out = [];
    for (const el of box.querySelectorAll("[data-id]")) {
      const id = el.dataset.id;
      if (seen.has(id) || !PART_ID.test(id)) continue;
      const kind = kinds[id], edited = S.edited.has(id);
      if (!kind && !edited) continue;
      seen.add(id);
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      const x = r.right - b.left + body.scrollLeft, y = r.top - b.top + body.scrollTop;
      out.push(`<button type="button" class="pvb" data-open-part="${esc(id)}" style="left:${Math.round(x)}px;top:${Math.round(y)}px" aria-label="${esc(`${kind ? ISSUES[kind].label + ": " + ISSUES[kind].words + ". " : ""}${edited ? "Edited by you. " : ""}Open the part`)}">${kind ? badgeHtml(kind, { size: "s", under: unders[id] }) : ""}${edited ? `<span class="ibg ibg-edited ibg-s" title="Edited by you">${icon("pencil", 11)}<b>Edited</b></span>` : ""}</button>`);
    }
    const had = layer.contains(document.activeElement) ? document.activeElement.dataset.openPart : null; // a repaint must not drop the keyboard's place
    layer.innerHTML = out.join("");
    if (had) layer.querySelector(`[data-open-part="${CSS.escape(had)}"]`)?.focus({ preventScroll: true });
    // a dense page puts many badges close together: nudge each down until it no longer covers an earlier one
    const placed = [];
    for (const el of layer.children) {
      const w = el.offsetWidth, h = el.offsetHeight;
      let x = Math.max(parseFloat(el.style.left), w + 2), y = parseFloat(el.style.top), n = 0; // never left of the page's edge
      el.style.left = `${Math.round(x)}px`;
      const hit = () => placed.some((r) => x - w < r.x && x > r.x - r.w && y - h * 0.55 < r.y - r.h * 0.55 + r.h && y - h * 0.55 + h > r.y - r.h * 0.55);
      while (n++ < 12 && hit()) y += h + 2;
      el.style.top = `${Math.round(y)}px`;
      placed.push({ x, y, w, h });
    }
    if (!box.__pvObs) { box.__pvObs = new ResizeObserver(() => { clearTimeout(box.__pvT); box.__pvT = setTimeout(() => box.__pvRepaint?.(), 80); }); box.__pvObs.observe(box); }
    box.__pvRepaint = () => paintBadges({ box, kinds, unders });
  }
  const clearBadges = (box) => { box.closest(".stage-body")?.querySelector(":scope > .pv-badges")?.replaceChildren(); box.__pvRepaint = null; };

  // ---------- opening and closing ----------
  async function open(id, opener = document.activeElement) {
    if (!PART_ID.test(id ?? "") || !canOpen()) return;
    build();
    Object.assign(S, { open: true, id, opener, data: null, sel: null, stub: { inputs: [], fn: "", expr: "", keep: false }, preview: null, previewErr: null, similar: [], simSel: new Set(), suggest: null, suggested: null, applied: null });
    root.hidden = false;
    document.documentElement.classList.add("pi-lock");
    paint();
    root.querySelector(".pi-x").focus();
    chat.reset();
    const r = await getPart(id);
    if (!S.open || S.id !== id) return;
    if (!r.ok) { S.data = { error: r.j.error ?? "Could not read this part." }; return paint(); }
    S.data = r.j;
    S.edited = new Set([...S.edited].filter((x) => x !== id).concat(r.j.history?.edited ? [id] : []));
    paint();
    root.querySelector(".pi-x").focus();
  }
  function close() {
    if (!S.open) return;
    S.open = false; S.seq++;
    chat?.stop();
    root.hidden = true;
    document.documentElement.classList.remove("pi-lock");
    // the opener may have been redrawn by a Replay: find the same part's badge (or the part itself) again
    const back = S.opener && document.contains(S.opener) ? S.opener : document.querySelector(`.pvb[data-open-part="${CSS.escape(S.id)}"]`) ?? document.querySelector(`[data-open-part="${CSS.escape(S.id)}"]`) ?? document.querySelector("main");
    back?.focus({ preventScroll: true });
    document.dispatchEvent(new CustomEvent("inspector-closed"));
  }

  // ---------- the dialog ----------
  function build() {
    if (root) return;
    root = document.createElement("div");
    root.className = "pi-back"; root.hidden = true;
    root.innerHTML = `<div class="pi" role="dialog" aria-modal="true" aria-labelledby="piTitle" tabindex="-1">
      <header class="pi-head" id="piHead"></header>
      <div class="pi-body"><section class="pi-left" id="piLeft" aria-label="Blocks"></section><aside class="pi-right" id="piRight" aria-label="Chat about this part"></aside></div>
    </div>`;
    document.body.append(root);
    chat = createChat({ root: root.querySelector("#piRight"), context: () => ({ id: S.id, example: example() }), options: () => S.data?.options ?? [], onPropose: (n) => { const o = S.data?.options?.[n - 1]; if (o) select(o.id); } });
    document.addEventListener("keydown", (e) => { if (S.open && e.key === "Escape" && !root.contains(e.target)) { e.preventDefault(); close(); } });
    root.addEventListener("mousedown", (e) => { if (e.target === root) close(); });
    root.addEventListener("click", onClick);
    root.addEventListener("input", onInput);
    root.addEventListener("keydown", onKey);
    root.addEventListener("keydown", (e) => e.stopPropagation()); // the page underneath (the studio has its own shortcuts) must not see these keys
  }

  const optOf = (id) => S.data?.options?.find((o) => o.id === id) ?? null;
  const cur = () => optOf(S.sel);

  function paint() { paintHead(); paintLeft(); }
  function paintHead() {
    const d = S.data, el = root.querySelector("#piHead");
    if (!d || d.error) { el.innerHTML = `<div class="pi-titles"><h2 id="piTitle">${esc(S.id)}</h2></div><button type="button" class="btn ghost icon-only pi-x" aria-label="Close the inspector">${icon("x", 18)}</button>`; return; }
    el.innerHTML = `<div class="pi-titles"><h2 id="piTitle">${esc(d.title)}</h2><code>${esc(d.id)}</code></div>
      <div class="pi-tags">${d.term === "wait" && d.badge ? "" : `<span class="pi-chip ${d.term}">${icon(d.term, 15)}${TERM_WORD[d.term]}</span>`}${d.badge ? badgeHtml(d.badge, { size: "m", under: d.kind }) : ""}${S.edited.has(d.id) ? `<span class="ibg ibg-edited ibg-m" title="This answer was set in the inspector">${icon("pencil", 12)}<b>Edited by you</b></span>` : ""}</div>
      <button type="button" class="btn ghost icon-only pi-x" aria-label="Close the inspector" title="Close (Esc)">${icon("x", 18)}</button>`;
  }

  const proofHtml = (pr) => {
    if (!pr) return "";
    const rows = pr.rows.slice(0, 4);
    const mark = (r) => (r.match === true ? `<span class="pf-ok">${icon("check", 14)}Same</span>` : r.match === false ? `<span class="pf-no">${icon("x", 14)}Differs</span>` : `<span class="pf-na">Unknown</span>`);
    return `<div class="pi-proof">${rows.length ? `<table><thead><tr><th scope="col">The design shows</th><th scope="col">This gives</th><th scope="col"><span class="sr-only">Result</span></th></tr></thead><tbody>${rows.map((r) => `<tr><td><span class="val">${esc(r.design)}</span></td><td>${r.produced == null || r.produced === "" ? `<span class="none">nothing</span>` : `<span class="val">${esc(r.produced)}</span>`}</td><td>${mark(r)}</td></tr>`).join("")}${pr.rows.length > 4 ? `<tr><td colspan="3" class="more">and ${pr.rows.length - 4} more example${pr.rows.length - 4 === 1 ? "" : "s"}</td></tr>` : ""}</tbody></table>` : ""}${pr.note ? `<p class="pf-note ${pr.verdict}">${esc(pr.note)}</p>` : ""}</div>`;
  };
  const apiHtml = (a, open = false) => (a ? `<div class="pi-api"><span class="k">From the API</span><code>${esc(a.endpoint ?? "")}</code><span class="pth">${esc(a.path)}</span>${a.sample ? `<details${open ? " open" : ""}><summary>Sample response</summary><pre>${esc(a.sample)}</pre></details>` : ""}</div>` : `<div class="pi-api none"><span class="k">From the API</span><span>Nothing. This option does not read the API.</span></div>`);

  function stubEditor(o) {
    const st = o.stub, s = S.stub;
    const chk = S.preview?.checks && Object.values(S.preview.checks)[0];
    const errRows = S.previewErr?.rows;
    const rows = errRows ?? chk?.rows;
    return `<div class="pi-stub">
      ${st.from === "fields" ? `<fieldset><legend>Which API fields feed it?</legend><div class="pi-fields">${st.fields.slice(0, 14).map((f) => `<label class="pi-field"><input type="checkbox" data-stub-field="${esc(f)}" ${s.inputs.includes(f) ? "checked" : ""}><span>${esc(f)}</span></label>`).join("")}</div></fieldset>` : ""}
      <label class="pi-lab">Function name<input class="txt" data-stub-fn value="${esc(s.fn || st.fn)}" autocomplete="off" spellcheck="false"></label>
      ${st.expression ? `<label class="pi-lab">Expression <small>optional. It is run on the design's own examples.</small><textarea class="txt" rows="2" data-stub-expr placeholder="${esc('item.first + " " + item.last')}" spellcheck="false">${esc(s.expr)}</textarea></label>` : ""}
      ${rows ? `<div class="pi-chk">${rows.map((r) => `<div><span class="val">${esc(r.design)}</span> ${r.error ? `<span class="pf-no">${esc(r.error)}</span>` : `gives <span class="val">${esc(r.produced)}</span> ${r.match ? `<span class="pf-ok">${icon("check", 14)}Same</span>` : `<span class="pf-no">${icon("x", 14)}Differs</span>`}`}</div>`).join("")}</div>` : ""}
      ${S.previewErr?.unverified ? `<label class="pi-keep"><input type="checkbox" data-stub-keep ${s.keep ? "checked" : ""}> Keep it anyway, marked unverified. The generated code says so and its test stays a to-do.</label>` : ""}
    </div>`;
  }

  function optionsHtml() {
    const d = S.data;
    return `<div class="pi-opts" role="radiogroup" aria-label="${esc(d.form.title)}">${d.options.map((o, i) => {
      const on = S.sel === o.id;
      const sug = S.suggested?.option === o.id;
      return `<div class="pi-opt${on ? " on" : ""}${o.current ? " now" : ""}" role="radio" aria-checked="${on}" tabindex="${on || (!S.sel && i === 0) ? 0 : -1}" data-opt="${esc(o.id)}">
        <div class="pi-opt-top"><kbd>${i + 1}</kbd><b>${esc(o.label)}</b><span class="pi-tags">${o.ruleDefault ? `<span class="pi-tag rec" title="The rules' first pick: cheapest first, then alphabetical. It is a default, not a judgement.">Rule default</span>` : ""}${o.current ? `<span class="pi-tag now">In use now</span>` : ""}${sug ? `<span class="pi-tag sug">${icon("suggest", 12)}Suggest's pick</span>` : ""}</span></div>
        ${proofHtml(o.proof)}${apiHtml(o.api)}${on && o.stub ? stubEditor(o) : ""}${on ? `<div class="pi-under">${previewHtml()}${similarHtml()}</div>` : ""}
      </div>`;
    }).join("")}</div>`;
  }

  function diffHtml(files) {
    return files.map((f) => `<details class="pi-file"><summary><code>${esc(f.path)}</code><span class="add">+${f.added}</span><span class="del">−${f.removed}</span></summary>${f.hunks.map((h) => `<div class="pi-hunk"><div class="hh">${esc(h.header)}</div>${h.lines.map((l) => `<div class="dl ${l.t === "+" ? "add" : l.t === "-" ? "del" : ""}"><span aria-hidden="true">${l.t === " " ? "" : l.t}</span><span>${esc(l.text) || " "}</span></div>`).join("")}</div>`).join("")}</details>`).join("");
  }
  function previewHtml() {
    const d = S.data;
    if (!S.sel) return "";
    if (S.previewing && !S.preview) return `<div class="pi-pv"><p class="busy"><span class="spin"></span>Working out what this changes…</p></div>`;
    if (S.previewErr) return `<div class="pi-pv err"><p>${esc(S.previewErr.error)}</p></div>`;
    const p = S.preview;
    if (!p) return "";
    const me = p.parts.find((x) => x.id === d.id), rest = p.parts.filter((x) => x.id !== d.id), others = rest.filter((x) => x.before !== x.after), quiet = rest.length - others.length;
    const same = p.before.fit === p.after.fit && p.before.needHuman === p.after.needHuman;
    return `<div class="pi-pv${S.previewing ? " stale" : ""}" aria-live="polite">
      <h4>What this would do</h4>
      <div class="pi-pvrow"><div><small>This part</small><span class="pi-chip ${me?.before ?? d.term}">${TERM_WORD[me?.before ?? d.term]}</span><span class="arrow" aria-hidden="true">→</span><span class="pi-chip ${me?.after ?? d.term}">${TERM_WORD[me?.after ?? d.term]}</span></div>
        <div><small>Fit report</small><b class="score">${p.before.fit} of ${p.before.total}</b><span class="arrow" aria-hidden="true">→</span><b class="score ${p.after.fit > p.before.fit ? "up" : p.after.fit < p.before.fit ? "down" : ""}">${p.after.fit} of ${p.after.total}</b><span class="pi-sub">${same ? "no change" : "parts fit"}</span></div></div>
      ${others.length ? `<p class="pi-others"><b>Also changes:</b> ${others.map((o) => `${esc(o.id.replace(/^(value|list|action)\./, ""))} (${TERM_WORD[o.before] ?? "?"} → ${TERM_WORD[o.after] ?? "?"})`).join(", ")}</p>` : ""}${quiet ? `<p class="pi-sub">${quiet} other part${quiet === 1 ? " is" : "s are"} answered the same way and keep${quiet === 1 ? "s" : ""} their state.</p>` : ""}
      ${p.files.length ? `<div class="pi-diff"><small>${p.files.length} generated file${p.files.length === 1 ? "" : "s"} would change. Nothing is written until you Apply.</small>${diffHtml(p.files)}</div>` : `<p class="pi-sub">The generated code does not change.</p>`}
    </div>`;
  }

  function similarHtml() {
    if (!S.similar.length || S.applied) return "";
    return `<div class="pi-sim"><h4>Fix all similar</h4><p>${S.similar.length} other part${S.similar.length === 1 ? " has" : "s have"} the same kind of problem and the same choices. Tick the ones that should get the same answer. Nothing changes until you press Apply.</p>
      <div class="pi-simrow"><button type="button" class="btn sm ghost" data-sim-all>${S.simSel.size === S.similar.length ? "Untick all" : "Tick all"}</button></div>
      <ul>${S.similar.map((x) => `<li><label><input type="checkbox" data-sim="${esc(x.id)}" ${S.simSel.has(x.id) ? "checked" : ""}><span><b>${esc(x.title)}</b> <code>${esc(x.id)}</code></span></label></li>`).join("")}</ul></div>`;
  }

  function suggestHtml() {
    const g = S.suggest;
    if (!g) return "";
    if (g.running) return `<div class="pi-sg"><p class="busy"><span class="spin"></span>Suggest is looking at the facts for this part…</p></div>`;
    if (g.unreachable) return `<div class="pi-sg warn"><p>${esc(g.reason)}</p></div>`;
    if (g.abstain) return `<div class="pi-sg"><p><b>Suggest has no answer.</b> ${esc(g.reason)}</p></div>`;
    return `<div class="pi-sg ok"><p><b>Suggest picked</b> ${esc(g.label)}${g.expression ? `, with the expression <code>${esc(g.expression.code)}</code>` : ""}.</p>${g.fact ? `<p class="fact">It pointed to this fact: <q>${esc(g.fact)}</q></p>` : ""}<p class="verdict">${icon("check", 14)}The rules checked it: it is one of this part's options${g.expression ? (g.expression.verified ? " and the expression reproduces the design's examples" : " but the expression does not reproduce the examples") : ""}. Applying is still your click.</p></div>`;
  }

  function codeHtml() {
    const c = S.data.code;
    if (!c.generated) return `<div class="pi-code"><h4>Generated code</h4><p class="pi-sub">Not generated yet. Press Wire it or Replay and the code for this part appears here.</p></div>`;
    if (!c.slices.length) return `<div class="pi-code"><h4>Generated code</h4><p class="pi-sub">Nothing is generated for this part yet. It becomes code once it has an answer.</p></div>`;
    return `<div class="pi-code"><h4>Generated code <small>Read-only. It is rewritten on every Replay, so change the answer, not the file.</small></h4>${c.slices.map((s) => {
      const lines = s.code.split("\n");
      return `<figure class="pi-slice"><figcaption><code>${esc(s.file)}</code><span>lines ${s.start}–${s.end}</span></figcaption><pre tabindex="0" aria-label="${esc(s.name)}">${lines.map((l, i) => `<span class="ln${s.focus?.includes(s.start + i) ? " hi" : ""}"><i aria-hidden="true">${s.start + i}</i>${esc(l) || " "}</span>`).join("")}</pre>${s.truncated ? `<small class="pi-sub">Only the first 60 lines are shown.</small>` : ""}</figure>`;
    }).join("")}</div>`;
  }

  function barHtml() {
    const d = S.data, h = d.history ?? {}, applicable = d.form.applicable;
    const many = 1 + S.simSel.size;
    const o = cur(), canApply = !!o && !(o.current && !o.stub) && !S.busy && !S.previewErr && !S.previewing && !S.applied?.running;
    return `<div class="pi-bar">
      ${S.applied ? `<div class="pi-done" role="status">${S.applied.running ? `<span class="spin"></span>` : icon("check", 16)}${esc(S.applied.text)}</div>` : ""}
      <div class="pi-bar-l">${applicable ? `<button type="button" class="btn" data-suggest ${S.suggest?.running ? "disabled" : ""}>${icon("suggest", 16)}Suggest</button>` : ""}
        <button type="button" class="btn ghost" data-undo ${h.canUndo ? "" : "disabled"} title="Put back the answer this part had before">${icon("replay", 16)}Undo</button>
        <button type="button" class="btn ghost" data-redo ${h.canRedo ? "" : "disabled"}>Redo</button>
        ${d.undo && d.undo.id !== d.id ? `<button type="button" class="btn ghost sm" data-undo-any title="Undo the newest change made in the inspector, on any part">Undo last change (${esc(d.undo.id.replace(/^(value|list|action|form)\./, ""))})</button>` : ""}
        ${d.redo && d.redo.id !== d.id ? `<button type="button" class="btn ghost sm" data-redo-any title="Redo the change undone last, on any part">Redo last change</button>` : ""}</div>
      <div class="pi-bar-r">
        ${applicable ? `<button type="button" class="btn primary" data-apply ${canApply ? "" : "disabled"}>Apply${many > 1 ? ` to ${many} parts` : ""}<kbd>Enter</kbd></button>` : ""}</div>
    </div>`;
  }

  // Which control has focus, as a selector, so a repaint (a preview arriving) does not take the keyboard away from it.
  const focusKey = (el) => { if (!el || !root.contains(el)) return null; for (const [k, v] of Object.entries(el.dataset ?? {})) return `[data-${k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())}="${CSS.escape(v)}"]`; return el.matches(".pi-x") ? ".pi-x" : null; };
  function paintLeft() {
    const el = root.querySelector("#piLeft"), d = S.data;
    const keepScroll = el.querySelector("#piScroll")?.scrollTop ?? 0, key = focusKey(document.activeElement);
    if (!d) { el.innerHTML = `<div class="pi-load"><span class="spin"></span>Reading this part…</div>`; return; }
    if (d.error) { el.innerHTML = `<div class="pi-load err"><p>${esc(d.error)}</p><button type="button" class="btn" data-close>Close</button></div>`; return; }
    const k = d.kind ? ISSUES[d.kind] : null; // a skipped part is explained as the Gap or Tie it is underneath
    el.innerHTML = `<div class="pi-scroll" id="piScroll">
      <div class="pi-sech"><h3>Blocks</h3><small>The ways this part can be built, each shown on the design's own examples</small></div>
      ${k ? `<div class="pi-explain" style="--ib:${k.color}"><p>${esc(k.explain)}${d.badge === "ask" ? " Nobody has decided it yet, so it is still an Ask." : ""}</p>${d.why ? `<p class="why">${esc(d.why.text)}</p>` : ""}</div>` : `<div class="pi-explain fit"><p>This part fits. It reproduces the design exactly. You can still choose another way to build it.</p></div>`}
      ${d.design?.length ? `<div class="pi-design"><span>The design shows</span>${d.design.map((x) => `<span class="val">${esc(x)}</span>`).join("")}</div>` : ""}
      ${suggestHtml()}
      ${d.form.applicable ? `<h4 class="pi-q" id="piQ">${esc(d.form.title)}</h4>${optionsHtml()}` : `<div class="pi-info"><h4>${esc(d.form.title)}</h4><p>${k ? esc(k.explain) : ""}</p>${d.why ? `<p><b>What would close it:</b> ${esc(d.why.hint)}</p><p class="pi-sub">It is on ${esc(d.why.team ? d.why.team[0].toUpperCase() + d.why.team.slice(1) : "a team")}'s Handoff.</p>` : ""}</div>`}
      ${codeHtml()}
    </div>${barHtml()}`;
    const sc = el.querySelector("#piScroll"); if (sc) sc.scrollTop = keepScroll;
    if (key && !root.contains(document.activeElement)) el.querySelector(key)?.focus({ preventScroll: true });
    if (S.open && !root.contains(document.activeElement)) root.querySelector(".pi").focus({ preventScroll: true }); // never leave focus behind the dialog
  }

  // ---------- choosing, previewing, suggesting ----------
  function choiceOf(o = cur()) {
    if (!o) return null;
    return o.stub ? { option: o.id, inputs: S.stub.inputs, fn: S.stub.fn || o.stub.fn, expression: S.stub.expr, keepUnverified: S.stub.keep } : { option: o.id };
  }
  function select(id, { keepStub = false } = {}) {
    const o = optOf(id);
    if (!o || S.applied?.running) return;
    S.sel = id; S.applied = null; S.previewErr = null;
    if (!keepStub) S.stub = { inputs: o.current && o.stub ? (o.value?.inputs ?? []) : [], fn: o.current && o.stub ? o.value?.fn ?? "" : "", expr: o.current && o.stub ? o.value?.body ?? "" : "", keep: false };
    S.similar = []; S.simSel = new Set();
    paintLeft();
    queuePreview(0);
    if (!o.stub) call("/api/part-similar", { id: S.data.id, choice: choiceOf(o) }).then((r) => { if (S.sel === id && r.ok) { S.similar = r.j.similar; paintLeft(); } });
    const card = root.querySelector(`[data-opt="${CSS.escape(id)}"]`);
    card?.focus({ preventScroll: true });
    card?.scrollIntoView({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
  }
  const changes = () => {
    const o = cur();
    return [{ id: S.data.id, choice: choiceOf(o) }, ...S.similar.filter((x) => S.simSel.has(x.id)).map((x) => ({ id: x.id, choice: { option: x.option } }))];
  };
  function queuePreview(ms = 350) {
    clearTimeout(timer);
    const o = cur();
    if (!o) return;
    if (o.stub?.from === "fields" && !S.stub.inputs.length) { S.preview = null; S.previewErr = null; S.previewing = false; return paintLeft(); }
    timer = setTimeout(runPreview, ms);
  }
  async function runPreview() {
    const my = ++S.seq;
    S.previewing = true; S.previewErr = null;
    paintLeftKeepFocus();
    const r = await call("/api/part-preview", { changes: changes() });
    if (my !== S.seq || !S.open) return;
    S.previewing = false;
    if (r.ok) { S.preview = r.j; S.previewErr = null; } else { S.preview = null; S.previewErr = { error: r.j.error ?? "Could not work out the preview.", unverified: !!r.j.unverified, rows: r.j.rows ?? null }; }
    paintLeftKeepFocus();
  }
  // repaint without losing what is being typed in the Stub editor
  function paintLeftKeepFocus() {
    const a = document.activeElement, keep = a && root.contains(a) && a.matches("input, textarea") ? { sel: a.matches("[data-stub-expr]") ? "[data-stub-expr]" : a.matches("[data-stub-fn]") ? "[data-stub-fn]" : null, s: a.selectionStart, e: a.selectionEnd } : null;
    paintLeft();
    if (keep?.sel) { const n = root.querySelector(keep.sel); if (n) { n.focus({ preventScroll: true }); try { n.setSelectionRange(keep.s, keep.e); } catch {} } }
  }

  async function suggest() {
    if (S.suggest?.running) return;
    S.suggest = { running: true }; paintLeft();
    const my = S.id;
    const r = await call("/api/suggest", { id: S.data.id });
    if (!S.open || S.id !== my) return;
    if (!r.ok) { S.suggest = { unreachable: true, reason: r.j.error ?? "Suggest is not available right now. Everything else works the same." }; return paintLeft(); }
    S.suggest = r.j;
    if (r.j.ok) {
      S.suggested = { option: r.j.option, fact: r.j.fact, model: r.j.model };
      S.stub = { inputs: r.j.choice?.inputs ?? [], fn: r.j.choice?.fn ?? "", expr: r.j.choice?.expression ?? "", keep: false };
      select(r.j.option, { keepStub: true });
    } else paintLeft();
  }

  async function apply() {
    if (!S.sel || S.busy) return;
    S.busy = true; S.applied = { running: true, text: "Applying…" }; paintLeft();
    const useSuggest = S.suggested && S.suggested.option === S.sel && S.suggested.fact;
    const body = { changes: changes(), ...(useSuggest ? { suggest: { model: S.suggested.model, fact: S.suggested.fact } } : {}) };
    const line = S.preview ? S.preview.line : "";
    const r = await call("/api/part-apply", body);
    if (!r.ok) { S.busy = false; S.applied = null; S.previewErr = { error: r.j.error ?? "Could not apply it.", unverified: !!r.j.unverified, rows: r.j.rows ?? null }; return paintLeft(); }
    S.applied = { running: true, text: `Applied. ${line}. Replaying…` };
    paintLeft();
    await afterChange(`Applied. ${line}.`);
    S.busy = false;
  }
  async function afterChange(text) {
    await replay();
    if (!S.open) return;
    const r = await getPart(S.id);
    await refreshEdited();
    if (r.ok) { S.data = r.j; }
    Object.assign(S, { sel: null, preview: null, previewErr: null, similar: [], simSel: new Set(), suggest: null, suggested: null, applied: { text: `${text} The page and the Handoffs are updated.` } });
    paint();
    document.dispatchEvent(new CustomEvent("inspector-changed"));
  }
  async function undoRedo(kind, id) {
    if (S.busy) return;
    S.busy = true;
    const r = await call(`/api/part-${kind}`, id ? { id } : {});
    if (!r.ok) { S.busy = false; toast(r.j.error ?? "That did not work."); return; }
    S.applied = { running: true, text: `${kind === "undo" ? "Undone" : "Redone"}. Replaying…` }; paintLeft();
    await afterChange(kind === "undo" ? "Undone." : "Redone.");
    S.busy = false;
  }

  // ---------- events ----------
  function onClick(e) {
    const t = e.target.closest("button, [data-opt], input, summary");
    if (!t) return;
    if (t.matches(".pi-x, [data-close]")) return close();
    if (t.matches("[data-suggest]")) return suggest();
    if (t.matches("[data-apply]")) return apply();
    if (t.matches("[data-undo]")) return undoRedo("undo", S.data.id);
    if (t.matches("[data-redo]")) return undoRedo("redo", S.data.id);
    if (t.matches("[data-undo-any]")) return undoRedo("undo", null);
    if (t.matches("[data-redo-any]")) return undoRedo("redo", null);
    if (t.matches("[data-sim-all]")) { S.simSel = S.simSel.size === S.similar.length ? new Set() : new Set(S.similar.map((x) => x.id)); paintLeft(); return queuePreview(0); }
    if (t.matches("[data-sim]")) { t.checked ? S.simSel.add(t.dataset.sim) : S.simSel.delete(t.dataset.sim); paintLeftKeepFocus(); return queuePreview(0); }
    if (t.matches("[data-stub-keep]")) { S.stub.keep = t.checked; return queuePreview(0); }
    if (t.matches("[data-stub-field]")) { const f = t.dataset.stubField; S.stub.inputs = t.checked ? [...S.stub.inputs, f] : S.stub.inputs.filter((x) => x !== f); return queuePreview(200); }
    const o = t.closest("[data-opt]");
    if (o && !e.target.closest("details, textarea, input, label, fieldset, .pi-stub, .pi-under")) return select(o.dataset.opt);
    if (o && !S.sel) select(o.dataset.opt, { keepStub: true });
  }
  function onInput(e) {
    const t = e.target;
    if (t.matches("[data-stub-fn]")) { S.stub.fn = t.value; return queuePreview(500); }
    if (t.matches("[data-stub-expr]")) { S.stub.expr = t.value; S.stub.keep = false; return queuePreview(600); }
  }
  function onKey(e) {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); return close(); }
    if (e.key === "Tab") {
      const f = $$(FOCUSABLE, root.querySelector(".pi")).filter((x) => x.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === root.querySelector(".pi"))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      return;
    }
    const typing = e.target.matches("input[type=text], input:not([type]), textarea, select");
    if (typing || e.metaKey || e.ctrlKey || e.altKey || !S.data?.options) return;
    const opts = S.data.options;
    if (/^[1-9]$/.test(e.key) && opts[Number(e.key) - 1] && e.target.closest("#piLeft, .pi")) { if (!e.target.closest("#piRight")) { e.preventDefault(); return select(opts[Number(e.key) - 1].id); } }
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && e.target.closest("[data-opt]")) {
      e.preventDefault();
      const i = Math.max(0, opts.findIndex((o) => o.id === (S.sel ?? e.target.closest("[data-opt]").dataset.opt)));
      return select(opts[(i + (e.key === "ArrowDown" ? 1 : -1) + opts.length) % opts.length].id);
    }
    if (e.key === "Enter" && !e.target.closest("button, summary, a, #piRight")) {
      const b = root.querySelector("[data-apply]");
      if (b && !b.disabled) { e.preventDefault(); return apply(); }
    }
  }

  // ---------- the shared click handler ----------
  // Any element keyed by a part id opens the inspector: a badge (data-open-part), a part of the designed page inside
  // #pv (data-id), or anything that carries data-leaf. The page's own parts only count once a run is finished.
  function install() {
    document.addEventListener("click", (e) => {
      if (root && !root.hidden) return;
      const t = e.target.closest?.("[data-open-part], #pv [data-id], [data-leaf]");
      if (!t) return;
      const id = t.dataset.openPart ?? t.dataset.id ?? t.dataset.leaf;
      if (!PART_ID.test(id ?? "")) return;
      e.preventDefault();
      open(id, t.closest("button") ?? t);
    });
    document.addEventListener("keydown", (e) => {
      if ((e.key === "Enter" || e.key === " ") && e.target.matches?.("#pv [data-id][tabindex='0']")) { e.preventDefault(); e.target.click(); }
    });
  }

  const isOpen = () => !!(root && !root.hidden);
  return { open, close, isOpen, install, paintBadges, clearBadges, refreshEdited, edited: () => S.edited };
}

// A compact list of the parts that need a human, for the fit screen and anywhere else a list is wanted.
export function partListHtml(items, { kinds = {}, unders = {}, title = (x) => x.part } = {}) {
  if (!items?.length) return "";
  return `<ul class="pl">${items.map((it) => `<li><button type="button" class="pl-btn" data-open-part="${esc(it.id)}"><span class="pl-t">${esc(title(it))}</span>${kinds[it.id] ? badgeHtml(kinds[it.id], { size: "s", under: unders[it.id] }) : ""}</button></li>`).join("")}</ul>`;
}
