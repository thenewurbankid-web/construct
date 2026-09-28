// The Trace demo shell: three screens on one page (Drop in, The fit, The Handoffs) over the existing API.
// It reads the same server-sent events as the studio, but shows them only in the pattern vocabulary (vocab.mjs).
import { PRODUCT, TERMS, STATES, summarize, headline, breakdown, plural, askTitle, plainOption, plainCandidate, humanize, scrub, byLabel, itemTerm, plainTitle, cleanEmail, groupItems, waitingTitle, TEAMS, TEAM_LABEL, TEAM_SCOPE } from "/demo/vocab.mjs";
import { wireDelay } from "/demo/wire-delay.mjs";
import { thumbDoc, thumbScale, colorCss } from "/demo/thumb.mjs";
import { SCENARIOS, scenarioById } from "/demo/scenarios.mjs";
import { icon } from "/demo/icons.mjs";
import { createTrace } from "/demo/canvas/trace.mjs"; // the canvas layer: reads the page, never changes a result
import { classify, underlying, badgeHtml } from "/inspector/issues.mjs";
import { createInspector, partListHtml } from "/inspector/inspector.mjs"; // the Part inspector: badges, click, fix, Suggest, preview, Undo

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const CIRC = 2 * Math.PI * 56; // the ring's circumference (r = 56)
const RING = ["fit", "wait", "gap", "tie", "stub"]; // segments, in the order of the legend; a Tie is striped, so it stays apart from the solid amber of Waiting

const app = {
  screen: "drop",
  scenarioId: SCENARIOS[0].id,
  online: true,
  status: null,        // /api/demo/status
  examples: [],        // /api/examples
  contracts: {},       // example -> contract | "error"
  previews: {},        // example -> preview html
  suggest: false,      // the "Let Suggest answer what it can" switch
  present: false,      // Presenter mode
  run: null,           // the run on screen
  wiring: false,       // Wire it was pressed and the Drop in screen is still showing its pulse (WIRE_DELAY_MS)
  thumbCss: null,      // the shell's own styles, fetched once for the design thumbnail
  last: {},            // scenario id -> summary of the previous finished run, for "same result" on Replay
};
const scenario = () => scenarioById(app.scenarioId);
const post = (url, body) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
const statusOf = (id) => app.status?.scenarios?.find((s) => s.id === id);
// The endpoints of a scenario's contract (cached with the Drop in screen's copy), for the trace's Contract rail.
async function contractFor(example) {
  if (!app.contracts[example]) {
    try { const r = await fetch(`/api/contract?example=${encodeURIComponent(example)}`); app.contracts[example] = r.ok ? await r.json() : "error"; } catch { app.contracts[example] = "error"; }
  }
  return app.contracts[example] === "error" ? [] : app.contracts[example].apis ?? [];
}
const trace = createTrace({ present: () => app.present, reduced, contract: contractFor });
// Debug hook for measurements and screenshots: only on a dev checkout AND only with ?canvasdebug. The server tells the page which build it
// is via /api/build ({ dev: true } when no build-info.json sits next to it), so a deployed build never exposes it.
if (new URLSearchParams(location.search).has("canvasdebug")) fetch("/api/build").then((r) => r.json()).then((b) => { if (b?.dev === true) window.__trace = trace; }).catch(() => {});
// The Part inspector opens on any part once a run is finished; applying a change replays the example and waits for it.
const inspector = createInspector({
  example: () => scenario().example,
  toast: (m) => toast(m),
  canOpen: () => !!app.run?.done || app.screen === "hand",
  replay: () => new Promise((resolve) => { app.afterRun = resolve; startRun({ replay: app.screen === "hand", auto: true }); }), // auto: no Asks, the Ledger settles everything it can
});
inspector.install();

// ---------- chrome: theme, presenter mode, steps, shortcuts ----------
function paintTheme() {
  const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  const b = $("#bTheme");
  b.innerHTML = icon(dark ? "sun" : "moon", 16);
  b.setAttribute("aria-label", dark ? "Switch to the light theme" : "Switch to the dark theme");
  b.title = b.getAttribute("aria-label");
}
function toggleTheme() {
  const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  const next = dark ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  store.set("trace-theme", next);
  paintTheme();
}
function setPresent(on) {
  app.present = on;
  document.documentElement.dataset.present = on ? "1" : "0";
  store.set("trace-present", on ? "1" : null);
  const b = $("#bPresent");
  b.setAttribute("aria-pressed", String(on));
  b.innerHTML = `${icon("present", 16)}<span>${on ? "Presenting" : "Present"}</span>`;
}
const tempo = () => (app.present ? 2.2 : 1); // Presenter mode slows the reveal so an audience can follow

const STEP_ORDER = ["drop", "fit", "hand"];
function go(screen) {
  app.screen = screen;
  for (const s of STEP_ORDER) $(`#s-${s}`).hidden = s !== screen;
  $$("#steps li").forEach((li) => {
    const i = STEP_ORDER.indexOf(li.dataset.step), cur = STEP_ORDER.indexOf(screen);
    if (i === cur) li.setAttribute("aria-current", "step"); else li.removeAttribute("aria-current");
    li.classList.toggle("past", i < cur);
  });
  paintKeys();
  trace.screen(screen);
  if (!inspector.isOpen()) $("#main").focus({ preventScroll: true }); // so Space, Enter, R and Esc work without a click first
  window.scrollTo(0, 0);
}
function paintKeys() {
  const k = (t) => `<kbd>${t}</kbd>`;
  const q = app.run?.question && !app.run.dead;
  const rows = {
    drop: [[k("1") + k("2") + k("3"), "pick a screen"], [k("Space"), "Wire it"]],
    fit: q ? [[k("1") + "–" + k("9"), "answer"], [k("S"), "skip"], [k("Shift") + k("S"), "skip the rest"], [k("T"), "replay the trace"], [k("M"), "map"], [k("Esc"), "back"]] : app.run?.done ? [[k("Space"), "See the Handoffs"], [k("T"), "replay the trace"], [k("M"), "map"], [k("Esc"), "back"]] : [[k("T"), "replay the trace"], [k("M"), "map"], [k("Esc"), "back"]],
    hand: [[k("R"), "Replay"], [k("Space"), "Replay"], [k("Esc"), "back to the fit"]],
  }[app.screen];
  $("#keys").innerHTML = rows.map(([keys, label]) => `<span>${keys} ${label}</span>`).join("");
}
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove("show"), 2600);
}
function notice(kind, text, action) {
  const n = $("#notice");
  if (!text) { n.hidden = true; return; }
  n.className = `notice ${kind}`;
  n.hidden = false;
  n.innerHTML = `${icon(kind === "error" ? "alert" : "suggest", 20)}<span>${esc(text)}</span>${action ? `<button class="btn sm" type="button" id="noticeAct">${esc(action)}</button>` : ""}`;
  $("#noticeAct")?.addEventListener("click", () => init());
}

// ---------- screen 1: Drop in ----------
function paintScenarios() {
  $("#scen").innerHTML = SCENARIOS.map((s, i) => {
    const st = statusOf(s.id), on = s.id === app.scenarioId, missing = st && !st.present;
    const notes = [];
    if (missing) notes.push(`${icon("alert", 16)}Not found on this machine`);
    else {
      if (st?.ledger) notes.push(`${icon("ledger", 16)}${st.ledger} decision${st.ledger === 1 ? "" : "s"} in the Ledger. Wire it reuses them.`);
      if (st?.fixed) notes.push(`${icon("check", 16)}The prepared fix is already applied.`);
    }
    return `<button class="scen-card" type="button" role="radio" aria-checked="${on}" tabindex="${on ? 0 : -1}" data-id="${s.id}" ${missing ? "disabled" : ""}>
      <span class="scen-top"><span class="radio-dot"></span><span class="scen-title">${esc(s.title)}</span><span class="tagpill">${esc(s.tag)}</span></span>
      <span class="scen-cap">${esc(s.caption)}</span>
      ${notes.map((n) => `<span class="scen-note">${n}</span>`).join("")}
      <span class="sr-only">Shortcut ${i + 1}</span>
    </button>`;
  }).join("");
}
function pick(id) {
  if (app.wiring || (id === app.scenarioId && $("#scen .scen-card"))) return;
  app.scenarioId = id;
  paintScenarios();
  paintWire();
  loadContract();
  paintThumb();
}
// What happens after "Wire it", in three plain steps (static text; the icons are the shell's own set).
const HOW = [["plug", "Wire it"], ["ask", "Answer the Asks"], ["handoff", "Hand off"]];
function paintHow() {
  $("#how").innerHTML = HOW.map(([ic, text], i) => `<li>${icon(ic, 16)}<span>${esc(text)}</span>${i < HOW.length - 1 ? icon("arrow-right", 14).replace('class="ic"', 'class="ic next"') : ""}</li>`).join("");
}
// The design thumbnail: the selected screen's designed page (GET /api/preview, the same fragment the fit screen draws), in a sandboxed,
// inert frame scaled down to its box. The box has a fixed shape, so picking another screen moves nothing.
const isDark = () => (document.documentElement.dataset.theme ? document.documentElement.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches);
async function shellCss() {
  if (app.thumbCss == null) {
    try { const r = await fetch("/demo/demo.css"); app.thumbCss = r.ok ? await r.text() : ""; } catch { app.thumbCss = ""; }
  }
  return app.thumbCss;
}
let thumbGen = 0;
async function paintThumb() {
  const my = ++thumbGen, s = scenario(), box = $("#thumbFrame"), cap = $("#thumbCap");
  cap.textContent = `${s.title}, as designed. This is the page ${PRODUCT.name} reads.`;
  const [html, css] = await Promise.all([loadPreview(s.example), shellCss()]);
  if (my !== thumbGen) return;
  const old = box.querySelector("iframe");
  if (!html || !css) { old?.remove(); cap.textContent = `${s.title}. The preview isn't available right now.`; return; }
  const f = document.createElement("iframe");
  f.setAttribute("sandbox", ""); // no scripts, no same-origin access: it is a picture
  f.setAttribute("tabindex", "-1");
  f.setAttribute("aria-hidden", "true");
  f.setAttribute("loading", "eager");
  const cs = getComputedStyle(document.documentElement);
  f.srcdoc = thumbDoc(html, css, colorCss((n) => cs.getPropertyValue(n).trim(), isDark()));
  f.addEventListener("load", () => { if (my !== thumbGen) return; box.querySelectorAll("iframe").forEach((x) => x !== f && x.remove()); f.classList.add("on"); }, { once: true });
  box.append(f);
  sizeThumb();
}
function sizeThumb() { const box = $("#thumbFrame"), w = box.getBoundingClientRect().width; if (w > 0) box.style.setProperty("--ts", String(thumbScale(w))); }
new ResizeObserver(sizeThumb).observe($("#thumbFrame"));
new MutationObserver(() => paintThumb()).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] }); // the theme toggle
matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => paintThumb());
function paintWire() {
  const b = $("#bWire");
  b.innerHTML = `Wire it${icon("arrow-right", 20)}`;
  b.disabled = !app.online || !app.examples.length || statusOf(app.scenarioId)?.present === false;
  b.title = `Wire ${scenario().title}: ${app.suggest ? "Suggest answers what it can, you answer the rest" : "you answer each Ask"}`;
}
async function loadContract() {
  const s = scenario(), box = $("#contract");
  const cached = app.contracts[s.example];
  if (!cached) box.innerHTML = `<div class="skel" aria-busy="true"><i></i><i></i><i></i></div>`;
  if (!cached) {
    try {
      const r = await fetch(`/api/contract?example=${encodeURIComponent(s.example)}`);
      app.contracts[s.example] = r.ok ? await r.json() : "error";
    } catch { app.contracts[s.example] = "error"; }
  }
  if (s.id !== app.scenarioId) return;
  const c = app.contracts[s.example];
  if (c === "error") { box.innerHTML = `<div class="contract-msg">We couldn't read the contract for ${esc(s.title)}. Check that the server is running, then pick the screen again.</div>`; return; }
  box.innerHTML = `<div class="contract-head"><b>${esc(s.title)} API</b><span>${c.apis.length} endpoint${c.apis.length === 1 ? "" : "s"}${c.route ? ` for the ${esc(c.route)} screen` : ""}</span></div>
    <ul class="eps">${c.apis.map((a) => `<li><span class="method ${esc(a.method)}">${esc(a.method)}</span><span>${esc(a.path)}</span></li>`).join("")}</ul>
    <div class="contract-foot" id="contractDrop"><span title="Upload a Swagger/OpenAPI file (.json, .yaml or .yml) and this screen is wired against it. You can also drop the file on this card.">Have your own API?</span><button class="btn ghost sm" type="button" id="bUpload">${icon("upload", 16)}Upload a contract</button><input type="file" id="contractFile" accept=".json,.yaml,.yml,application/json" hidden></div>
    <div class="upload-msg" id="uploadMsg" role="status" aria-live="polite"></div>`;
}
// The contract card's upload: the same endpoint the studio uses (POST /api/openapi, JSON { name, text }); the server checks the file
// and keeps the old contract when it can't be used, and Reset demo puts the original back.
function uploadMsg(kind, text) {
  const m = $("#uploadMsg");
  if (m) { m.className = `upload-msg ${kind}`; m.textContent = text; }
}
async function uploadContract(file) {
  const s = scenario();
  if (!file) return;
  if (app.run && !app.run.done && !app.run.dead) return uploadMsg("error", "A run is in progress. Upload once it has finished.");
  if (file.size > 2 * 1024 * 1024) return uploadMsg("error", "That file is over 2 MB, too big for a contract.");
  uploadMsg("busy", "Checking the file...");
  try {
    const text = await file.text();
    if (text.includes("\u0000")) return uploadMsg("error", "That doesn't look like a text file. Upload a .json, .yaml or .yml file.");
    const r = await post(`/api/openapi?example=${encodeURIComponent(s.example)}`, { name: file.name, text });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return uploadMsg("error", d.error ?? "The upload failed.");
    delete app.contracts[s.example];
    await refreshStatus();
    await loadContract();
    const n = d.endpoints?.length ?? 0;
    uploadMsg("ok", `Contract replaced: ${n} endpoint${n === 1 ? "" : "s"}${d.gaps?.length ? `, ${d.gaps.length} note${d.gaps.length === 1 ? "" : "s"} about missing examples` : ""}. Wire it to see the new fit.`);
  } catch (e) { uploadMsg("error", e.message); }
}
function paintSuggest() {
  const ok = !!app.status?.suggest;
  const box = $("#suggestBox"), input = $("#suggestOn");
  input.disabled = !ok;
  if (!ok) { app.suggest = false; }
  input.checked = app.suggest;
  box.classList.toggle("off", !ok);
  $("#suggestNote").textContent = ok
    ? "Suggest proposes an answer for each Ask, and rules check it. Whatever it can't settle, you decide."
    : "Suggest isn't available right now, so you answer the Asks yourself. Everything else works the same.";
}

// ---------- reset ----------
function paintReset() {
  const box = $("#resetBox");
  box.innerHTML = `<button class="btn ghost sm" type="button" id="bReset" title="Start all three scenarios clean">${icon("reset", 16)}<span>Reset demo</span></button>`;
}
function askReset() {
  $("#resetBox").innerHTML = `<span class="confirm" role="alertdialog" aria-label="Reset the demo?">Clear saved answers in all three scenarios?<button class="btn sm primary" type="button" id="bResetYes">Reset</button><button class="btn sm ghost" type="button" id="bResetNo">Keep</button></span>`;
  $("#bResetNo").focus();
}
async function doReset() {
  abandon();
  try {
    await post("/api/demo/release"); // a run left waiting on an Ask (a closed tab, say) would block the reset

    for (const s of SCENARIOS) {
      const r = await post("/api/reset", { example: s.example });
      if (r.status === 409) { toast("A run is still finishing. Try again in a moment."); paintReset(); return; }
    }
  } catch { toast("Couldn't reach the server to reset."); paintReset(); return; }
  app.contracts = {}; app.last = {}; app.run = null;
  await refreshStatus();
  paintReset(); paintScenarios(); loadContract(); go("drop");
  toast("Demo reset. All three scenarios start clean.");
}

// ---------- data ----------
async function refreshStatus() {
  try { app.status = await (await fetch("/api/demo/status")).json(); } catch { app.status = null; }
  paintSuggest();
  paintScenarios();
  paintWire();
}
async function loadPreview(example) {
  if (app.previews[example] != null) return app.previews[example];
  try {
    const r = await fetch(`/api/preview?example=${encodeURIComponent(example)}`);
    app.previews[example] = r.ok ? await r.text() : "";
  } catch { app.previews[example] = ""; }
  return app.previews[example];
}

// ---------- screen 2: the fit ----------
// A run is followed through a small queue, so events are shown in order and (in Presenter mode) a little slower.
function newRun(sc) {
  return { sc, id: null, es: null, queue: [], busy: false, dead: false, skipRest: false, steps: {}, trees: 0, stage: "idle", tree: null, stats: null, prev: {}, items: {}, itemsList: null, question: null, answers: [], teams: null, done: null, error: null, ai: null, aiCalls: 0, shown: { fit: 0 }, compare: null, askBusy: false, askMsg: null };
}

async function startRun({ replay = false, auto = false } = {}) {
  const sc = scenario();
  if (app.run && !app.run.done && !app.run.error) abandon();
  const before = app.run?.sc.id === sc.id ? app.run.final ?? null : null;
  const run = (app.run = newRun(sc));
  run.before = before ?? app.last[sc.id] ?? null;
  run.replay = replay; // a Replay goes on to the Handoffs by itself once it is done
  run.fixedAtStart = !!statusOf(sc.id)?.fixed; // was the contract already fixed when this run began?
  notice(null);
  inspector.clearBadges($("#pv"));
  go("fit");
  $("#stageTitle").innerHTML = `${esc(sc.title)}<small>your designed page</small>`;
  paintHero(); paintProgress(); paintSide();
  const html = await loadPreview(sc.example);
  if (run !== app.run) return;
  $("#pv").innerHTML = html || `<p class="contract-msg">We couldn't draw the design for this screen.</p>`;
  $("#offpage").hidden = true;
  paintLegend();
  await trace.begin(sc); // the Contract rail and a clean overlay, before the first result arrives
  if (run !== app.run) return;
  try {
    const r = await post("/api/run", { example: sc.example, useSaved: true, auto, ai: app.suggest && app.status?.suggest ? { enabled: true, explain: false } : null });
    if (!r.ok) throw new Error(`The server answered ${r.status}`);
    run.id = (await r.json()).run;
  } catch (err) { return fail(run, "connect", err); }
  attach(run);
}

function attach(run) {
  run.es?.close();
  run.es = new EventSource(`/api/events?run=${run.id}`);
  run.es.onmessage = (m) => { run.lost = false; enqueue(run, JSON.parse(m.data)); };
  run.es.onerror = () => { if (!run.done && !run.error) { run.es.close(); fail(run, "lost"); } };
}
function enqueue(run, ev) {
  run.queue.push(ev);
  if (!run.busy) pump(run);
}
async function pump(run) {
  run.busy = true;
  while (run.queue.length) {
    const ev = run.queue.shift();
    const wait = handle(run, ev);
    if (wait && !reduced() && !run.dead) await sleep(wait * tempo());
  }
  run.busy = false;
}

// One handler per event of the run; each returns how long (ms) to hold before showing the next one.
const on = {
  step(run, d) { run.steps[d.id] = { status: d.status, detail: d.detail ?? run.steps[d.id]?.detail }; paintProgress(); },
  tree(run, d) {
    run.trees++;
    run.stage = run.trees === 1 ? "found" : "matched"; // the first one is only "what was found", nothing is resolved yet
    run.tree = d.tree;
    const first = run.trees === 2;
    paintTree(run);
    return run.stage === "matched" ? (first ? 500 : 220) : 300;
  },
  question(run, d) {
    if (run.skipRest || run.dead) { post("/api/answer", { run: run.id, answer: { skip: true } }); return 0; }
    run.question = d;
    run.askBusy = false; run.askMsg = null;
    paintSide(); paintProgress(); paintKeys(); paintTree(run);
    return 0;
  },
  answered(run, d) {
    run.question = null;
    run.askBusy = false; run.askMsg = null;
    run.answers.push(d);
    paintSide(); paintProgress(); paintKeys();
    return 0;
  },
  "ai-log"(run) { run.aiCalls++; paintProgress(); },
  ai(run, d) { run.ai = d.stats; },
  items(run, d) {
    run.itemsList = d.items;
    run.items = Object.fromEntries(d.items.map((i) => [i.id, i]));
    paintTree(run);
  },
  actions(run, d) { run.teams = d.teams; },
  done(run, d) { finish(run, d); },
  error(run, d) { run.es?.close(); fail(run, "run", new Error(d.message)); },
};
function handle(run, ev) {
  if (run.dead) {
    if (ev.type === "question") return on.question(run, ev.data);
    if (ev.type === "done" || ev.type === "error") run.es?.close();
    return 0;
  }
  return on[ev.type]?.(run, ev.data) ?? 0;
}

// Stop following a run without leaving it hanging: any Ask it is waiting on is skipped, so a later Reset is not blocked.
function abandon() {
  const run = app.run;
  if (!run || run.done || run.error || run.dead) return;
  run.dead = true; run.skipRest = true;
  if (run.question) { post("/api/answer", { run: run.id, answer: { skip: true } }); run.question = null; }
}

function stats(run) {
  if (!run.tree) return null;
  const s = summarize(run.tree, { items: run.items, prev: run.prev });
  for (const [id, t] of Object.entries(s.states)) if (t === "tie" || t === "wait") run.prev[id] = t; // remembered for a part that is skipped
  return (run.stats = s);
}

function paintTree(run) {
  if (run.dead || run !== app.run) return;
  const s = stats(run);
  paintHero(); paintLegend(); paintProgress();
  if (run.stage !== "matched" || !s) return;
  // colour the page: only attributes change, so nothing reflows while results stream in
  const box = $("#pv");
  let n = 0;
  const step = app.present ? 90 : 30, cap = app.present ? 2200 : 900;
  const asking = run.question ? run.question.id.split("#")[0] : null;
  $$("[data-asking]", box).forEach((el) => el.removeAttribute("data-asking"));
  for (const [id, term] of Object.entries(s.states)) {
    const els = $$(`[data-id="${CSS.escape(id)}"]`, box);
    for (const el of els) {
      if (el.dataset.part !== term) { el.style.setProperty("--d", `${Math.min(n++ * step, cap)}ms`); el.dataset.part = term; el.title = `${TERMS[term].word}: ${TERMS[term].def}`; }
    }
  }
  trace.update(run.tree, s.states); // the canvas reads what is now on the page and pulses each part that changed
  if (asking) {
    const els = $$(`[data-id="${CSS.escape(asking)}"]`, box);
    els.forEach((el) => el.setAttribute("data-asking", ""));
    if (els[0] && run.lastAsked !== asking) { run.lastAsked = asking; els[0].scrollIntoView({ block: "center", behavior: reduced() ? "auto" : "smooth" }); }
  }
  // parts that exist in the contract or the form but not on the page
  const off = [];
  for (const g of run.tree.groups) for (const leaf of g.leaves) {
    if (!/^(form\.missing\.|gap\.)/.test(leaf.id)) continue;
    const c = leaf.cells.filter(Boolean)[0];
    if (c) off.push(scrub(c.title === "gap" ? c.sub : `${c.title}: ${c.sub}`));
  }
  const ob = $("#offpage");
  ob.hidden = !off.length;
  ob.innerHTML = off.slice(0, 4).map((t) => `<div><b>Not on the page</b> ${esc(t)}</div>`).join("") + (off.length > 4 ? `<div>and ${off.length - 4} more</div>` : "");
}

// Issue badges: one small button per part with a problem, over the designed page (never inside it, so nothing reflows).
function paintIssues(run) {
  const box = $("#pv");
  if (run !== app.run || !run.done || !run.tree) return inspector.clearBadges(box);
  const kinds = {}, unders = {};
  for (const g of run.tree.groups) for (const leaf of g.leaves) {
    const k = classify(leaf);
    if (k) { kinds[leaf.id] = k; unders[leaf.id] = underlying(k, run.items[leaf.id]); }
  }
  run.kinds = kinds; run.unders = unders;
  inspector.paintBadges({ box, kinds, unders });
}

function paintLegend() {
  const s = app.run?.stats ?? { fit: 0, wait: 0, gap: 0, tie: 0, stub: 0 };
  const shown = app.run?.stage === "matched";
  $("#legend").innerHTML = STATES.map((k) => `<span class="chip" title="${esc(TERMS[k].def)}"><i class="sw ${k}" aria-hidden="true"></i>${TERMS[k].word} <b>${shown ? s[k] ?? 0 : "–"}</b></span>`).join("");
}

function tween(el, to) {
  const from = Number(el.dataset.n ?? 0);
  el.dataset.n = to;
  if (reduced() || from === to) { el.textContent = to; return; }
  const t0 = performance.now(), dur = 500;
  const tick = (t) => {
    const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
    if (Number(el.dataset.n) !== to) return; // a newer value took over
    el.textContent = Math.round(from + (to - from) * e);
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
function paintHero() {
  const run = app.run, s = run?.stage === "matched" ? run.stats : null, hero = $("#hero");
  if (!hero.firstElementChild) {
    hero.innerHTML = `<div class="ring"><svg viewBox="0 0 128 128" aria-hidden="true"><circle class="track-c" cx="64" cy="64" r="56"/><defs><pattern id="ringTie" patternUnits="userSpaceOnUse" width="7" height="7" patternTransform="rotate(45)"><rect class="pat-a" width="3.5" height="7"/><rect class="pat-b" x="3.5" width="3.5" height="7"/></pattern></defs>${RING.map((k) => `<circle class="a-${k}" cx="64" cy="64" r="56" stroke-dasharray="0 ${CIRC}" stroke-dashoffset="0"/>`).join("")}</svg><div class="ring-num" id="ringNum">0</div></div>
      <div class="hero-text"><div class="hero-of" id="heroOf"></div><div class="hero-need" id="heroNeed"></div></div>`;
  }
  hero.classList.toggle("idle", !s);
  hero.setAttribute("role", "group");
  if (!s) {
    const found = run?.stage === "found" ? run.tree?.stats?.total : 0;
    hero.setAttribute("aria-label", found ? `${found} parts found` : "Waiting to read the design");
    $("#heroOf").textContent = found ? `${found} parts found` : "Reading the design";
    $("#heroNeed").innerHTML = `<span class="dot"></span>Nothing is matched yet`;
    $("#ringNum").textContent = "0"; $("#ringNum").dataset.n = 0;
    $$(".ring circle:not(.track-c)", hero).forEach((c) => c.setAttribute("stroke-dasharray", `0 ${CIRC}`));
    return;
  }
  hero.setAttribute("aria-label", headline(s));
  tween($("#ringNum"), s.fit);
  $("#heroOf").textContent = s.needHuman ? `of ${s.total} parts fit` : `All ${s.total} parts fit`;
  const need = $("#heroNeed");
  need.className = `hero-need${s.needHuman ? "" : " clear"}`;
  need.dataset.k = ["wait", "gap", "tie", "stub"].find((k) => s[k]) ?? ""; // the dot takes the colour of what leads the line (the words carry it too)
  need.innerHTML = `<span class="dot"></span><span>${esc(s.needHuman ? breakdown(s) || `${s.needHuman} ${s.needHuman === 1 ? "needs" : "need"} a human` : "Nothing is open")}</span>`;
  let cum = 0;
  for (const k of RING) {
    const len = (s[k] / s.total) * CIRC, c = $(`.ring .a-${k}`, hero);
    c.setAttribute("stroke-dasharray", `${Math.max(0, len - (s[k] && s[k] < s.total ? 1.5 : 0))} ${CIRC}`);
    c.setAttribute("stroke-dashoffset", String(-cum));
    cum += len;
  }
}

function progressText(run) {
  if (run.error) return { kind: "wait", text: "Something went wrong" };
  if (run.done) return { kind: "tick", text: "Wired. Ready for the Handoffs" };
  if (run.skipRest && run.question) return { kind: "spin", text: "Skipping the rest for now" };
  if (run.question) return { kind: "wait", text: `Waiting for your answer on Ask ${run.question.n} of ${run.question.total}` };
  const st = run.steps, S = (id) => st[id]?.status;
  if (S("emit") === "running") return { kind: "spin", text: "Writing the wired code" };
  if (S("plan") === "running") return { kind: "spin", text: "Working out who needs to do what" };
  if (S("ask") === "running") return { kind: "spin", text: run.skipRest ? "Skipping the rest for now" : run.ai || run.aiCalls ? "Suggest is checking the Asks" : st.ask.detail?.count ? `Working through ${plural(st.ask.detail.count, "ask")}` : "Checking what needs asking" };
  if (S("match") === "running") return { kind: "spin", text: "Matching every part against the API" };
  if (S("extract") === "done") return { kind: "spin", text: `Found ${run.tree?.stats?.total ?? "the"} parts in the design` };
  return { kind: "spin", text: run.id || !run.steps.extract ? "Reading the design" : "Starting" };
}
function paintProgress() {
  const run = app.run;
  if (!run) return;
  const { kind, text } = progressText(run);
  $("#progress").innerHTML = kind === "spin"
    ? `<span class="spin"></span><span>${esc(text)}…</span>`
    : `<span class="${kind}">${icon(kind === "tick" ? "check" : "ask", 18)}</span><span>${esc(text)}</span>`;
}

function paintSide() {
  const run = app.run, box = $("#sideBody");
  if (run.error) { box.innerHTML = errorCard(run); return; }
  if (run.question && !run.skipRest) { box.innerHTML = askCard(run.question); focusAsk(); return; }
  if (run.done) { box.innerHTML = doneCard(run); return; }
  box.innerHTML = `<div class="skelcard skel" aria-hidden="true"><i></i><i></i><i></i></div>`;
}
function focusAsk() {
  const t = $("#sideBody .txt");
  if (t) { t.focus(); t.select(); } else $("#sideBody .opt")?.focus({ preventScroll: true });
}

function em(text) { return esc(text).replace(/\*([^*]+)\*/g, "<em>$1</em>"); }
// The API fields whose names share a word with the part come first (maturity -> maturity_score), so the mismatch is visible.
function relevant(list, id) {
  const words = humanize(id.split(".").pop()).toLowerCase().split(" ").filter((w) => w.length > 2);
  const score = (a) => words.filter((w) => a.label.toLowerCase().includes(w)).length;
  return list.map((a, i) => [a, i, score(a)]).sort((x, y) => y[2] - x[2] || x[1] - y[1]).map((x) => x[0]);
}
function askCard(q) {
  const t = askTitle(q), ctx = q.context ?? {}, cands = ctx.candidates ?? [];
  const kind = { tie: "Tie", gap: TERMS.wait.phrase, stub: "Stub" }[t.kind], look = t.kind === "gap" ? "wait" : t.kind; // an Ask about a part nothing in the API gives is Waiting for you, not yet a Gap
  const facts = [];
  if (!q.sub && ctx.design?.length) facts.push(`<div class="fact"><span>The design shows</span><span class="vals">${ctx.design.map((d) => `<span class="val">${esc(d)}</span>`).join("")}</span></div>`);
  if (!q.sub && !cands.length && ctx.available?.length && !q.id.startsWith("action.")) facts.push(`<div class="fact"><span>The API has</span><span class="vals">${relevant(ctx.available, q.id).slice(0, 4).map((a) => `<span class="val">${esc(a.label)}${a.sample ? `: ${esc(a.sample)}` : ""}</span>`).join("")}</span></div>`);
  if (!q.sub && q.id.startsWith("action.") && ctx.available?.length) facts.push(`<div class="fact"><span>The API can</span><span class="vals">${ctx.available.slice(0, 6).map((a) => `<span class="val">${esc(a.label)}</span>`).join("")}</span></div>`);
  let body;
  if (q.type === "text") body = `<input class="txt" id="askText" value="${esc(q.default ?? "")}" autocomplete="off" spellcheck="false" aria-label="Name"><div class="ask-foot"><button class="btn primary" type="button" data-submit="text">Use this name</button></div>`;
  else if (q.type === "multi") body = `<div class="opts">${q.options.map((o, i) => `<label class="opt"><input type="checkbox" data-multi="${i}"><span>${esc(plainOption(o))}</span></label>`).join("")}</div><div class="ask-foot"><button class="btn primary" type="button" data-submit="multi">Continue</button></div>`;
  // T12.4: the joint placeholder follow-up (where from? which fields? what's it called?) answered as one form,
  // not three separate Asks; the fields checklist is pre-checked by name evidence (suggestedInputs).
  else if (q.type === "joint") body = `<div class="opts">${(q.sources ?? []).map((o, i) => `<label class="opt"><input type="radio" name="jointFrom" value="${esc(o.value)}" ${i === 0 ? "checked" : ""}><span>${esc(plainOption(o.label))}</span></label>`).join("")}</div>` +
    (q.itemFields?.length ? `<div class="opts">${q.itemFields.map((o) => `<label class="opt"><input type="checkbox" data-jointfield="${esc(o.value)}" ${q.suggestedInputs?.includes(o.value) ? "checked" : ""}><span>${esc(plainOption(o.label))}</span></label>`).join("")}</div>` : "") +
    `<input class="txt" id="jointFn" value="${esc(q.defaultName?.fields ?? "")}" autocomplete="off" spellcheck="false" aria-label="Placeholder name"><div class="ask-foot"><button class="btn primary" type="button" data-submit="joint">Continue</button></div>`;
  // option-style Ask: the only branch a per-Ask Suggest button applies to (text/multi/joint aren't in scope)
  const isPlainOption = q.type !== "text" && q.type !== "multi" && q.type !== "joint";
  const busy = isPlainOption && !!app.run?.askBusy, askMsg = isPlainOption ? app.run?.askMsg : null;
  if (!body) body = `<div class="opts">${q.options.map((o, i) => {
    const c = cands[i], samples = c?.samples?.length ? c.samples.join("  ·  ") : "";
    return `<button class="opt" type="button" data-answer="${i}" ${busy ? "disabled" : ""}><kbd>${i + 1}</kbd><span>${esc(plainOption(o))}</span>${samples ? `<span class="samples">${esc(plainCandidate(c.label))}: ${esc(samples)}</span>` : ""}</button>`;
  }).join("")}</div>`;
  const rest = !q.sub && q.total - q.n > 0;
  const canSuggest = isPlainOption && !!app.status?.suggest;
  const foot = `<div class="ask-foot"><button class="btn ghost sm" type="button" data-skip ${busy ? "disabled" : ""}>${icon("skip", 16)}Skip for now</button>${rest ? `<button class="btn ghost sm" type="button" data-skiprest ${busy ? "disabled" : ""}>Skip the rest</button>` : ""}${canSuggest ? `<button class="btn ghost sm" type="button" data-suggest-ask ${busy ? "disabled" : ""}>${icon("suggest", 16)}Suggest</button>` : ""}</div>` +
    (busy ? `<p class="ask-suggest busy"><span class="spin"></span>Suggest is checking this Ask…</p>` : askMsg ? `<p class="ask-suggest note">${esc(askMsg)}</p>` : "");
  return `<section class="ask ${look}" aria-label="Ask">
    <div class="ask-top"><span class="kind ${look}">${icon(look, 16)}${kind}</span><span>${q.sub ? "One more question" : "Ask"}</span><span class="ask-n">${q.sub ? "" : `${q.n} of ${q.total}`}</span></div>
    <h2>${em(t.text)}</h2>
    ${facts.length ? `<div class="facts">${facts.join("")}</div>` : ""}
    ${body}${foot}
  </section>`;
}

function doneCard(run) {
  const s = run.final ?? run.stats;
  if (!s) return "";
  const skipped = run.answers.filter((a) => a.source === "skipped").length;
  const aiNote = app.suggest && run.ai?.errors?.length ? `<p>Suggest couldn't reach its helper for some Asks, so those were left for you.</p>` : "";
  return `<section class="card-msg" aria-label="Result">
    <h2>${s.needHuman ? "Wired. The rest is marked, never guessed." : "Wired. Every part fits."}</h2>
    <p>${s.needHuman ? `${breakdown(s)}. ${s.wait ? "Answer the Asks now, or hand each one to the team that can close it." : "Each one goes to the team that can close it."}` : "Nothing needs a human on this screen."}${skipped ? ` ${plural(skipped, "ask")} skipped: they stay open until someone answers them.` : ""}</p>${aiNote}
    <div class="row"><button class="btn primary lg" type="button" data-next id="bNext">See the Handoffs${icon("arrow-right", 20)}</button></div>
    ${partList(run)}
  </section>`;
}
// The parts that need a human, each with its kind of problem. Click one to open it.
// A team's item as Fit, Waiting, Gap, Tie or Stub: the run's open item (it knows a skipped Ask is still waiting) decides, else the item itself.
const itemTermOf = (run, it) => itemTerm(run.items?.[it.id] ?? it);
const itemTitle = (run, it) => (itemTermOf(run, it) === "wait" ? waitingTitle(it.title) : plainTitle(it.title));
function partList(run) {
  const seen = new Set(), list = [];
  for (const t of run.teams ?? []) for (const it of t.items) if (/^(value|list|action|form)\./.test(it.id) && !seen.has(it.id)) { seen.add(it.id); list.push(it); }
  if (!list.length) return "";
  return `<div><div class="pl-h">Needs a human<small>Click one to see why and fix it</small></div>${partListHtml(list, { kinds: run.kinds, unders: run.unders, title: (it) => itemTitle(run, it) })}</div>`;
}
function errorCard(run) {
  const lost = run.error.kind === "lost", connect = run.error.kind === "connect";
  return `<section class="card-msg error" aria-label="Problem">
    <h2>${lost ? `The connection to ${PRODUCT.name}'s server dropped.` : connect ? `${PRODUCT.name}'s server isn't answering.` : `${PRODUCT.name} couldn't finish wiring this screen.`}</h2>
    <p>${lost ? "Nothing was lost. Reconnect to pick up where it left off." : connect ? "Start it with npm run demo, then try again. Your design and contract are untouched." : "Your design and contract are untouched. Try again, or go back and pick another screen."}</p>
    <div class="row"><button class="btn primary" type="button" data-retry>${lost ? "Reconnect" : "Try again"}</button><button class="btn" type="button" data-back>Back to the start</button></div>
    ${run.error.detail ? `<details><summary>What the server said</summary><pre>${esc(run.error.detail)}</pre></details>` : ""}
  </section>`;
}
function fail(run, kind, err) {
  if (run.dead || run !== app.run) return;
  const after = app.afterRun; app.afterRun = null; after?.();
  run.error = { kind, detail: err?.message ?? "" };
  if (kind === "connect") app.online = false;
  paintSide(); paintProgress(); paintKeys();
}

function finish(run, d) {
  run.es?.close();
  run.done = d;
  const s = (run.final = stats(run) ?? run.stats);
  if (run.before) {
    const b = run.before, same = ["total", "fit", "gap", "tie", "stub"].every((k) => b[k] === s[k]);
    run.compare = { same, from: b, to: s };
  }
  app.last[run.sc.id] = s;
  paintIssues(run);
  paintTree(run); paintSide(); paintProgress(); paintKeys();
  refreshStatus();
  inspector.refreshEdited().then(() => { paintIssues(run); if (app.run === run) paintSide(); });
  const after = app.afterRun; app.afterRun = null; after?.();
  if (run.replay) setTimeout(() => { if (app.run === run && app.screen === "fit") toHandoffs(); }, (reduced() ? 400 : 1600) * tempo());
}

// answers from the Ask card
async function answer(v) {
  const run = app.run;
  if (!run?.question) return;
  $$("#sideBody button, #sideBody input").forEach((b) => (b.disabled = true));
  try { await post("/api/answer", { run: run.id, answer: v }); } catch { fail(run, "lost"); }
}
function skipRest() {
  const run = app.run;
  if (!run?.question) return;
  run.skipRest = true;
  paintSide(); paintProgress();
  answer({ skip: true });
}
// Suggest for a single Ask (R1.2): tries the part-level Suggest helper on just this question, and answers it
// automatically when the pick lands on one of the offered options. It never dead-ends the Ask: an abstain,
// an unreachable helper, or a mismatched label all leave it open with a plain-language note, same as before.
// Note: this submits through the normal answer() path, so a Suggest-picked-and-confirmed answer here is still
// recorded with source "you" in the Ledger and the Handoffs tally — /api/answer has no source override today
// (unlike /api/part-apply's `suggest` field for the inspector). See the ticket for why that's left as-is.
async function suggestAsk() {
  const run = app.run, q = run?.question;
  if (!q) return;
  run.askBusy = true; run.askMsg = null;
  paintSide();
  let j;
  try {
    const r = await post("/api/suggest", { example: scenario().example, id: q.id });
    j = await r.json().catch(() => ({}));
  } catch {
    if (app.run !== run || run.question !== q) return;
    run.askBusy = false;
    run.askMsg = "Couldn't reach Suggest. Try again, or answer it yourself.";
    paintSide();
    return;
  }
  if (app.run !== run || run.question !== q) return; // a newer question or run took over while this was in flight
  run.askBusy = false;
  if (!j?.ok) {
    run.askMsg = j?.reason || (j?.unreachable ? "Suggest isn't available right now." : "Suggest has no answer for this Ask.");
    paintSide();
    return;
  }
  const i = (q.options ?? []).findIndex((o) => o === j.label);
  if (i < 0) {
    run.askMsg = "Suggest's answer doesn't match one of this Ask's options.";
    paintSide();
    return;
  }
  run.askMsg = null;
  return answer(i);
}

// ---------- screen 3: the Handoffs ----------
function toHandoffs() {
  const run = app.run;
  if (!run?.done) return;
  const s = run.final, sc = run.sc, st = statusOf(sc.id);
  const c = run.compare;
  let cmp = "";
  if (c?.same) cmp = `<span class="delta">${icon("check", 16)}Same result as the last run</span>`;
  else if (c) cmp = `<span class="delta">${icon("replay", 16)}${c.from.needHuman} → ${c.to.needHuman} need a human</span>`;
  const answered = run.answers.filter((a) => a.source !== "skipped");
  const by = (k) => answered.filter((a) => a.source === k).length;
  const bits = [];
  if (by("you")) bits.push(`${by("you")} by you`);
  if (by("ai")) bits.push(`${by("ai")} by Suggest`);
  if (by("saved")) bits.push(`${by("saved")} from the Ledger`);
  const skipped = run.answers.length - answered.length;
  $("#handHead").innerHTML = `<div>
      <p class="eyebrow">Fit report · ${esc(sc.title)}</p>
      <h1 id="handTitle">${s.needHuman ? `<span class="num">${s.fit}</span> ${esc(headline(s).replace(/^\d+ /, ""))}` : `All <span class="num">${s.total}</span> parts fit`}</h1>
      <div class="hand-sub"><span>${plural(run.answers.length, "ask")}${run.answers.length ? `: ${[...bits, skipped ? `${skipped} skipped` : ""].filter(Boolean).join(", ")}` : ""}</span>${cmp}</div>
    </div>
    <div class="hand-actions"><button class="btn ghost" type="button" data-back-fit>${icon("arrow-left", 18)}Back to the fit</button><button class="btn primary lg" type="button" id="bReplay" data-replay title="Run again from scratch. The Ledger makes it the same result.">${icon("replay", 20)}Replay</button></div>`;
  const fix = sc.fix && (st?.fixable ?? true);
  const fixed = !!st?.fixed, closed = fixed && run.fixedAtStart;
  const band = fix
    ? `<div class="fixband ${fixed ? "done" : ""}" id="fixband"><p>${closed ? `<b>The fix closed it.</b> One Replay, and every Gap the contract fix covers is gone. Nothing needed asking again.` : fixed ? `<b>The contract is updated.</b> Press Replay: every Gap it closes goes at once, and nothing needs asking again.` : `<b>Try it: the Backend team ships the fix.</b> That adds the missing field and endpoints to the contract. Then Replay closes what it fixes, all at once.`}</p>${fixed ? "" : `<button class="btn" type="button" data-fix>${icon("handoff", 18)}Backend ships the fix</button>`}</div>`
    : "";
  $("#handGrid").innerHTML = TEAMS.map((key, i) => teamCard(run, key, i)).join("");
  $("#fixband")?.remove();
  if (band) $("#handGrid").insertAdjacentHTML("beforebegin", band);
  paintLedger(run);
  go("hand");
  if (fixed && !closed) $("#bReplay").classList.add("pulse");
}

function teamCard(run, key, i) {
  const t = run.teams?.find((x) => x.key === key), items = t?.items ?? [], mail = t?.email;
  const label = TEAM_LABEL[key];
  if (!items.length) return `<article class="team empty" style="--d:${i * 60}ms"><div class="team-head"><div><h2>${label}</h2><p>${esc(TEAM_SCOPE[key])}</p></div><span class="team-count zero">0</span></div>
    <ul class="things"><li><span class="fit">${icon("fit", 20)}</span><span>Nothing for ${label}. No email needed.</span></li></ul></article>`;
  const groups = groupItems(items), top = groups.slice(0, 3); // items with the same part and title (two buttons with one name) are listed once, with a count
  const rest = items.length - top.reduce((n, g) => n + g.count, 0);
  const editUrl = `/studio?example=${encodeURIComponent(run.sc.example)}&run=${encodeURIComponent(run.id)}&open=teams&mail=${key}`;
  return `<article class="team" style="--d:${i * 60}ms" data-team="${key}">
    <div class="team-head"><div><h2>${label}</h2><p>${esc(TEAM_SCOPE[key])}</p></div><span class="team-count">${items.length}</span></div>
    <ul class="things">${top.map(({ item: it, count }) => { const term = itemTermOf(run, it); const k = run.kinds?.[it.id]; return `<li><span class="${term}" title="${TERMS[term].word}">${icon(term, 20)}</span><span>${/^(value|list|action|form)\./.test(it.id) ? `<button type="button" class="thing-btn" data-open-part="${esc(it.id)}">${esc(itemTitle(run, it))}</button>` : esc(itemTitle(run, it))}${count > 1 ? `<span class="times" title="${count} parts on the page share this name">×${count}</span>` : ""}${k ? `<span class="thing-badges">${badgeHtml(k, { size: "s", under: run.unders?.[it.id] })}</span>` : ""}</span></li>`; }).join("")}${rest > 0 ? `<li class="more">and ${rest} more in the email</li>` : ""}</ul>
    <div class="subject"><small>Email subject</small><span>${esc(scrub(mail?.subject ?? ""))}</span></div>
    <div class="team-actions">
      <button class="btn sm" type="button" data-copy="${key}">${icon("copy", 16)}Copy</button>
      <button class="btn sm" type="button" data-mail="${key}">${icon("mail", 16)}Open in mail app</button>
      <a class="btn sm ghost" href="${editUrl}" target="_blank" rel="noopener" title="Opens the editor with this email. Editing works anywhere; rewriting needs the AI helper.">${icon("pencil", 16)}Edit and rewrite with AI</a>
    </div></article>`;
}
function emailText(run, key) {
  const m = run.teams?.find((x) => x.key === key)?.email;
  if (!m) return null;
  return { subject: m.subject, body: cleanEmail(m.body) };
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  const ta = document.createElement("textarea");
  ta.value = text; ta.style.cssText = "position:fixed;opacity:0"; document.body.append(ta); ta.select();
  let ok = false;
  try { ok = document.execCommand("copy"); } catch {}
  ta.remove();
  return ok;
}
async function copyMail(key) {
  const m = emailText(app.run, key);
  if (!m) return;
  toast((await copyText(`Subject: ${m.subject}\n\n${m.body}`)) ? "Copied. Paste it into your mail." : "Couldn't copy. Select the text in the editor instead.");
}
async function openMail(key) {
  const m = emailText(app.run, key);
  if (!m) return;
  const cut = m.body.length > 1800; // mailto links are cut by mail apps, so the full text also goes on the clipboard
  if (cut) await copyText(`Subject: ${m.subject}\n\n${m.body}`);
  location.href = `mailto:?subject=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(cut ? m.body.slice(0, 1800) + "\n…" : m.body)}`;
  if (cut) toast("The full email is on your clipboard too.");
}

function paintLedger(run) {
  const rows = run.answers.filter((a) => a.source !== "skipped"); // a skipped Ask is not recorded: it is asked again next time
  const skipped = run.answers.length - rows.length;
  const box = $("#ledger");
  const note = rows.length
    ? `${rows.length} decision${rows.length === 1 ? "" : "s"} recorded, each with who made it. This is why a Replay gives the same result.`
    : "Nothing recorded this run.";
  box.innerHTML = `<summary>${icon("ledger", 18)}Ledger<small>${note}${skipped ? ` ${skipped} skipped: not recorded, asked again next time.` : ""}</small></summary>` +
    (rows.length
      ? `<table><thead><tr><th>Part</th><th>Decision</th><th>Made by</th></tr></thead><tbody>${rows.map((a) => `<tr><td>${esc(a.id === "list.sort" ? "Row order" : humanize(a.id.split(".").pop()))}</td><td>${esc(scrub(plainOption(a.answer)))}</td><td><span class="by ${esc(byLabel(a.source))}">${esc(byLabel(a.source))}</span></td></tr>`).join("")}</tbody></table>`
      : `<div class="ledger-empty">${skipped ? "Every Ask was skipped, so nothing is recorded yet." : "Every part was settled by rules, so there was nothing to decide."}</div>`);
}

async function applyFix() {
  const sc = scenario();
  try {
    const r = await post("/api/demo/apply-fix", { example: sc.example });
    if (!r.ok) throw new Error();
  } catch { toast("Couldn't apply the fix. Is the server still running?"); return; }
  delete app.contracts[sc.example];
  await refreshStatus();
  toast("Contract updated. Press Replay.");
  toHandoffs();
}
function replay() {
  if (app.run?.done) startRun({ replay: true });
}
// "Wire it": the hero's pulse plays on the button press, so the Drop in screen stays for WIRE_DELAY_MS before the fit screen
// takes over (no wait with reduced motion, or from the Space shortcut, which never plays the pulse).
async function wire({ shortcut = false } = {}) {
  if (app.wiring) return;
  const ms = wireDelay({ reduced: reduced(), shortcut });
  if (ms) {
    app.wiring = true;
    const b = $("#bWire"); b.classList.add("wiring"); b.setAttribute("aria-busy", "true");
    await sleep(ms);
    b.classList.remove("wiring"); b.removeAttribute("aria-busy");
    app.wiring = false;
    if (app.screen !== "drop") return; // the person went elsewhere while the pulse played
  }
  startRun();
}

// ---------- events ----------
document.addEventListener("change", (e) => {
  if (e.target.id !== "contractFile") return;
  uploadContract(e.target.files[0]);
  e.target.value = "";
});
document.addEventListener("dragover", (e) => { if (e.target.closest?.("#contract") && e.dataTransfer?.types?.includes("Files")) e.preventDefault(); });
document.addEventListener("drop", (e) => {
  if (!e.target.closest?.("#contract") || !e.dataTransfer?.files?.length) return;
  e.preventDefault();
  uploadContract(e.dataTransfer.files[0]);
});
document.addEventListener("click", (e) => {
  const t = e.target.closest("button, a, summary, [data-answer]");
  if (!t) return;
  if (t.matches(".scen-card")) return pick(t.dataset.id);
  if (t.id === "bWire") return wire();
  if (t.id === "bUpload") return $("#contractFile").click();
  if (t.id === "bPresent") return setPresent(!app.present);
  if (t.id === "bTheme") return toggleTheme();
  if (t.id === "bReset") return askReset();
  if (t.id === "bResetNo") return paintReset();
  if (t.id === "bResetYes") return doReset();
  if (t.id === "brand") { e.preventDefault(); return toDrop(); }
  if (t.dataset.answer != null) return answer(Number(t.dataset.answer));
  if (t.hasAttribute("data-skip")) return answer({ skip: true });
  if (t.hasAttribute("data-skiprest")) return skipRest();
  if (t.hasAttribute("data-suggest-ask")) return suggestAsk();
  if (t.dataset.submit === "text") return answer($("#askText").value);
  if (t.dataset.submit === "multi") { const picked = $$("[data-multi]:checked").map((c) => Number(c.dataset.multi)); if (picked.length) answer(picked); else toast("Pick at least one field."); return; }
  if (t.dataset.submit === "joint") {
    const from = $('input[name="jointFrom"]:checked')?.value;
    const inputs = $$("[data-jointfield]:checked").map((c) => c.dataset.jointfield);
    const fn = $("#jointFn")?.value ?? "";
    return answer({ from, inputs, fn });
  }
  if (t.hasAttribute("data-next")) return toHandoffs();
  if (t.hasAttribute("data-retry")) return app.run?.error?.kind === "lost" && app.run.id ? reconnect() : startRun();
  if (t.hasAttribute("data-back")) return toDrop();
  if (t.hasAttribute("data-back-fit")) return go("fit");
  if (t.hasAttribute("data-replay")) return replay();
  if (t.hasAttribute("data-fix")) return applyFix();
  if (t.dataset.copy) return copyMail(t.dataset.copy);
  if (t.dataset.mail) return openMail(t.dataset.mail);
});
function reconnect() {
  const run = app.run;
  Object.assign(run, { error: null, queue: [], steps: {}, trees: 0, stage: "idle", tree: null, stats: null, prev: {}, items: {}, question: null, answers: [], teams: null, done: null, askBusy: false, askMsg: null });
  paintHero(); paintSide(); paintProgress();
  attach(run); // the server keeps every event of a run and replays them from the start
}
function toDrop() {
  abandon();
  go("drop");
}
$("#suggestOn").addEventListener("change", (e) => { app.suggest = e.target.checked; paintWire(); });
$("#scen").addEventListener("keydown", (e) => {
  const i = SCENARIOS.findIndex((s) => s.id === app.scenarioId);
  const d = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
  if (d == null) return;
  e.preventDefault();
  pick(SCENARIOS[(i + d + SCENARIOS.length) % SCENARIOS.length].id);
  $("#scen .scen-card[aria-checked='true']")?.focus();
});
document.addEventListener("keydown", (e) => {
  if (inspector.isOpen()) return; // the inspector has its own keys (arrows and numbers choose, Enter applies, Esc closes)
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const el = e.target, typing = el.matches?.("input[type=text], input:not([type]), textarea, select");
  if (e.key === "Escape") {
    if ($("#resetBox .confirm")) return paintReset();
    if (app.screen === "fit") return trace.view === "map" ? trace.setView("page") : toDrop();
    if (app.screen === "hand") return go("fit");
    return;
  }
  if (e.key === "Enter" && typing && el.id === "askText") return answer(el.value);
  if (typing) return;
  const interactive = el.closest?.("button, a, summary, input, [role=radio]");
  const primary = e.key === " " || e.key === "Enter";
  if (primary && interactive) return; // the focused control handles it natively
  if (app.screen === "drop") {
    if (primary) { e.preventDefault(); return $("#bWire").disabled ? null : wire({ shortcut: true }); }
    const n = Number(e.key);
    if (n >= 1 && n <= SCENARIOS.length) return pick(SCENARIOS[n - 1].id);
  } else if (app.screen === "fit") {
    const run = app.run;
    if (e.key === "t" || e.key === "T") return trace.replay();
    if (e.key === "m" || e.key === "M") return trace.toggleView();
    if (run?.question && !run.skipRest) {
      if (e.key === "S") { e.preventDefault(); return skipRest(); }
      if (e.key === "s") { e.preventDefault(); return answer({ skip: true }); }
      const b = $$("#sideBody [data-answer]")[Number(e.key) - 1];
      if (b && !b.disabled) return b.click();
    } else if (primary && run?.done) { e.preventDefault(); return toHandoffs(); }
  } else if (app.screen === "hand") {
    if (e.key === "r" || e.key === "R" || primary) { e.preventDefault(); return replay(); }
  }
});

// ---------- start ----------
async function init() {
  $("#bDetails").innerHTML = `${icon("external", 16)}<span>Details</span>`;
  $("#bTrace").innerHTML = `${icon("replay", 16)}<span>Replay the trace</span>`;
  paintTheme(); paintReset(); paintKeys(); paintHow();
  setPresent(new URLSearchParams(location.search).get("present") === "1" || store.get("trace-present") === "1");
  document.title = PRODUCT.name;
  try {
    app.examples = await (await fetch("/api/examples")).json();
    app.online = true;
    notice(null);
  } catch {
    app.online = false;
    notice("error", `${PRODUCT.name} can't reach its server. Start it with npm run demo, then try again.`, "Try again");
  }
  await refreshStatus();
  if (app.online) post("/api/demo/release").catch(() => {}); // a run this page's predecessor left waiting on an Ask
  paintScenarios(); paintWire();
  if (app.online) { loadContract(); paintThumb(); }
  else $("#contract").innerHTML = `<div class="contract-msg">The contract shows here once the server is running.</div>`;
  go(app.screen);
}
addEventListener("pagehide", () => { abandon(); navigator.sendBeacon?.("/api/demo/release"); }); // never leave a run waiting on an Ask nobody sees
matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", paintTheme);
init();
