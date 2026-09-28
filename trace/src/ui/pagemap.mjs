// The Page map's review page (plain JS, no framework, no build step). One shared handler dispatches every click, change
// and key by event delegation: buttons carry `data-act`, nodes carry `data-id` (tree rows, review rows) or `data-pm-id`
// (boxes in the wireframe iframe), so there is no per-node listener anywhere. Every mutation is a POST to /api/pagemap/*
// that answers with the whole new map; the page never keeps state the server has not confirmed (except the view: filters,
// open branches, selected node, tab).
import { ISSUES, FORMS, badgeHtml } from "/inspector/issues.mjs";
import { mountBuildBadge } from "/ui/build-badge.mjs";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const CLS = { dynamic: "Dynamic value", static: "Static copy", list: "List row template", action: "Action", input: "Input", visual: "Visual", unsure: "Unsure", structure: "Structure" };
const ORDER = ["dynamic", "static", "list", "action", "input", "visual", "unsure", "structure"];
const MARK = ["dynamic", "static", "list", "action", "input", "visual"];
const ACTIONABLE = new Set(["dynamic", "list", "action", "input"]);
const STATUS_WORD = { accepted: "accepted", rejected: "rejected", changed: "changed", added: "added", proposed: "proposed", none: "" };

const RES_WORD = { api: "API endpoint", controller: "controller function", stub: "marked stub", unresolved: "unresolved" };
const S = { data: null, sel: null, selRaw: null, closed: new Set(), groupsOpen: new Set(), ltab: "structure", mtab: "wire", filter: { cls: "all", strength: "all", review: false, unsure: false, icons: false, q: "" }, ref: null, byId: new Map(), groupById: new Map(), lineStarts: [], wireFor: null, busy: false };

// ---------- helpers on the loaded map ----------
const N = (id) => S.byId.get(id);
const P = (id) => S.data.proposals[id];
const E = (id) => S.data.effective[id];
const rootOf = (id) => { let c = id, i = 0; while (S.data.follow[c] && i++ < 50) c = S.data.follow[c]; return c; };
const lineOf = (offset) => { let lo = 0, hi = S.lineStarts.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (S.lineStarts[m] <= offset) lo = m; else hi = m - 1; } return lo + 1; };
const clip = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + "…" : String(s));
const isContent = (n) => E(n.id).cls !== "structure";

function label(n) {
  if (n.kind === "text") return n.textKind === "attribute" ? `<span class="tg">@${esc(n.attr)}</span> <span class="tx">${esc(clip(n.text, 60))}</span>` : `<span class="tx">${n.textKind === "expression" ? "{" : "&ldquo;"}${esc(clip(n.text, 60))}${n.textKind === "expression" ? "}" : "&rdquo;"}</span>`;
  const d = n.details ?? {};
  const extra = n.kind === "interaction" ? d.label : n.kind === "input" ? (d.label ?? d.placeholder ?? d.name) : n.kind === "table" ? (d.rowCount ? `${d.rowCount} rows` : "") : n.kind === "list" ? "list" : n.kind === "media" || n.kind === "visual" ? (d.alt ?? "") : "";
  return `<span class="tg">&lt;${esc(n.tag)}&gt;</span>${extra ? ` <span class="tx">${esc(clip(extra, 40))}</span>` : ""}`;
}

// ---------- network ----------
async function api(path, body) {
  const r = await fetch(path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : undefined);
  const j = await r.json().catch(() => ({ error: `The server answered ${r.status} without JSON.` }));
  if (!r.ok) throw Object.assign(new Error(j.error ?? `HTTP ${r.status}`), { status: r.status, body: j });
  return j;
}
const say = (text, kind = "") => { const m = $("#msg"); m.textContent = text ?? ""; m.className = `pm-msg ${kind}`; };
async function mutate(path, body, done) {
  if (S.busy) return;
  S.busy = true;
  try { const r = await api(path, { ...S.ref, ...body }); const map = r.map ?? r; setData(map); say(done?.(r) ?? "", "ok"); return r; } catch (e) { say(e.message, "err"); } finally { S.busy = false; }
}

// ---------- load ----------
async function boot() {
  const q = new URLSearchParams(location.search);
  const pages = await api("/api/pagemap/pages");
  const sel = $("#picker");
  sel.innerHTML = `<optgroup label="Examples">${pages.examples.map((e) => `<option value="example=${esc(e)}">${esc(e)}</option>`).join("")}</optgroup>` +
    (pages.files.length ? `<optgroup label="Real Subframe pages">${pages.files.map((f) => `<option value="file=${esc(f.file)}">${esc(f.file)}</option>`).join("")}</optgroup>` : "");
  S.ref = q.get("file") ? { file: q.get("file") } : { example: q.get("example") ?? pages.examples.find((e) => e === "portfolio-figma-1") ?? pages.examples[0] };
  sel.value = S.ref.file ? `file=${S.ref.file}` : `example=${S.ref.example}`;
  const cls = $("#fClass");
  cls.innerHTML = `<option value="all">all</option>` + ORDER.filter((k) => k !== "structure").map((k) => `<option value="${k}">${CLS[k]}</option>`).join("");
  try { setData(await api(`/api/pagemap?${new URLSearchParams(S.ref)}`)); } catch (e) { say(e.message, "err"); $("#covText").textContent = e.message; }
}

function setData(d) {
  const first = !S.data || S.data.page.name !== d.page.name;
  S.data = d;
  S.byId = new Map(d.nodes.map((n) => [n.id, n]));
  S.groupById = new Map(d.groups.map((g) => [g.id, g]));
  if (first) {
    S.lineStarts = [0];
    for (let i = 0; i < d.source.length; i++) if (d.source[i] === "\n") S.lineStarts.push(i + 1);
    S.sel = S.selRaw = null; S.closed = new Set(); S.groupsOpen = new Set(); S.wireFor = null;
    document.title = `Page map - ${d.page.name} - Trace`;
    renderSource();
    $("#orig").src = d.page.mode === "example" ? `/api/preview?example=${encodeURIComponent(d.page.example)}` : "about:blank";
    $("#tabOrig").hidden = d.page.mode !== "example";
  }
  if (S.sel && !S.byId.has(S.sel)) S.sel = S.selRaw = null;
  paint();
}

function paint() {
  renderSummary();
  renderLeft();
  renderPanel();
  paintWire();
  paintSourceSel();
  $("#bUndo").disabled = !S.data.history.undo;
  $("#bRedo").disabled = !S.data.history.redo;
  $("#bUndo").title = S.data.history.undo ? "Undo the newest change" : "Nothing to undo";
  $("#bRedo").title = S.data.history.redo ? "Redo the change you undid" : "Nothing to redo";
}

// ---------- summary ----------
function renderSummary() {
  const c = S.data.coverage, s = S.data.summary;
  const w = $("#warn");
  w.hidden = !S.data.warnings.length;
  w.innerHTML = S.data.warnings.length ? `<b>${S.data.warnings.length} warning${S.data.warnings.length === 1 ? "" : "s"}:</b> ${S.data.warnings.map(esc).join(" &middot; ")}` : "";
  $("#covBar").innerHTML = ORDER.filter((k) => c[k]).map((k) => `<i style="width:${(c[k] / c.total) * 100}%;background:var(--c-${k})" title="${esc(CLS[k])}: ${c[k]}"></i>`).join("");
  $("#covBar").setAttribute("aria-label", c.sentence);
  const chip = (k) => `<button class="pm-chip cls-${k}" data-act="filter-cls" data-cls="${k}" type="button" aria-pressed="${S.filter.cls === k}" title="Show only ${esc(CLS[k])}">${esc(CLS[k])} ${c[k]}</button>`;
  $("#covText").innerHTML = `<b>${c.total} nodes:</b> ${ORDER.filter((k) => k !== "structure").map(chip).join(" ")} <span class="pm-chip cls-structure">${CLS.structure} ${c.structure}</span> <b>${c.accountedFor}% accounted for</b>` +
    ` &middot; <span title="Repeated rows and cards are collapsed in the structure">${S.data.stats.visible} of ${S.data.stats.total} nodes shown; ${S.data.stats.groups} repeated group${S.data.stats.groups === 1 ? "" : "s"} collapsed, ${S.data.stats.components} repeated component${S.data.stats.components === 1 ? "" : "s"} marked</span>`;
  const m = S.data.marked;
  $("#props").innerHTML =
    (s.proposed ? `<span><b>${s.proposed}</b> proposed edits:</span> <button class="pm-btn pri" data-act="accept-strong" type="button" ${s.strong ? "" : "disabled"}>Accept all strong (${s.strong})</button> <button class="pm-btn" data-act="review-weak" type="button">Review weak (${s.weak})</button>`
      : `<span class="pm-note">No proposed edit is waiting. ${s.decided} decided.</span>`) +
    ` <button class="pm-btn" data-act="apply" type="button" ${s.decided ? "" : "disabled"} title="Writes ${esc(S.data.files.marked)} next to the page; the page itself is never changed here">Apply to a marked copy</button>` +
    (m.exists ? `<span class="pm-note">${esc(m.name)} ${m.upToDate ? "is up to date" : "is out of date"}</span>` : "") +
    ` <span class="pm-note" title="Suggested by Trace, confirmed by you, stored in ${esc(S.data.files.sidecar)} as violations">${s.violations.total} tracked violations (${s.violations.open} open, ${s.violations.byStatus.confirmed ?? 0} confirmed, ${s.violations.byStatus.dismissed ?? 0} dismissed)</span>` +
    (s.orphans.length ? `<span class="pm-note" style="color:var(--amb)" title="Node ids are positional: an edit to the page moved them. See States &amp; flows to re-attach or drop them.">${s.orphans.length} orphaned decision${s.orphans.length === 1 ? "" : "s"}</span>` : "");
  $("#reviewCount").textContent = String(s.proposed);
  $("#flowCount").textContent = String(S.data.summary.orphans.length + S.data.states.filter((x) => x.status === "proposed").length + S.data.interactions.filter((i) => i.resolution !== "api" && i.resolution !== "controller").length);
}

// ---------- left pane ----------
const matches = (n) => {
  const f = S.filter, e = E(n.id), p = P(n.id);
  if (n.details?.subtype === "icon" && !f.icons && f.cls !== "visual") return false; // icons are decorative noise unless asked for
  if (f.cls !== "all" && e.cls !== f.cls) return false;
  if (f.strength !== "all" && (p.strength !== f.strength || e.cls === "structure")) return false;
  if (f.unsure && e.cls !== "unsure") return false;
  if (f.review && !(e.status === "proposed" && !p.delegate && ACTIONABLE.has(p.cls === "unsure" ? p.lean : p.cls))) return false;
  if (f.q) { const q = f.q.toLowerCase(); if (!`${n.text ?? ""} ${n.tag} ${n.id} ${n.attr ?? ""}`.toLowerCase().includes(q)) return false; }
  return true;
};
const filterOn = () => S.filter.cls !== "all" || S.filter.strength !== "all" || S.filter.review || S.filter.unsure || !!S.filter.q;

function keepSet() {
  // nodes to show: content nodes (or, with a filter, matches) and the ancestors that lead to them; layout-only leaves stay hidden
  const keep = new Set();
  const on = filterOn();
  const go = (id) => {
    const n = N(id);
    let any = false;
    for (const c of n.children ?? []) if (go(c)) any = true;
    const self = on ? matches(n) : isContent(n) && (S.filter.icons || n.details?.subtype !== "icon");
    if (self || any) { keep.add(id); return true; }
    return false;
  };
  for (const e of S.data.rootChildren) go(e.id ?? S.groupById.get(e.g).template);
  // members of groups are reachable through their template; make sure the group's other members are kept when open
  for (const g of S.data.groups) if (keep.has(g.template)) for (const m of g.members) go(m);
  return keep;
}

function rows(keep) {
  const out = [];
  const on = filterOn();
  const visitEntry = (e, depth) => {
    if (e.g) {
      const g = S.groupById.get(e.g);
      const ids = S.groupsOpen.has(g.id) ? g.members : [g.template];
      ids.forEach((id, i) => visit(id, depth, { g, inst: i }));
    } else visit(e.id, depth, null);
  };
  const visit = (id, depth, grp) => {
    if (!keep.has(id)) return;
    const n = N(id);
    const kids = n.kind === "text" ? [] : S.data.cv[id].filter((e) => keep.has(e.id ?? S.groupById.get(e.g).template));
    if (!on && !grp && E(id).cls === "structure" && kids.length === 1 && S.sel !== id) { visitEntry(kids[0], depth); return; } // path compression: a layout box with one child
    const open = on || !S.closed.has(id);
    out.push({ id, depth, kids: kids.length, open, grp });
    if (open) kids.forEach((e) => visitEntry(e, depth + 1));
  };
  S.data.rootChildren.forEach((e) => visitEntry(e, 0));
  return out;
}

function renderLeft() {
  const t = S.ltab === "structure";
  for (const [id, tab] of [["#tabStructure", "structure"], ["#tabReview", "review"], ["#tabFlow", "flow"]]) $(id).setAttribute("aria-selected", S.ltab === tab);
  $("#tree").hidden = !t;
  $("#review").hidden = S.ltab !== "review";
  $("#flow").hidden = S.ltab !== "flow";
  $("#filters").hidden = !t;
  $("#fClass").value = S.filter.cls;
  $("#fStrength").value = S.filter.strength;
  if (t) renderTree(); else if (S.ltab === "review") renderReview(); else renderFlow();
}

function renderTree() {
  const keep = keepSet();
  const list = rows(keep);
  const html = list.map((r) => {
    const n = N(r.id), e = E(r.id), p = P(r.id);
    const g = r.grp?.g;
    const badge = g && r.grp.inst === 0 ? (g.mapped ? `<button class="pm-rp" data-act="group" data-g="${g.id}" type="button" title="Rendered by .map(): one instance in the source">mapped</button>` : `<button class="pm-rp" data-act="group" data-g="${g.id}" type="button" aria-expanded="${S.groupsOpen.has(g.id)}" title="${S.groupsOpen.has(g.id) ? "Show only the template" : `Show all ${g.count} instances`}">&times;${g.count}</button>`) : g ? `<span class="pm-st">instance ${r.grp.inst + 1}</span>` : "";
    const comp = S.data.components.find((c) => c.ids[0] === r.id || c.ids.includes(r.id));
    const cbadge = comp ? `<span class="pm-rp" title="Repeated component: ${comp.count} places; varies: ${esc(comp.varying.map((v) => v.examples.join(" / ")).join("; ").slice(0, 140))}">&#8635;${comp.count}</span>` : "";
    const st = e.status === "proposed" && !ACTIONABLE.has(p.cls === "unsure" ? p.lean : p.cls) && p.cls !== "unsure" ? "" : STATUS_WORD[e.status]; // static copy waits for nobody
    return `<div class="pm-row ${e.cls === "structure" ? "structure" : ""} ${g && r.grp.inst > 0 ? "pm-inst" : ""} ${S.selRaw === r.id || (S.sel === r.id && !g) ? "sel" : ""}" role="treeitem" aria-level="${r.depth + 1}" ${r.kids ? `aria-expanded="${r.open}"` : ""} aria-selected="${S.sel === r.id}" tabindex="-1" data-act="select" data-id="${r.id}" style="padding-left:${6 + r.depth * 14}px">` +
      `<span class="pm-tw" ${r.kids ? `data-act="toggle" data-id="${r.id}"` : ""}>${r.kids ? (r.open ? "&#9662;" : "&#9656;") : ""}</span>` +
      `<span class="pm-dot cls-${e.cls} ${e.strength === "weak" ? "weak" : ""}" title="${esc(CLS[e.cls])}${e.cls === "structure" ? "" : ` (${e.strength})`}"></span>` +
      `<span class="pm-lbl">${label(n)}</span>${badge}${cbadge}${st ? `<span class="pm-st ${e.status}">${st}</span>` : ""}</div>`;
  }).join("");
  $("#tree").innerHTML = html || `<p class="pm-empty">Nothing matches these filters.</p>`;
  const first = $("#tree").querySelector(".pm-row");
  if (first) (( $("#tree").querySelector(".pm-row.sel") ?? first)).tabIndex = 0;
}

function renderReview() {
  const items = pendingRoots();
  const issueRoots = S.data.nodes.filter((n) => !S.data.follow[n.id] && S.data.issues[n.id] && !S.data.decisions[n.id] && !items.some((r) => r.id === n.id));
  const row = (n) => {
    const p = P(n.id), e = E(n.id), d = S.data.diffs[n.id];
    const cls = p.cls === "unsure" ? p.lean : p.cls;
    return `<div class="pm-rv ${S.sel === n.id ? "sel" : ""}" data-act="select" data-id="${n.id}"><div class="top"><span class="pm-chip cls-${cls} ${p.strength === "weak" ? "weak" : ""}">${esc(CLS[p.cls])} &middot; ${p.strength}</span><span class="tx">${label(n).replace(/<[^>]+>/g, "")}</span></div>` +
      `<div class="why">${esc(p.reasons[0] ?? "")}${p.risk ? ` <span style="color:var(--amb)">May be wrong: ${esc(p.risk)}</span>` : ""}${d ? ` <span>(+${d.added} -${d.removed} lines)</span>` : ""}</div>` +
      `<div class="btns"><button class="pm-btn sm pri" data-act="accept" data-id="${n.id}" type="button">Accept</button><button class="pm-btn sm" data-act="reject" data-id="${n.id}" type="button">Reject</button></div></div>`;
  };
  $("#review").innerHTML = (items.length ? `<h3 class="pm-h">Proposed edits (${items.length})</h3>${items.map(row).join("")}` : `<p class="pm-empty">No proposed edit is waiting.</p>`) +
    (issueRoots.length ? `<h3 class="pm-h" style="margin-top:14px">Unsure or unclassified, nothing to write yet (${issueRoots.length})</h3>${issueRoots.slice(0, 80).map(row).join("")}${issueRoots.length > 80 ? `<p class="pm-empty">and ${issueRoots.length - 80} more; use the filters in the structure.</p>` : ""}` : "");
}

// States and flows: the requirement items (Product / Design), how every interaction resolves, the charts' data mapping, and the tracked violations.
function renderFlow() {
  const d = S.data;
  const stateRow = (s) => {
    const t = N(s.target);
    return `<div class="pm-st2 ${S.sel === s.target ? "sel" : ""}" data-act="select" data-id="${s.target}"><div class="top"><span class="pm-chip cls-unsure">${esc(s.stateKind)}</span><span class="pm-team ${s.team}">${s.team}</span><span class="tx" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${label(t)}</span><span class="pm-st ${s.status === "accepted" ? "accepted" : s.status === "dismissed" ? "rejected" : ""}">${s.status === "proposed" ? "line " + s.line : s.status}</span></div>` +
      `<div class="why">${s.source === "conditional" ? "Shown only when" : s.source === "prop" ? `Set by <b>${esc(s.prop)}</b>:` : s.source === "text" ? "Wording:" : "Found as"} <code>${esc(clip(s.condition, 70))}</code>${s.branch === "else" ? " (else branch)" : ""}</div>` +
      `<div class="why" style="color:var(--fg)">Proposed requirement: ${esc(s.requirement)}</div>` +
      `<div class="btns" style="display:flex;gap:6px"><button class="pm-btn sm pri" data-act="accept" data-id="${s.id}" type="button" ${s.status === "accepted" ? "disabled" : ""}>Keep as a requirement</button><button class="pm-btn sm" data-act="reject" data-id="${s.id}" type="button" ${s.status === "dismissed" ? "disabled" : ""}>Dismiss</button>${s.status !== "proposed" ? `<button class="pm-btn sm" data-act="clear" data-id="${s.id}" type="button">Clear</button>` : ""}</div></div>`;
  };
  const inter = d.interactions.map((i) => `<div class="pm-st2 ${S.sel === i.id ? "sel" : ""}" data-act="select" data-id="${i.id}"><div class="top"><span class="pm-res ${i.resolution}">${esc(RES_WORD[i.resolution])}</span><span class="tx" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><b>${esc(clip(i.label, 40))}</b> &middot; action <code>${esc(i.verb)}</code></span><span class="pm-st">line ${i.line}</span></div><div class="why">${esc(i.detail)}${i.handler !== "none" ? ` (handler: ${i.handler})` : ""}</div></div>`).join("");
  const maps = Object.entries(d.mappings).filter(([id]) => !d.follow[id]).map(([id, m]) => `<div class="pm-st2 ${S.sel === id ? "sel" : ""}" data-act="select" data-id="${id}"><div class="top"><span class="pm-chip cls-visual">${esc(N(id).details.media)}</span><span class="pm-team Design">Design</span><span class="pm-st">line ${N(id).line}</span></div><div class="why">${m.labels.length ? m.labels.map((l) => `&ldquo;${esc(clip(l.label, 30))}&rdquo; &rarr; ${l.items.length ? l.items.map((x) => `<code>${esc(x)}</code>`).join(", ") : "no data item found"}`).join("<br>") : "No label text: nothing says which data it draws."}</div></div>`).join("");
  const counts = (k) => d.interactions.filter((i) => i.resolution === k).length;
  const v = d.violations;
  $("#flow").innerHTML =
    (d.summary.orphans.length ? `<h3 class="pm-h" >Orphaned decisions (${d.summary.orphans.length})</h3><p class="pm-slot" style="margin:0 2px 6px">Node ids are positional, so an edit to the page (even whitespace) moves them and leaves these decisions with nothing to attach to. To re-attach one, select the node that is there now and decide again; then drop the old one.</p>${d.summary.orphans.map((o) => `<div class="pm-st2"><div class="top"><span class="pm-chip cls-unsure">${esc(o.act)}</span><span class="tx" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${o.anchor ? `line ${o.anchor.line}: ${esc(clip(o.anchor.text ?? o.anchor.path ?? "", 40))}` : esc(o.id)}</span><button class="pm-btn sm" data-act="clear" data-id="${o.id}" type="button">Drop</button></div><div class="why">${esc(o.reason)}</div></div>`).join("")}` : "") +
    `<h3 class="pm-h">Requirement items: states and conditionals (${d.states.length})</h3>${d.states.length ? d.states.map(stateRow).join("") : `<p class="pm-empty">No conditional rendering, state prop or loading/empty/error wording was found in this page.</p>`}` +
    `<h3 class="pm-h" style="margin-top:14px">Interactions and where they resolve (${d.interactions.length}) &middot; ${d.summary.interactionCoverage.rate}% covered</h3><p class="pm-slot" style="margin:0 2px 6px">${counts("api")} API endpoint, ${counts("controller")} controller function, ${counts("stub")} marked stub, ${counts("unresolved")} unresolved. A stub is a function with an unused input or nothing returned. Coverage counts everything with a home (endpoint, controller or marked stub) against unresolved; ${d.summary.interactionCoverage.rateStrict}% resolve straight to an endpoint or controller.</p>${inter || `<p class="pm-empty">No interactions.</p>`}` +
    (maps ? `<h3 class="pm-h" style="margin-top:14px">Charts and graphics: labels to data items</h3>${maps}` : "") +
    `<details class="pm-more"><summary>Tracked violations (${v.length}): ${d.summary.violations.open} open</summary>${v.map((x) => `<div class="pm-vl"><span class="sev-${x.severity}">${x.severity}</span> <code>${esc(x.rule)}</code> line ${x.line} <i>${esc(x.status)}</i><br>${esc(x.message)}</div>`).join("")}</details>`;
}

function pendingRoots() {
  return S.data.nodes.filter((n) => !S.data.follow[n.id] && !S.data.decisions[n.id] && !P(n.id).existing && !P(n.id).delegate && S.data.diffs[n.id] && ACTIONABLE.has(P(n.id).cls === "unsure" ? P(n.id).lean : P(n.id).cls))
    .sort((a, b) => (P(a.id).strength === "strong" ? 0 : 1) - (P(b.id).strength === "strong" ? 0 : 1) || a.start - b.start);
}

// ---------- node panel ----------
function diffHtml(d) {
  return `<div class="pm-diff" tabindex="0" aria-label="Proposed change to the source">${d.hunks.map((h) => `<div class="h">${esc(h.header)}</div>` + h.lines.map((l) => `<div class="d ${l.t === "+" ? "add" : l.t === "-" ? "del" : ""}">${esc(l.t)} ${esc(l.text)}</div>`).join("")).join("")}</div>`;
}

function renderPanel() {
  const el = $("#panel");
  if (!S.sel) { el.innerHTML = `<p class="pm-empty">Select a node in the structure or the wireframe. Every node has one proposal; you accept it, reject it, or mark the node as something else.</p>`; return; }
  const n = N(S.sel), p = P(n.id), e = E(n.id), d = S.data.diffs[n.id];
  const inst = S.selRaw && S.selRaw !== S.sel;
  const grp = S.data.groups.find((g) => g.template === n.id || g.members.includes(n.id));
  const iss = S.data.issues[n.id];
  const decided = S.data.decisions[n.id];
  const wants = e.cls;
  const chips = MARK.map((k) => `<button class="pm-chip cls-${k}" data-act="mark" data-id="${n.id}" data-cls="${k}" type="button" aria-pressed="${wants === k}">${esc(CLS[k])}</button>`).join("");
  const kv = (o) => Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && !v.length)).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(Array.isArray(v) ? v.join(", ") : typeof v === "object" ? JSON.stringify(v) : String(v))}</dd>`).join("");
  const det = n.details ?? {};
  const detail = n.kind === "text" ? { kind: n.textKind, ...(n.a11y ? { accessibility: n.attr } : {}) } : n.kind === "interaction" ? { tag: det.tag, label: det.label, handlers: det.handlers, verb: det.verb } : n.kind === "input" ? { tag: det.tag, type: det.inputType, name: det.name, label: det.label, placeholder: det.placeholder, options: det.options, required: det.required || "", disabled: det.disabled || "", default: det.defaultValue } : n.kind === "table" || n.kind === "list" ? { rows: det.rowCount, columns: (det.columns ?? []).map((c) => c.header || `#${c.index + 1}`), "template row": det.templateRow } : n.kind === "media" || n.kind === "visual" ? { element: det.media, kind: det.subtype, alt: det.alt } : { tag: n.tag };
  const slots = grp && grp.slots.length ? `<h3>Repeated x${grp.count ?? "n"}: what varies</h3><ul class="pm-slot">${grp.slots.slice(0, 8).map((s) => `<li><code>${esc(s.path || "(row)")}${s.prop ? ` [${esc(s.prop)}]` : ""}</code>: ${s.examples.map((x) => `&ldquo;${esc(clip(x, 40))}&rdquo;`).join(", ")}</li>`).join("")}</ul>` : grp ? `<h3>Repeated x${grp.count ?? "n"}</h3><p class="sub">${grp.mapped ? "Rendered by .map(): one instance in the source." : "Identical in every instance."}</p>` : "";
  const comp = S.data.components.find((c) => c.ids.includes(n.id));
  const fix = iss ? (() => { const k = ISSUES[iss]; return `<div class="pm-fix"><h3 style="margin-top:0">Fix</h3><p>${badgeHtml(iss, { size: "m" })}</p><p class="sub">${esc(k.explain)}</p><p><b>${esc(FORMS[k.form]?.title ?? "")}</b></p><div class="pm-actions"><button class="pm-btn sm" data-act="mark" data-id="${n.id}" data-cls="dynamic" type="button">It is data from the API</button><button class="pm-btn sm" data-act="mark" data-id="${n.id}" data-cls="static" type="button">It is fixed wording</button></div></div>`; })() : "";
  const nst = S.data.states.filter((s) => s.target === n.id);
  const itn = S.data.interactions.find((i) => i.id === n.id);
  const mp = S.data.mappings[n.id];
  const extra =
    (nst.length ? `<h3>States and conditionals</h3><ul>${nst.map((s) => `<li><b>${esc(s.stateKind)}</b> (${s.team}): <code>${esc(clip(s.condition, 60))}</code> <span class="sub">${esc(s.status)}</span></li>`).join("")}</ul>` : "") +
    (itn ? `<h3>Resolves to</h3><p class="sub"><span class="pm-res ${itn.resolution}">${esc(RES_WORD[itn.resolution])}</span> ${esc(itn.detail)}</p>` : "") +
    (mp ? `<h3>Chart data mapping</h3><p class="sub">${mp.labels.length ? mp.labels.map((l) => `&ldquo;${esc(clip(l.label, 30))}&rdquo; &rarr; ${l.items.length ? l.items.map((x) => `<code>${esc(x)}</code>`).join(", ") : "no data item found"}`).join("<br>") : "No label text: nothing says which data it draws."}</p>` : "") +
    (n.kind === "cell" && n.details.col !== undefined ? `<h3>Position</h3><p class="sub">row ${n.details.row + 1}, column ${n.details.col + 1} (tracked by position)</p>` : "");
  const writes = ACTIONABLE.has(wants) ? (d ? `<h3>${e.status === "accepted" || e.status === "changed" || e.status === "added" ? "Change this writes" : "Proposed edit if you accept"}</h3>${diffHtml(d)}` : p.existing ? `<h3>Proposed edit</h3><p class="sub">None: the page already has this marker.</p>` : `<h3>Proposed edit</h3><p class="sub">${n.textKind === "attribute" ? "Attribute text cannot carry a marker." : n.textKind === "expression" ? "Already an expression: nothing to add." : n.kind === "input" ? "A component field: the extractor only reads lowercase input, select and textarea names, so nothing can be written." : "Nothing to write for this node."}</p>`) : `<h3>Proposed edit</h3><p class="sub">${wants === "static" || wants === "visual" || wants === "structure" ? "None: this class needs no marker." : "Marking it dynamic, a list or an action would write an attribute."}</p>`;
  el.innerHTML =
    `<h2>${esc(n.kind === "text" ? "Text" : n.tag === "#page" ? "Page" : n.tag)} <span class="pm-chip cls-${e.cls} ${e.strength === "weak" ? "weak" : ""}">${esc(CLS[e.cls])}${e.cls === "structure" ? "" : ` &middot; ${e.strength}`}</span></h2>` +
    `<p class="sub">${esc(n.path || "")} &middot; line ${n.line}:${n.col} <button class="pm-btn sm" data-act="source" data-id="${n.id}" type="button">Show in source</button></p>` +
    (inst ? `<p class="sub">This is an instance of a repeated row; a decision here is made on its template row and covers every row.</p>` : "") +
    (n.kind === "text" ? `<div class="pm-quote">${esc(n.text)}</div>` : "") +
    `<h3>Status</h3><p class="sub">${e.status === "none" ? "Layout only: nothing to decide." : `${e.status === "proposed" ? "Proposed, waiting for you" : e.status[0].toUpperCase() + e.status.slice(1)}${p.existing ? " (the page already has this marker)" : ""}${decided ? ` &middot; by ${esc(decided.by)}` : ""}.`} Proposal: <b>${esc(CLS[p.cls])}</b>, ${p.strength}${p.lean ? `, leaning ${esc(CLS[p.lean])}` : ""}.</p>` +
    (e.cls !== "structure" || decided ? `<div class="pm-actions"><button class="pm-btn sm pri" data-act="accept" data-id="${n.id}" type="button" ${p.existing || p.cls === "structure" || (decided && decided.act === "accept") ? "disabled" : ""}>${decided && decided.act === "accept" ? "Accepted" : "Accept proposal"}</button><button class="pm-btn sm danger" data-act="reject" data-id="${n.id}" type="button" ${p.cls === "structure" ? "disabled" : ""}>Reject</button><button class="pm-btn sm" data-act="clear" data-id="${n.id}" type="button" ${decided ? "" : "disabled"}>Clear my decision</button></div>` : "") +
    `<h3>Mark this as</h3><div class="pm-chips" role="group" aria-label="Mark this node as">${chips}</div>` +
    (["dynamic", "list", "action", "input"].includes(wants) && n.textKind !== "attribute" ? `<div class="pm-name"><label for="nm">Name written</label><input id="nm" value="${esc(e.name ?? "")}" data-act="rename" data-id="${n.id}" maxlength="40" spellcheck="false" autocomplete="off"><button class="pm-btn sm" data-act="rename-go" data-id="${n.id}" type="button">Rename</button></div>` : "") +
    fix +
    `<h3>Why</h3><ul>${p.reasons.map((r) => `<li>${esc(r)}</li>`).join("")}${p.column ? `<li>column: ${esc(p.column)}</li>` : ""}${(p.contract ?? []).slice(0, 2).map((c) => `<li>API example <code>${esc(c.field)}</code> (${esc(c.source)}${c.formatter && c.formatter !== "asText" ? `, as ${esc(c.formatter)}` : ""})</li>`).join("")}</ul>` +
    (p.risk ? `<p class="pm-risk">May be wrong: ${esc(p.risk)}</p>` : "") +
    slots + extra +
    (comp ? `<h3>Repeated component x${comp.count}</h3><p class="sub">The same &lt;${esc(comp.tag)}&gt; structure appears in ${comp.count} places${comp.varying.length ? `; it varies in ${comp.varying.slice(0, 4).map((v) => `<code>${esc(v.path || "(root)")}${v.prop ? ` [${esc(v.prop)}]` : ""}</code>`).join(", ")}` : ""}.</p>` : "") +
    writes +
    `<details class="pm-more"><summary>Details</summary><dl class="pm-kv">${kv({ ...detail, id: n.id, "source range": `${n.start}-${n.end}` })}</dl></details>`;
}

// ---------- wireframe ----------
function paintWire() {
  const f = $("#wire");
  const themeAttr = document.documentElement.getAttribute("data-theme");
  if (S.wireFor !== S.data.page.name) {
    S.wireFor = S.data.page.name;
    f.srcdoc = `<!doctype html><html lang="en"${themeAttr ? ` data-theme="${themeAttr}"` : ""}><head><meta charset="utf-8"><meta name="color-scheme" content="light dark"><link rel="stylesheet" href="/theme.css"><link rel="stylesheet" href="/pagemap/pagemap.css"></head><body class="pm-frame">${S.data.wireframe}</body></html>`;
    f.onload = () => { const doc = f.contentDocument; for (const t of ["click", "mouseover"]) doc.addEventListener(t, dispatch); doc.addEventListener("mouseleave", () => hover(null)); paintWire(); };
    return;
  }
  const doc = f.contentDocument;
  if (!doc || !doc.body) return;
  if (themeAttr) doc.documentElement.setAttribute("data-theme", themeAttr); else doc.documentElement.removeAttribute("data-theme");
  for (const el of doc.querySelectorAll("[data-pm-id]")) {
    const id = el.dataset.pmId, e = S.data.effective[id];
    if (!e) continue;
    el.dataset.cls = e.cls;
    el.dataset.status = e.status;
    el.classList.toggle("pm-sel", id === S.selRaw || id === S.sel);
  }
  $("#midHint").textContent = "A wireframe drawn from the same tree as the structure: boxes are elements, coloured by class. Click a box to select it; hover a row on the left to find it here.";
  $("#wire").hidden = S.mtab !== "wire";
  $("#source").hidden = S.mtab !== "source";
  $("#orig").hidden = S.mtab !== "orig";
  $("#midHint").hidden = S.mtab !== "wire";
  for (const [id, tab] of [["#tabWire", "wire"], ["#tabSource", "source"], ["#tabOrig", "orig"]]) $(id).setAttribute("aria-selected", S.mtab === tab);
}

function hover(id) {
  const doc = $("#wire").contentDocument;
  if (doc) { for (const el of doc.querySelectorAll(".pm-hl")) el.classList.remove("pm-hl"); if (id) doc.querySelector(`[data-pm-id="${id}"]`)?.classList.add("pm-hl"); }
  for (const r of document.querySelectorAll(".pm-row.hov")) r.classList.remove("hov");
  if (id) document.querySelector(`.pm-row[data-id="${id}"]`)?.classList.add("hov");
}

// ---------- source ----------
function renderSource() {
  $("#source").innerHTML = S.data.source.split("\n").map((l, i) => `<div class="pm-ln" id="L${i + 1}" data-line="${i + 1}"><i>${i + 1}</i>${esc(l)}</div>`).join("");
}
function paintSourceSel() {
  for (const el of $("#source").querySelectorAll(".hl")) el.classList.remove("hl");
  if (!S.sel) return;
  const n = N(S.selRaw ?? S.sel);
  const a = lineOf(n.start), b = lineOf(Math.max(n.start, n.end - 1));
  for (let i = a; i <= Math.min(b, a + 60); i++) document.getElementById(`L${i}`)?.classList.add("hl");
}

// ---------- selection ----------
function select(id, { scroll = true } = {}) {
  if (!S.byId.has(id)) return;
  S.selRaw = id;
  S.sel = rootOf(id);
  for (let p = N(S.sel).parent; p; p = N(p)?.parent) S.closed.delete(p);
  paint();
  if (scroll) {
    document.querySelector(`.pm-row[data-id="${S.sel}"]`)?.scrollIntoView({ block: "nearest" });
    const doc = $("#wire").contentDocument;
    doc?.querySelector(`[data-pm-id="${S.selRaw}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
    if (S.mtab === "source") document.getElementById(`L${lineOf(N(S.selRaw).start)}`)?.scrollIntoView({ block: "center" });
  }
}

// ---------- the ONE dispatcher ----------
const act = {
  select: (el) => select(el.dataset.id),
  toggle: (el, ev) => { ev.stopPropagation(); const id = el.dataset.id; if (S.closed.has(id)) S.closed.delete(id); else S.closed.add(id); renderTree(); },
  group: (el, ev) => { ev.stopPropagation(); const g = el.dataset.g; if (S.groupsOpen.has(g)) S.groupsOpen.delete(g); else S.groupsOpen.add(g); renderTree(); },
  accept: (el, ev) => { ev?.stopPropagation(); return mutate("/api/pagemap/decide", { changes: [{ id: el.dataset.id, act: "accept" }] }, () => "Accepted."); },
  reject: (el, ev) => { ev?.stopPropagation(); return mutate("/api/pagemap/decide", { changes: [{ id: el.dataset.id, act: "reject" }] }, () => "Rejected."); },
  clear: (el) => mutate("/api/pagemap/decide", { changes: [{ id: el.dataset.id, act: "clear" }] }, () => "Decision cleared."),
  mark: (el) => mutate("/api/pagemap/decide", { changes: [{ id: el.dataset.id, act: "change", cls: el.dataset.cls }] }, () => `Marked as ${CLS[el.dataset.cls].toLowerCase()}.`),
  "rename-go": (el) => { const v = $("#nm")?.value.trim(); if (v) return mutate("/api/pagemap/decide", { changes: [{ id: el.dataset.id, act: "rename", name: v }] }, () => "Renamed."); },
  "accept-strong": () => mutate("/api/pagemap/decide", { bulk: "accept-strong" }, () => "Accepted every strong proposal. Undo takes them back together."),
  "review-weak": () => { S.ltab = "review"; renderLeft(); },
  undo: () => mutate("/api/pagemap/undo", {}, () => "Undone."),
  redo: () => mutate("/api/pagemap/redo", {}, () => "Redone."),
  ltab: (el) => { S.ltab = el.dataset.tab; renderLeft(); },
  mtab: (el) => { S.mtab = el.dataset.tab; paintWire(); if (S.mtab === "source" && S.sel) { paintSourceSel(); document.getElementById(`L${lineOf(N(S.selRaw ?? S.sel).start)}`)?.scrollIntoView({ block: "center" }); } },
  "filter-cls": (el) => { S.filter.cls = S.filter.cls === el.dataset.cls ? "all" : el.dataset.cls; S.ltab = "structure"; renderSummary(); renderLeft(); },
  source: (el) => { S.mtab = "source"; paintWire(); document.getElementById(`L${lineOf(N(el.dataset.id).start)}`)?.scrollIntoView({ block: "center" }); },
  theme: () => {
    const cur = document.documentElement.getAttribute("data-theme");
    const next = cur === null ? "light" : cur === "light" ? "dark" : null;
    if (next) document.documentElement.setAttribute("data-theme", next); else document.documentElement.removeAttribute("data-theme");
    try { if (next) localStorage.setItem("lm-theme", next); else localStorage.removeItem("lm-theme"); } catch {}
    paintTheme(); paintWire();
  },
  apply: () => doApply(),
  use: () => doUse(),
};
const FIELD = { pick: (el) => { location.search = `?${el.value}`; }, filter: () => { S.filter = { cls: $("#fClass").value, strength: $("#fStrength").value, review: $("#fReview").checked, unsure: $("#fUnsure").checked, icons: $("#fIcons").checked, q: $("#fQuery").value.trim() }; renderSummary(); renderTree(); } };

function dispatch(ev) {
  const t = ev.target.closest?.("[data-act]");
  if (ev.type === "mouseover") { const h = ev.target.closest?.("[data-id],[data-pm-id]"); hover(h ? (h.dataset.id ?? h.dataset.pmId) : null); return; }
  if (t) {
    const name = t.dataset.act, field = /^(SELECT|INPUT)$/.test(t.tagName) && t.type !== "button";
    if (field) { if (ev.type === "click") return; return void FIELD[name]?.(t, ev); }
    if (ev.type === "click") return void act[name]?.(t, ev);
    return;
  }
  const node = ev.target.closest?.("[data-pm-id]");
  if (node && ev.type === "click") select(node.dataset.pmId);
}
for (const t of ["click", "change", "input"]) document.addEventListener(t, dispatch);
document.addEventListener("mouseover", dispatch);
document.addEventListener("keydown", (ev) => {
  const el = ev.target;
  if (el.id === "nm" && ev.key === "Enter") { ev.preventDefault(); act["rename-go"](el); return; }
  const row = el.closest?.(".pm-row");
  if (!row || el.tagName === "INPUT") return;
  const all = [...document.querySelectorAll("#tree .pm-row")], i = all.indexOf(row);
  const focus = (r) => { if (r) { for (const x of all) x.tabIndex = -1; r.tabIndex = 0; r.focus(); } };
  if (ev.key === "ArrowDown") { ev.preventDefault(); focus(all[i + 1]); }
  else if (ev.key === "ArrowUp") { ev.preventDefault(); focus(all[i - 1]); }
  else if (ev.key === "Home") { ev.preventDefault(); focus(all[0]); }
  else if (ev.key === "End") { ev.preventDefault(); focus(all.at(-1)); }
  else if (ev.key === "ArrowRight") { const id = row.dataset.id; if (S.closed.has(id)) { S.closed.delete(id); renderTree(); document.querySelector(`.pm-row[data-id="${id}"]`)?.focus(); } }
  else if (ev.key === "ArrowLeft") { const id = row.dataset.id; if (!S.closed.has(id) && N(id).children?.length) { S.closed.add(id); renderTree(); document.querySelector(`.pm-row[data-id="${id}"]`)?.focus(); } }
  else if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); select(row.dataset.id); document.querySelector(`.pm-row[data-id="${row.dataset.id}"]`)?.focus(); }
});

// ---------- apply to a marked copy, then (second step) use it ----------
async function doApply() {
  const dlg = $("#applyDlg"), body = $("#applyBody");
  try {
    const r = await api("/api/pagemap/apply", { ...S.ref });
    setData(r.map);
    const d = r.diff;
    body.innerHTML = `<p><b>${esc(r.written)}</b> was written next to the page: ${r.edits} edit${r.edits === 1 ? "" : "s"}, +${d.added} -${d.removed} lines. The page itself is unchanged.</p>` +
      (r.skipped.length ? `<p class="sub">${r.skipped.length} accepted decision${r.skipped.length === 1 ? " writes" : "s write"} nothing: ${[...new Set(r.skipped.map((s) => s.note))].map(esc).join("; ")}.</p>` : "") +
      `<div class="pm-diff" tabindex="0" aria-label="Difference between the page and the marked copy">${d.hunks.slice(0, 40).map((h) => `<div class="h">${esc(h.header)}</div>` + h.lines.map((l) => `<div class="d ${l.t === "+" ? "add" : l.t === "-" ? "del" : ""}">${esc(l.t)} ${esc(l.text)}</div>`).join("")).join("")}${d.hunks.length > 40 ? `<div class="h">${d.hunks.length - 40} more hunks not shown</div>` : ""}</div>` +
      (S.data.page.canUse ? `<div class="pm-use"><p><b>Second step, only if you want it.</b> Using the marked copy replaces <code>${esc(S.data.page.name)}</code> with it. The page it replaces is kept as a backup that is never overwritten: <code>${esc(S.data.page.name.replace(/(\.\w+)$/, ".before-pagemap$1"))}</code> the first time, then <code>.before-pagemap.2</code>, <code>.3</code>. To undo, copy a backup over the page. Your decisions start over, because the lines move.</p><label><input type="checkbox" id="useOk"> I want to replace ${esc(S.data.page.name)}</label> <button class="pm-btn danger" data-act="use" id="useBtn" type="button" disabled>Use as the page</button></div>` : `<p class="sub">A real Subframe page is never replaced from here. Take the marked copy from the example's folder.</p>`);
    body.querySelector("#useOk")?.addEventListener("change", (e) => { body.querySelector("#useBtn").disabled = !e.target.checked; });
    dlg.showModal();
  } catch (e) { say(e.message, "err"); }
}
async function doUse() {
  try {
    const r = await api("/api/pagemap/use", { ...S.ref, confirm: true });
    setData(r.map);
    $("#applyDlg").close();
    say(r.unchanged ? `${r.used} already is the marked copy: nothing was replaced and no backup was made.` : `${r.used} now has the markers. The page it replaced is kept as ${r.backup} (never overwritten). Decisions start over.`, "ok");
  } catch (e) { say(e.message, "err"); }
}

// ---------- theme ----------
function paintTheme() {
  const cur = document.documentElement.getAttribute("data-theme");
  const b = $("#bTheme");
  b.textContent = cur === "dark" ? "Dark" : cur === "light" ? "Light" : "Auto";
  b.title = `Theme: ${b.textContent}. Click to change.`;
}
paintTheme();
try { mountBuildBadge($("#build")); } catch {}
boot();
