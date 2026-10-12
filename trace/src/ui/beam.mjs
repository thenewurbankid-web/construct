// The planner eval page (/beam, #896): the Opus-Grader's scores and the owner's own, side by side, per item and per
// setup. Rendering is pure (data in, HTML string out) and unit-tested in Node; mountBeam() is the only DOM part.
// Same convention as src/ui/drift.mjs and src/ui/quality.mjs.
import { esc } from "./about.mjs";

const DECISION = { stub: ["Stub: complete it", "d-stub"], fn: ["Existing fn: reuse", "d-fn"], create: ["Create", "d-create"], computed: ["Computed", "d-src"], api: ["API", "d-src"], dynamic: ["Dynamic", "d-dyn"], static: ["Static", "d-dyn"] };
const fmt = (v, d = "–") => (v === null || v === undefined ? d : String(v));
const pct = (r) => (r === null || r === undefined ? "–" : `${Math.round(r * 100)}%`);
const total = (scores, lines) => (scores && lines.every((l) => Number.isInteger(scores[l.id])) ? lines.reduce((a, l) => a + scores[l.id], 0) : null);
const signed = (d) => (d > 0 ? `+${d}` : String(d));

/** The summary bar of one setup. */
export function renderSummary(view) {
  const s = view.summary;
  return `<div class="summary" data-testid="beam-summary">
    <div class="stat"><span class="k">Opus-Grader mean</span><b data-testid="mean-grader">${fmt(s.mean.grader)}</b><span class="sub">/ ${s.maxTotal} · ${s.graded.grader} item(s)</span></div>
    <div class="stat"><span class="k">Owner mean</span><b data-testid="mean-owner">${fmt(s.mean.owner)}</b><span class="sub">/ ${s.maxTotal} · ${s.graded.owner} item(s)</span></div>
    <div class="stat"><span class="k">Agreement</span><b data-testid="agreement-rate">${pct(s.agreementRate)}</b><span class="sub">of rubric lines, ${s.graded.both} item(s) both graded</span></div>
    <div class="stat ${s.disagree2 ? "warn" : ""}"><span class="k">Disagree ≥2</span><b data-testid="disagree-count">${s.disagree2}</b><span class="sub">review these first</span></div>
  </div>`;
}

/** Two setups side by side: totals and per-line means. */
export function renderCompare(a, b) {
  const lines = a.rubric.lines;
  const cell = (v, l) => `${fmt(v.summary.perLine[l.id]?.grader)} / ${fmt(v.summary.perLine[l.id]?.owner)}`;
  const row = (label, f) => `<tr><th scope="row">${label}</th><td>${f(a)}</td><td>${f(b)}</td></tr>`;
  return `<table class="compare" data-testid="beam-compare"><caption>Setups side by side (grader / owner)</caption>
    <thead><tr><th></th><th>${esc(a.setup)}</th><th>${esc(b.setup)}</th></tr></thead><tbody>
    ${row("Total mean", (v) => `${fmt(v.summary.mean.grader)} / ${fmt(v.summary.mean.owner)}`)}
    ${row("Agreement", (v) => pct(v.summary.agreementRate))}
    ${row("Disagree ≥2", (v) => String(v.summary.disagree2))}
    ${lines.map((l) => row(`${esc(l.id)} (0–${l.max})`, (v) => cell(v, l))).join("")}
  </tbody></table>`;
}

/** The item list in review order. */
export function renderList(view, selectedId) {
  const lines = view.rubric.lines;
  return `<ol class="items" data-testid="beam-items">${view.items.map((i) => {
    const g = total(i.grader?.scores, lines), o = total(i.owner?.scores, lines);
    const a = i.agreement;
    const badge = a.disagree2 ? `<span class="chip warn" data-testid="disagree-badge">Δ ${signed(a.overall.diff)} review</span>` : a.compared ? `<span class="chip ok">${a.overall.diff === 0 ? "agree" : `Δ ${signed(a.overall.diff)}`}</span>` : `<span class="chip mut">not graded</span>`;
    return `<li><button type="button" class="item ${i.id === selectedId ? "sel" : ""}" data-item="${esc(i.id)}" aria-current="${i.id === selectedId}">
      <span class="row1"><code>${esc(i.id)}</code>${badge}</span>
      <span class="req">${esc(i.requirement)}</span>
      <span class="sub">grader ${fmt(g)} · owner ${fmt(o)} / ${view.summary.maxTotal}${i.planner?.available === false ? " · no planner answer" : ""}</span>
    </button></li>`;
  }).join("")}</ol>`;
}

/** A Trace path: page part → dynamic? → api | computed → controller → hook → provider → service → contract. */
export function renderPath(pathNodes) {
  if (!pathNodes?.length) return `<p class="empty">No path.</p>`;
  return `<ol class="path">${pathNodes.map((n) => {
    const [label, cls] = DECISION[n.decision] ?? [n.decision ?? "", "d-other"];
    const picks = n.picks ? `<span class="picks">static: ${esc(n.picks.static)} · jev: ${esc(n.picks.jev)}</span>` : "";
    return `<li class="node"><span class="layer">${esc(n.layer)}</span><span class="lbl">${esc(n.label)}</span>${label ? `<span class="dec ${cls}">${esc(label)}</span>` : ""}${n.fork ? `<span class="dec d-fork" title="the two pickers disagree here">FORK</span>` : ""}${picks}</li>`;
  }).join("")}</ol>`;
}

const scoreRow = (scores, lines) => lines.map((l) => `<span class="sc"><span class="k">${esc(l.id)}</span> ${fmt(scores?.[l.id])}/${l.max}</span>`).join("");

/** The run tree: every run, its blind id and grader scores; the recommended run is marked (revealed after grading). */
export function renderRuns(item, lines) {
  if (!item.runs?.length) return `<p class="empty">${esc(item.planner?.error ?? "The planner gave no runs.")}</p>`;
  return item.runs.map((r) => {
    const rs = item.grader?.runScores?.[r.id];
    const rec = r.id === item.recommended;
    return `<section class="run ${rec ? "rec" : ""}" data-testid="beam-run" data-run="${esc(r.id)}">
      <header><b>${esc(r.id)}</b>${rs ? ` <span class="sub">graded blind as run ${esc(rs.blindId)}</span>` : ""}${rec ? ` <span class="chip ok" title="revealed to the grader's record only after every run was scored">recommended</span>` : ""}</header>
      <p class="sub">intent <code>${esc(r.labels?.intent ?? "–")}</code> · target ${esc(r.labels?.target?.kind ?? "–")} <code>${esc(r.labels?.target?.name ?? "")}</code> · layers ${esc((r.labels?.layers ?? []).join(", ") || "–")}${r.labels?.by ? ` · by ${esc(r.labels.by)}` : ""}</p>
      ${renderPath(r.path)}
      ${rs ? `<p class="scores">${scoreRow(rs.scores, lines)}</p><p class="just">${esc(rs.justification)}</p>` : ""}
    </section>`;
  }).join("");
}

/** The owner's rubric buttons (one row per line) and note. `draft` = the scores being edited. */
export function renderOwnerForm(item, rubric, draft) {
  const scores = draft?.scores ?? item.owner?.scores ?? {};
  const rows = rubric.lines.map((l) => `<div class="rline" role="group" aria-label="${esc(l.title)}">
    <span class="k" title="${esc(l.title)}">${esc(l.id)} <span class="sub">${esc(l.title)}</span></span>
    <span class="btns">${Array.from({ length: l.max + 1 }, (_, v) => `<button type="button" class="sbtn" data-line="${esc(l.id)}" data-score="${v}" aria-pressed="${scores[l.id] === v}">${v}</button>`).join("")}</span>
  </div>`).join("");
  return `<form class="owner" data-testid="owner-form">
    ${rows}
    <label class="note">Note <textarea name="note" rows="2" data-testid="owner-note">${esc(draft?.note ?? item.owner?.note ?? "")}</textarea></label>
    <button type="submit" class="primary" data-testid="owner-save">Save my grade</button> <span class="sub" data-testid="owner-status">${item.owner?.at ? `saved ${esc(item.owner.at.slice(0, 16).replace("T", " "))}` : "not graded yet"}</span>
  </form>`;
}

/** Grader vs owner per rubric line, plus overall. */
export function renderAgreement(item, lines) {
  const a = item.agreement;
  const rows = lines.map((l) => {
    const x = a.lines[l.id];
    const cls = x.agree === null ? "" : x.agree ? "ok" : Math.abs(x.diff) >= 2 ? "warn" : "near";
    return `<tr class="${cls}"><th scope="row">${esc(l.id)}</th><td>${fmt(x.grader)}</td><td>${fmt(x.owner)}</td><td>${x.diff === null ? "–" : signed(x.diff)}</td></tr>`;
  }).join("");
  const o = a.overall;
  return `<table class="agree" data-testid="agreement"><thead><tr><th>Line</th><th>Opus-Grader</th><th>Owner</th><th>Δ</th></tr></thead><tbody>${rows}</tbody>
    <tfoot><tr class="${a.disagree2 ? "warn" : ""}"><th scope="row">Overall</th><td>${fmt(o?.grader)}</td><td>${fmt(o?.owner)}</td><td data-testid="overall-diff">${o ? signed(o.diff) : "–"}</td></tr></tfoot></table>`;
}

/** The gold labels: withheld until the owner has graded the item. */
export function renderGold(item) {
  if (item.goldHidden) return `<p class="sub" data-testid="gold">The requester's gold labels appear once you have graded this item.</p>`;
  const g = item.gold, m = item.goldMatch ?? {};
  const mark = (ok) => (ok ? `<span class="chip ok">match</span>` : `<span class="chip warn">differs</span>`);
  return `<div data-testid="gold"><p>intent <code>${esc(g?.intent)}</code> ${mark(m.intent)} · target ${esc(g?.target?.kind)} <code>${esc(g?.target?.name)}</code> ${mark(m.targetKind)} · layers ${esc((g?.layers ?? []).join(", "))} ${mark(m.layers)}</p>
    ${item.notes ? `<p class="sub">Requester's private notes: ${esc(item.notes)}</p>` : ""}</div>`;
}

/** One item in full. */
export function renderDetail(item, view, draft) {
  if (!item) return `<p class="empty">Pick an item.</p>`;
  const lines = view.rubric.lines;
  const q = item.plannerQuestion;
  return `<article class="detail" data-testid="beam-detail" data-item="${esc(item.id)}">
    <h2><code>${esc(item.id)}</code> <span class="sub">${esc(item.app)}</span></h2>
    <h3>Requirement <span class="sub">(Opus-Requester)</span></h3>
    <p class="req" data-testid="requirement">${esc(item.requirement)}</p>
    <h3>Planner's question</h3>
    ${q?.text ? `<p data-testid="planner-question">${esc(q.text)}${q.options?.length ? ` <span class="sub">options: ${q.options.map(esc).join(" · ")}</span>` : ""}</p><p data-testid="requester-answer"><b>Owner (requester) answered:</b> ${esc(item.requesterAnswer?.answer ?? "–")}</p>` : `<p class="sub" data-testid="planner-question">No question asked.</p>`}
    <h3>Run tree</h3>
    ${renderRuns(item, lines)}
    <h3>Opus-Grader <span class="sub">(recommended run)</span></h3>
    ${item.grader ? `<p class="scores" data-testid="grader-scores">${scoreRow(item.grader.scores, lines)} <b>${fmt(total(item.grader.scores, lines))}/${view.summary.maxTotal}</b></p><p class="just" data-testid="grader-justification">${esc(item.grader.justification)}</p>` : `<p class="empty">Not graded (no planner answer).</p>`}
    <h3>Your grade</h3>
    ${renderOwnerForm(item, view.rubric, draft)}
    <h3>Agreement</h3>
    ${renderAgreement(item, lines)}
    <h3>Gold labels</h3>
    ${renderGold(item)}
  </article>`;
}

/** The setup bar: which results to show, what to compare with, and which prompt versions to re-run. */
export function renderSetupBar(meta, state) {
  const opt = (v, sel, label = v) => `<option value="${esc(v)}"${v === sel ? " selected" : ""}>${esc(label)}</option>`;
  const setups = meta.setups;
  return `<div class="setupbar">
    <label>Results <select data-testid="setup-select" name="setup">${setups.map((s) => opt(s.id, state.setup, `${s.id} · ${s.source}${s.mode ? ` · ${s.mode}` : ""}`)).join("")}</select></label>
    <label>Compare with <select data-testid="compare-select" name="compare">${opt("", state.compare, "—")}${setups.filter((s) => s.id !== state.setup).map((s) => opt(s.id, state.compare)).join("")}</select></label>
    <span class="sep"></span>
    <label>Requester <select data-testid="requester-select" name="requester">${meta.versions.requester.map((v) => opt(v, state.requester)).join("")}</select></label>
    <label>Grader <select data-testid="grader-select" name="grader">${meta.versions.grader.map((v) => opt(v, state.grader)).join("")}</select></label>
    ${meta.live ? `<label class="live"><input type="checkbox" name="live" data-testid="live-toggle"${state.live ? " checked" : ""}> Live (calls Opus)</label>` : `<span class="chip mut" title="start the server with TRACE_BEAM_LIVE=1 for live runs">replay only</span>`}
    <button type="button" class="primary" data-testid="rerun" data-action="rerun">Re-run with this setup</button>
    <span class="sub" data-testid="run-status" role="status">${esc(state.runStatus ?? "")}</span>
  </div>`;
}

// ------------------------------------------------------------------------------------------------ DOM
/**
 * @param {HTMLElement} root
 * @param {{fetchJson?: (url: string, init?: RequestInit) => Promise<any>}} [opts]
 */
export function mountBeam(root, opts = {}) {
  const getJson = opts.fetchJson ?? (async (u, init) => { const r = await fetch(u, { cache: "no-store", ...init }); const body = await r.json(); if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`); return body; });
  const post = (u, body) => getJson(u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const state = { setup: null, compare: "", requester: null, grader: null, live: false, selected: null, draft: null, runStatus: "" };
  let meta = null, view = null, other = null;

  async function loadMeta() {
    meta = await getJson("/api/beam/setups");
    if (!meta.setups.length) { root.innerHTML = `<p class="empty">No eval results yet. Run <code>node eval/beam/run.mjs --dry-run</code>.</p>`; return false; }
    state.setup ??= meta.setups[0].id;
    const cur = meta.setups.find((s) => s.id === state.setup) ?? meta.setups[0];
    state.requester ??= cur.versions?.requester ?? meta.versions.requester[0];
    state.grader ??= cur.versions?.grader ?? meta.versions.grader[0];
    return true;
  }
  async function loadView() {
    view = await getJson(`/api/beam/setup?id=${encodeURIComponent(state.setup)}`);
    other = state.compare ? await getJson(`/api/beam/setup?id=${encodeURIComponent(state.compare)}`) : null;
    if (!view.items.some((i) => i.id === state.selected)) { state.selected = view.items[0]?.id ?? null; state.draft = null; }
  }
  function paint() {
    const item = view.items.find((i) => i.id === state.selected);
    root.innerHTML = `${renderSetupBar(meta, state)}${renderSummary(view)}${other ? renderCompare(view, other) : ""}
      <div class="cols">${renderList(view, state.selected)}${renderDetail(item, view, state.draft)}</div>`;
  }
  async function refresh() { await loadView(); paint(); }

  root.addEventListener("change", async (e) => {
    const t = /** @type {HTMLInputElement} */ (e.target);
    if (t.name === "setup") { state.setup = t.value; if (state.compare === t.value) state.compare = ""; const s = meta.setups.find((x) => x.id === t.value); if (s?.versions) { state.requester = s.versions.requester; state.grader = s.versions.grader; } await refresh(); }
    else if (t.name === "compare") { state.compare = t.value; await refresh(); }
    else if (t.name === "requester" || t.name === "grader") state[t.name] = t.value;
    else if (t.name === "live") state.live = t.checked;
  });
  root.addEventListener("click", async (e) => {
    const el = /** @type {HTMLElement} */ (e.target).closest("button");
    if (!el) return;
    if (el.dataset.item) { state.selected = el.dataset.item; state.draft = null; paint(); return; }
    if (el.dataset.line) {
      const item = view.items.find((i) => i.id === state.selected);
      state.draft ??= { scores: { ...(item.owner?.scores ?? {}) }, note: item.owner?.note ?? "" };
      const note = /** @type {HTMLTextAreaElement|null} */ (root.querySelector("textarea[name=note]"));
      if (note) state.draft.note = note.value;
      state.draft.scores[el.dataset.line] = Number(el.dataset.score);
      paint();
      return;
    }
    if (el.dataset.action === "rerun") {
      state.runStatus = state.live ? "Running live (Opus)…" : "Replaying recorded transcripts…";
      paint();
      try {
        const { job, setup } = await post("/api/beam/run", { requester: state.requester, grader: state.grader, live: state.live });
        let j;
        do { await new Promise((r) => setTimeout(r, 400)); j = await getJson(`/api/beam/job?id=${encodeURIComponent(job)}`); } while (j.status === "running");
        if (j.status === "error") throw new Error(j.error);
        state.runStatus = `${setup}: ${state.live ? "live run" : "replay"} done`;
        await loadMeta();
        state.setup = setup;
        await refresh();
      } catch (err) { state.runStatus = `Run failed: ${err.message}`; paint(); }
    }
  });
  root.addEventListener("submit", async (e) => {
    e.preventDefault();
    const item = view.items.find((i) => i.id === state.selected);
    const note = /** @type {HTMLTextAreaElement} */ (root.querySelector("textarea[name=note]")).value;
    const scores = state.draft?.scores ?? item.owner?.scores ?? {};
    try {
      await post("/api/beam/owner", { setup: state.setup, item: item.id, scores, note });
      state.draft = null;
      await refresh();
    } catch (err) { const s = root.querySelector("[data-testid=owner-status]"); if (s) s.textContent = `Not saved: ${err.message}`; }
  });

  (async () => {
    try { if (await loadMeta()) await refresh(); }
    catch (err) { root.innerHTML = `<p class="empty">Could not load /api/beam: ${esc(err.message)}</p>`; }
  })();
}
