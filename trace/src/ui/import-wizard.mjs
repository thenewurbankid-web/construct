// Import wizard: Subframe and Swagger upload (T13). Four steps, each reusing an existing block rather than
// rebuilding it:
//   1. swagger   the existing Contract upload step (T4) — contractEmpty/contractLoaded/installContractPanel are
//                re-exported from ./contract-panel.mjs unchanged; this file adds nothing to that step.
//   2. endpoint  which endpoint/response-key is the "list" the page matches against. There is no existing
//                endpoint-CHOICE UI to reuse (checked: contract-panel.mjs only lists endpoints, it never lets you
//                pick one) — T12.2 has not built one either, so this is a minimal, reusable version; T12 should
//                adopt endpointChoiceHtml/installEndpointChoice from here rather than growing its own.
//   3. subframe  connect to a Subframe project/page/component (T13.1/T13.2). BLOCKED: mcp.subframe.com needs
//                OAuth 2.1 (see ../import/subframe/mcp-client.mjs); this step shows that plainly and falls back to
//                a clearly labelled fixture so the picker UI/logic exists and is ready to wire to a real
//                connection later. Nothing here pretends the fixture is live data.
//   4. markers   auto-suggest and click-to-mark on a fetched TSX page (T13.3), built entirely on T18's existing
//                pure modules (suggestMarkers/applyMarkers, src/import/); no parsing/marker logic is rebuilt here.
// Rendering is pure (data in, HTML string out) so every step is unit-tested in Node without a DOM; install*()
// functions are the only DOM/fetch parts, mirroring src/ui/about.mjs and src/ui/contract-panel.mjs.
export { contractEmpty, contractLoaded, installContractPanel, uploadState } from "./contract-panel.mjs";

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const STEPS = ["swagger", "endpoint", "subframe", "markers"];
const STEP_LABEL = { swagger: "Swagger", endpoint: "Endpoint", subframe: "Subframe", markers: "Markers" };

/** The step strip at the top of the wizard. @param {string} current one of STEPS */
export function stepsHtml(current) {
  const i = STEPS.indexOf(current);
  return `<ol class="iw-steps">${STEPS.map((s, idx) => `<li class="${idx === i ? "cur" : idx < i ? "done" : ""}"><span class="n">${idx + 1}</span>${esc(STEP_LABEL[s])}</li>`).join("")}</ol>`;
}

// ---------- step 2: endpoint choice (T13.5) ----------
// An endpoint response is a list candidate when it is a bare array (key: null) or an object with an array
// property (key: that property's name). Mirrors the rule toApis() uses to find the list endpoint
// (src/openapi.mjs, listShape()) but reads it back from data the API already exposes (`apis`, `listKey`) instead
// of touching src/openapi.mjs or src/contract.mjs — the deterministic core that must not change.
function arrayKeysOf(response) {
  if (Array.isArray(response)) return [null];
  if (response && typeof response === "object") return Object.keys(response).filter((k) => Array.isArray(response[k]));
  return [];
}

/**
 * Every GET endpoint that could plausibly be "the list", from the contract's own `apis` (as `GET /api/contract`
 * or `POST /api/openapi` returns them: `[{method, path, response?}, ...]`).
 *
 * @param {{method:string, path:string, response?:*}[]} apis
 * @param {string|null} listKey the contract's current pick (loadContract's `listKey`)
 * @returns {{method:string, path:string, key:string|null, value:string, current:boolean}[]}
 */
export function listCandidates(apis, listKey) {
  const out = [];
  for (const a of apis ?? []) {
    if (a.method !== "GET") continue;
    for (const key of arrayKeysOf(a.response)) out.push({ method: a.method, path: a.path, key, value: `${a.method} ${a.path}::${key ?? ""}`, current: key === (listKey ?? null) });
  }
  return out;
}

const gapKeyList = (candidates) => {
  const keys = new Set(candidates.map((c) => c.key));
  return [...keys].filter((k) => candidates.filter((c) => c.key === k).length > 1);
};

/**
 * The endpoint-choice step. When two endpoints share the same array key, picking one here still only sets
 * `feature.json`'s `list` override (the key), which src/contract.mjs already reads; it cannot force which of
 * the two endpoints wins (src/openapi.mjs picks the first match in file order) — that ambiguity is called out
 * inline rather than silently resolved.
 *
 * @param {ReturnType<typeof listCandidates>} candidates
 * @param {string|null} chosenValue the `value` of the candidate to mark as selected (defaults to the current one)
 */
export function endpointChoiceHtml(candidates, chosenValue = null) {
  if (!candidates.length) return `<p class="iw-empty">No GET endpoint in this contract returns a list (an array, or an object with one array property). Upload a contract with one, or continue without choosing an endpoint — the run leaves the list open.</p>`;
  const ambiguous = gapKeyList(candidates);
  const sel = chosenValue ?? candidates.find((c) => c.current)?.value ?? candidates[0].value;
  const rows = candidates.map((c) => `<li><label><input type="radio" name="iw-endpoint" value="${esc(c.value)}" ${c.value === sel ? "checked" : ""}><code>${esc(c.method)} ${esc(c.path)}</code>${c.key ? ` <span class="key">key: <code>${esc(c.key)}</code></span>` : ` <span class="key">bare array</span>`}${c.current ? ` <span class="cur">current</span>` : ""}</label></li>`).join("");
  const warn = ambiguous.length ? `<p class="iw-warn">${ambiguous.length} key${ambiguous.length === 1 ? "" : "s"} (${ambiguous.map((k) => `<code>${esc(k ?? "(bare array)")}</code>`).join(", ")}) appear on more than one endpoint: choosing one here sets the key, but the contract reader always uses the first matching endpoint in the file, so this may not pick the endpoint you expect. That's a limit of the existing contract reader (src/openapi.mjs), not fixed by this step.</p>` : "";
  return `<ul class="iw-eps">${rows}</ul>${warn}<button class="tb go" data-iwendpoint>Use this endpoint</button>`;
}

/** A candidate's `value` back into {method, path, key}. Exported so installEndpointChoice and tests share one parser. */
export function parseCandidateValue(value) {
  const sep = value.lastIndexOf("::");
  const methodPath = sep === -1 ? value : value.slice(0, sep);
  const key = sep === -1 ? null : value.slice(sep + 2) || null;
  const sp = methodPath.indexOf(" ");
  return { method: methodPath.slice(0, sp), path: methodPath.slice(sp + 1), key };
}

/** Wires the radio list + button to a callback; call once per mounted wizard. */
export function installEndpointChoice(root, { onChoose }) {
  root.addEventListener("click", (ev) => {
    if (!ev.target.closest("[data-iwendpoint]")) return;
    const picked = root.querySelector('input[name="iw-endpoint"]:checked');
    if (!picked) return;
    onChoose({ ...parseCandidateValue(picked.value), value: picked.value });
  });
}

// ---------- step 3: subframe project/page/component picker (T13.1/T13.2) ----------
/**
 * @param {{connected:false|"unverified"|true, reason?:string}} status from GET /api/wizard/subframe/status
 * @param {*} fixture the fixture project (../import/subframe/fixtures/mock-project.mjs shape), or null
 * @param {{pageId?:string, componentId?:string}} selection
 */
export function subframeStepHtml(status, fixture, selection = {}) {
  const banner = status.connected === true
    ? `<div class="iw-ok">Connected to Subframe.</div>`
    : `<div class="iw-notice"><b>${status.connected === "unverified" ? "Not verified" : "Not connected"}</b><div>${esc(status.reason ?? "")}</div></div>`;
  if (!fixture) return banner;
  const pages = fixture.pages.map((p) => `<li class="${p.id === selection.pageId ? "sel" : ""}"><button class="tb" data-sfpage="${esc(p.id)}">${esc(p.name)}</button>${p.id === selection.pageId ? `<ul class="iw-cmps">${p.components.map((c) => `<li><button class="tb ${c.id === selection.componentId ? "go" : ""}" data-sfcomponent="${esc(c.id)}">${esc(c.name)}</button></li>`).join("")}</ul>` : ""}</li>`).join("");
  return `${banner}<div class="iw-fixture"><b>${esc(fixture.project.name)}</b> <span class="tag">${esc(fixture._note ?? "fixture data")}</span><ul class="iw-pages">${pages}</ul></div>`;
}

/** Click-to-select a page, then a component; calls onSelect({pageId, componentId}) after each click. */
export function installSubframeStep(root, { onSelect }) {
  root.addEventListener("click", (ev) => {
    const pageBtn = ev.target.closest("[data-sfpage]");
    const cmpBtn = ev.target.closest("[data-sfcomponent]");
    if (pageBtn) onSelect({ pageId: pageBtn.dataset.sfpage, componentId: null });
    else if (cmpBtn) onSelect({ componentId: cmpBtn.dataset.sfcomponent });
  });
}

// ---------- step 4: marker auto-suggest and click-to-mark (T13.3), on T18's suggestMarkers/applyMarkers ----------
/**
 * @param {import("../import/suggest-markers.mjs").Suggestion[]} suggestions from suggestMarkers()
 * @param {Set<string>|string[]} accepted ids answered "yes"
 */
export function markerQuestionsHtml(suggestions, accepted = []) {
  const yes = accepted instanceof Set ? accepted : new Set(accepted);
  if (!suggestions.length) return `<p class="iw-empty">No marker suggestions found in this page.</p>`;
  return `<ul class="iw-marks">${suggestions.map((s) => `<li class="${s.strength}"><span class="q">${esc(s.question)}</span><span class="kind">${esc(s.kind)}</span>${s.risk ? `<span class="risk" title="${esc(s.risk)}">weak</span>` : ""}<span class="yn"><button class="tb ${yes.has(s.id) ? "go" : ""}" data-iwyes="${esc(s.id)}">Yes</button><button class="tb ${!yes.has(s.id) ? "go" : ""}" data-iwno="${esc(s.id)}">No</button></span></li>`).join("")}</ul><button class="tb go" data-iwapply>Apply accepted</button>`;
}

/**
 * The markers step's body: paste-or-upload box, "Suggest markers", per-suggestion yes/no, and (once applied)
 * "Use this page". Pure (data in, HTML string out); installMarkerStep wires the DOM/fetch side (T18.9: pasting
 * a TSX file is the existing textarea; this adds a file input as an alternative way to get the same text in).
 *
 * @param {string} source the pasted/uploaded page text, shown in the textarea
 * @param {import("../import/suggest-markers.mjs").Suggestion[]} suggestions from suggestMarkers()
 * @param {Set<string>|string[]} accepted ids answered "yes" (strong suggestions start pre-checked; see installMarkerStep)
 * @param {string|null} applied the marked-up source once "Apply accepted" has run, or null
 */
export function markerStepHtml(source, suggestions, accepted = [], applied = null) {
  return `<div class="iw-source"><textarea data-iwsource rows="8" style="width:100%" placeholder="Paste a TSX/JSX page here, or choose a file below">${esc(source)}</textarea><div class="iw-upload"><input type="file" data-iwfile accept=".tsx,.jsx,.ts,.js,text/plain" /> <button class="tb" data-iwsuggest>Suggest markers</button></div></div>${markerQuestionsHtml(suggestions, accepted)}${applied ? `<p class="iw-empty">Applied. <button class="tb go" data-iwusepage>Use this page</button></p>` : ""}`;
}

/**
 * Paste-or-upload a page, "Suggest markers", per-suggestion yes/no, and "Apply accepted". Talks to the server
 * only through the two callbacks (which the caller wires to POST /api/wizard/markers/suggest and .../apply) —
 * this function has no fetch of its own, so it is testable with fakes; only the file upload needs a real
 * `FileReader` (skip that path in a test without one).
 *
 * Strong suggestions arrive pre-checked (`accepted` already has their ids) once the caller adds them after a
 * successful suggest — see installImportWizard's `onSuggest` — because strong-only marking only reaches about
 * 55% of a page's dynamic parts (T18's own measurement): weak suggestions must still be an explicit yes/no, but
 * requiring a click per strong one too would make every re-import needlessly slower for no extra safety.
 */
export function installMarkerStep(root, { onSuggest, onApply }) {
  const accepted = new Set();
  root.addEventListener("click", (ev) => {
    if (ev.target.closest("[data-iwsuggest]")) {
      const source = root.querySelector("[data-iwsource]")?.value ?? "";
      accepted.clear();
      onSuggest(source);
    } else if (ev.target.closest("[data-iwyes]")) {
      accepted.add(ev.target.closest("[data-iwyes]").dataset.iwyes);
      onSuggest(null, accepted); // re-render only
    } else if (ev.target.closest("[data-iwno]")) {
      accepted.delete(ev.target.closest("[data-iwno]").dataset.iwno);
      onSuggest(null, accepted);
    } else if (ev.target.closest("[data-iwapply]")) {
      const source = root.querySelector("[data-iwsource]")?.value ?? "";
      onApply(source, accepted);
    }
  });
  // Choosing a file is the same as pasting its text into the box, then pressing "Suggest markers".
  root.addEventListener("change", (ev) => {
    const input = ev.target.closest("[data-iwfile]");
    const file = input?.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const source = String(reader.result ?? "");
      const ta = root.querySelector("[data-iwsource]");
      if (ta) ta.value = source;
      accepted.clear();
      onSuggest(source);
    };
    reader.readAsText(file);
  });
  return accepted;
}

const CSS = `
.iw-steps{display:flex;gap:14px;list-style:none;margin:0 0 10px;padding:0;font-size:12px}
.iw-steps li{display:flex;align-items:center;gap:5px;color:var(--mut)}
.iw-steps li.cur{color:var(--fg);font-weight:600}.iw-steps li.done{color:var(--acc)}
.iw-steps .n{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:99px;border:1px solid currentColor;font-size:10px}
.iw-empty,.iw-warn{color:var(--mut);font-size:12px}
.iw-warn{border:1.5px dashed var(--amb);background:var(--ambbg);border-radius:8px;padding:6px 9px}
.iw-notice{border:1.5px dashed var(--red);background:var(--redbg);border-radius:10px;padding:8px 10px;font-size:12px}
.iw-notice div{color:var(--fg);margin-top:3px;font-size:11.5px}
.iw-ok{border:1.5px solid var(--grn);border-radius:8px;padding:6px 9px;font-size:12px}
.iw-eps,.iw-pages,.iw-cmps,.iw-marks{list-style:none;margin:6px 0;padding:0;font-size:12px}
.iw-eps li,.iw-marks li{padding:3px 0;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.iw-marks li .kind{color:var(--mut);font-size:10.5px;text-transform:uppercase}
.iw-marks li .risk{color:var(--amb);font-size:10.5px}
.iw-fixture{margin-top:8px;font-size:12px}
.iw-fixture .tag{color:var(--mut);font-size:10.5px}
`;

/**
 * Compose the whole wizard for one example into `root`. Real network I/O only (no fakes): the callbacks call the
 * wizard's own API routes (src/import-wizard-routes.mjs) and, for the swagger step, the EXISTING contract routes
 * (`GET /api/contract`, `POST /api/openapi` via installContractPanel) — T13.4 reuses that step as-is rather than
 * building a second upload flow. Rendering stays in the pure functions above; this function is the DOM/fetch glue.
 */
export function installImportWizard(root, { example, fetchImpl = fetch } = {}) {
  document.head.insertAdjacentHTML("beforeend", `<style>${CSS}</style>`);
  let step = "swagger";
  const state = { contract: null, chosen: null, subframeStatus: { connected: false }, fixture: null, selection: {}, source: "", suggestions: [], accepted: new Set(), applied: null };

  async function loadContract() {
    state.contract = await (await fetchImpl(`/api/contract?example=${encodeURIComponent(example)}`)).json();
  }
  function goto(s) { step = s; render(); }
  function render() {
    root.innerHTML = `${stepsHtml(step)}<div class="iw-body" data-iwbody></div><div class="iw-nav">${STEPS.map((s) => `<button class="tb ${s === step ? "go" : ""}" data-iwgoto="${s}">${esc(STEP_LABEL[s])}</button>`).join("")}</div>`;
    const body = root.querySelector("[data-iwbody]");
    if (!state.contract) { body.innerHTML = `<p class="iw-empty">Loading…</p>`; return; }
    if (step === "swagger") body.innerHTML = state.contract.hasContract ? contractLoaded(state.contract, uploadState(example)) : contractEmpty(state.contract, uploadState(example));
    else if (step === "endpoint") body.innerHTML = endpointChoiceHtml(listCandidates(state.contract.apis ?? [], state.contract.listKey), state.chosen?.value ?? null);
    else if (step === "subframe") body.innerHTML = subframeStepHtml(state.subframeStatus, state.fixture, state.selection);
    else body.innerHTML = markerStepHtml(state.source, state.suggestions, state.accepted, state.applied);
  }
  root.addEventListener("click", async (ev) => {
    const g = ev.target.closest("[data-iwgoto]");
    if (g) return goto(g.dataset.iwgoto);
    if (ev.target.closest("[data-iwusepage]")) {
      await fetchImpl(`/api/wizard/apply`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ example, pageSource: state.applied }) });
      await loadContract();
      render();
    }
  });

  // Step 1 (swagger): the existing contract panel, wired exactly as the studio wires it.
  installContractPanel({
    example: () => example,
    onChange: async () => { await loadContract(); render(); },
    onRun: () => {}, // the wizard hands the contract off; running the pipeline is the studio's existing "Wire it", not this wizard's job
    onOpen: () => goto("swagger"),
  });

  installEndpointChoice(root, {
    onChoose: async (choice) => {
      state.chosen = choice;
      const res = await fetchImpl(`/api/wizard/apply`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ example, listKey: choice.key }) });
      state.contract = await res.json();
      render();
    },
  });
  installSubframeStep(root, { onSelect: (sel) => { Object.assign(state.selection, sel); render(); } });
  const accepted = installMarkerStep(root, {
    onSuggest: async (source) => {
      if (source == null) return render(); // yes/no toggle only
      state.source = source;
      state.applied = null;
      const res = await fetchImpl(`/api/wizard/markers/suggest`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source }) });
      const data = await res.json();
      state.suggestions = data.suggestions ?? [];
      // T18.9: strong suggestions start pre-checked (one click confirms all of them at once via "Apply
      // accepted"); weak ones stay unchecked and need an explicit "Yes" — see installMarkerStep's doc comment.
      for (const s of state.suggestions) if (s.strength === "strong") accepted.add(s.id);
      render();
    },
    onApply: async (source, ids) => {
      const res = await fetchImpl(`/api/wizard/markers/apply`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source, acceptedIds: [...ids] }) });
      const data = await res.json();
      state.applied = data.source ?? null;
      render();
    },
  });
  state.accepted = accepted;

  (async () => {
    const [status] = await Promise.all([
      fetchImpl(`/api/wizard/subframe/status`).then((r) => r.json()),
      loadContract(),
    ]);
    state.subframeStatus = status;
    render();
  })();
  render();
}
