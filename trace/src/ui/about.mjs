// The About page (/about): what build is running, what is new, what changed in this build, and the deploy history.
// Rendering is pure (payload in, HTML string out) so it is unit-tested in Node; mountAbout() is the only DOM part.
// Every string that comes from a file (changelog text, file names) is escaped before it reaches the page.
import { relativeTime } from "./build-badge.mjs";

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
// `code` spans in changelog text; escaped first so nothing else can become markup
const inline = (s) => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>");

const KIND_ORDER = ["feat", "fix", "change", "note"];
const KIND_LABEL = { feat: "New", fix: "Fix", change: "Change", note: "Note" };
const exact = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" }) : "");
const ago = (iso, now) => !iso || Number.isNaN(Date.parse(iso)) ? "unknown" : `<time data-ago="${esc(iso)}" datetime="${esc(iso)}" title="${esc(exact(iso))}">${relativeTime(Date.parse(iso), now)}</time>`;

export function formatUptime(sec) {
  if (sec < 60) return `${sec} s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h} h ${m % 60} min` : `${Math.floor(h / 24)} days ${h % 24} h`;
}

export const testsText = (t) => (t ? `${t.pass} passed${t.fail ? `, ${t.fail} failed` : ""}${t.todo ? `, ${t.todo} todo` : ""} (${t.total} tests)` : "not recorded (not a deployed build)");

// The releases whose items (or minors' items) match the search text (case-insensitive, over the text, kind and release
// id). A release or minor whose id matches is kept whole.
export function filterReleases(releases, q) {
  const needle = String(q ?? "").trim().toLowerCase();
  if (!needle) return releases;
  const hit = (i) => `${i.text} ${i.kind} ${KIND_LABEL[i.kind] ?? ""}`.toLowerCase().includes(needle);
  const idHit = (r) => r.id.toLowerCase().includes(needle);
  return releases
    .map((r) => {
      const minors = (r.minors ?? []).map((m) => (idHit(m) ? m : { ...m, items: m.items.filter(hit) })).filter((m) => m.items.length || idHit(m));
      return idHit(r) ? r : { ...r, items: r.items.filter(hit), minors };
    })
    .filter((r) => r.items.length || (r.minors ?? []).length || idHit(r));
}

const chip = (k) => `<span class="chip k-${esc(k)}">${esc(KIND_LABEL[k] ?? k)}</span>`;

const groupsHtml = (items) => KIND_ORDER.concat([...new Set(items.map((i) => i.kind))].filter((k) => !KIND_ORDER.includes(k)))
  .map((k) => [k, items.filter((i) => i.kind === k)]).filter(([, l]) => l.length)
  .map(([k, l]) => `<div class="grp">${chip(k)}<ul>${l.map((i) => `<li>${inline(i.text)}</li>`).join("")}</ul></div>`).join("");
const metaHtml = (r) => [r.date, r.label].filter(Boolean).map(esc).join(" · ");

export function renderBuild(data, now) {
  const b = data.build, dev = !!b.dev;
  const rows = [
    ["Version", `<code>${esc(b.version)}</code>`],
    ["Release", b.release ? `${esc(b.release)}${b.minor && b.major ? ` <span class="sub">minor release of ${esc(b.major)}</span>` : ""}` : "none yet"],
    ["Hash", `<code class="brk">${esc(b.hash)}</code>`],
    ["Deployed", dev ? "not deployed: this is a development checkout" : `${ago(b.builtAt, now)} <span class="sub">${esc(exact(b.builtAt))}</span>`],
    ["Port", esc(data.port ?? "unknown")],
    ["Uptime", `<span data-uptime="${esc(data.uptimeSec)}" data-at="${now}">${esc(formatUptime(data.uptimeSec))}</span>`],
    ["Node", esc(data.node)],
    ["Tests at deploy", esc(testsText(data.tests))],
    ["Files in build", esc(b.files)],
    ["Previous build", data.previousVersion ? `<code>${esc(data.previousVersion)}</code>` : "none"],
  ];
  return `<h2 id="h-build">Build</h2><dl class="kv">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>`;
}

// The release list only (re-rendered on every keystroke of the search, so the rest of the page keeps its open state).
// Each release shows its minor releases nested first (newest first, as the file has them; they are what is new since the
// release), then the release's own items under "Release notes". The newest release is expanded and so is its newest
// minor; searching opens everything that matches.
export function renderReleases(changelog, q = "") {
  const all = changelog.releases, shown = filterReleases(all, q), searching = !!String(q).trim();
  const body = shown.map((r) => {
    const minors = r.minors ?? [];
    const open = searching || r.id === all[0]?.id ? " open" : "";
    const meta = metaHtml(r);
    const count = r.items.length + minors.reduce((n, m) => n + m.items.length, 0);
    const own = groupsHtml(r.items);
    const nested = minors.map((m, i) => {
      const mo = searching || (open && i === 0) ? " open" : ""; // the latest minor of the open release
      const mm = metaHtml(m);
      return `<details class="minor"${mo}><summary><b>${esc(m.id)}</b> <span class="sub">minor release${mm ? ` · ${mm}` : ""}</span><span class="n">${m.items.length}</span></summary>${groupsHtml(m.items) || `<p class="empty">No items.</p>`}</details>`;
    }).join("");
    return `<details class="rel"${open}><summary><b>${esc(r.id)}</b>${meta ? ` <span class="sub">${meta}</span>` : ""}<span class="n">${count}</span></summary>${nested}${nested && own ? `<p class="sub own">Release notes for ${esc(r.id)}</p>` : ""}${own}${own || nested ? "" : `<p class="empty">No items.</p>`}</details>`;
  }).join("");
  return body || `<p class="empty">Nothing matches "${esc(q)}".</p>`;
}

export function renderWhatsNew(changelog, q = "") {
  if (!changelog.releases.length) return `<h2 id="h-new">What's new</h2><p class="empty">No CHANGELOG.md entries yet.</p>`;
  return `<h2 id="h-new">What's new</h2><label class="search"><span class="sr">Search the changelog</span><input type="search" id="q" placeholder="Search changes" value="${esc(q)}" autocomplete="off"></label><div id="rels">${renderReleases(changelog, q)}</div>${changelog.ignored ? `<p class="sub">${changelog.ignored} line(s) in CHANGELOG.md could not be read and were skipped.</p>` : ""}`;
}

export function renderChanges(data) {
  const c = data.changesSincePrevious;
  if (!c) return `<h2 id="h-chg">Changes in this build</h2><p class="empty">${data.build.dev ? "Only available for deployed builds." : "This is the first recorded build, so there is nothing to compare it with."}</p>`;
  const kinds = [["added", "Added"], ["modified", "Modified"], ["removed", "Removed"]];
  const total = c.counts.added + c.counts.modified + c.counts.removed;
  return `<h2 id="h-chg">Changes in this build</h2><p class="sum">${kinds.map(([k, l]) => `<span class="cnt ${k}"><b>${c.counts[k]}</b> ${l.toLowerCase()}</span>`).join("")} <span class="sub">compared with <code>${esc(data.previousVersion)}</code></span></p>${
    total === 0 ? `<p class="empty">The files are identical.</p>` : kinds.filter(([k]) => c.counts[k]).map(([k, l]) =>
      `<details class="files ${k}"><summary>${l} files <span class="n">${c.counts[k]}</span></summary><ul>${c[k].map((f) => `<li><code class="brk">${esc(f)}</code></li>`).join("")}</ul>${c.truncated[k] ? `<p class="sub">and ${c.truncated[k]} more not listed</p>` : ""}</details>`).join("")}`;
}

export function renderHistory(data, now) {
  if (!data.history.length) return `<h2 id="h-hist">Deploy history</h2><p class="empty">No deployed builds recorded. Run <code>npm run deploy:local</code>.</p>`;
  return `<h2 id="h-hist">Deploy history</h2><div class="scroll"><table><thead><tr><th scope="col">Version</th><th scope="col">Release</th><th scope="col">Deployed</th><th scope="col">Tests</th><th scope="col"></th></tr></thead><tbody>${data.history.map((h) =>
    `<tr${h.current ? ` class="cur"` : ""}><td><code>${esc(h.version)}</code></td><td>${esc(h.release ?? "")}</td><td>${ago(h.deployedAt, now)}</td><td>${h.tests ? `${h.tests.pass}/${h.tests.total}` : ""}</td><td>${h.current ? `<span class="chip k-feat">current</span>` : h.rollbackAvailable ? `<span class="sub">rollback available</span>` : ""}</td></tr>`).join("")}</tbody></table></div>`;
}

export function renderPage(data, now, q = "") {
  return [
    `<section aria-labelledby="h-build">${renderBuild(data, now)}</section>`,
    `<section aria-labelledby="h-new">${renderWhatsNew(data.changelog, q)}</section>`,
    `<section aria-labelledby="h-chg">${renderChanges(data)}</section>`,
    `<section aria-labelledby="h-hist">${renderHistory(data, now)}</section>`,
  ].join("");
}

// DOM part. root: the element to fill; opts.fetchJson / opts.now for tests.
export function mountAbout(root, opts = {}) {
  const now = opts.now ?? Date.now;
  const get = opts.fetchJson ?? (async (u) => (await fetch(u, { cache: "no-store" })).json());
  let data = null, q = "";
  const draw = () => {
    root.innerHTML = renderPage(data, now(), q);
    const input = root.querySelector("#q");
    input?.addEventListener("input", () => { q = input.value; root.querySelector("#rels").innerHTML = renderReleases(data.changelog, q); });
  };
  const load = async () => {
    try { data = await get("/api/about"); draw(); }
    catch { if (!data) root.innerHTML = `<p class="empty">Could not load /api/about. Is the server running?</p>`; }
  };
  // keep the "x ago" and uptime text moving without refetching or redrawing (a redraw would collapse open sections)
  const tick = () => {
    for (const t of root.querySelectorAll("time[data-ago]")) t.textContent = relativeTime(Date.parse(t.dataset.ago), now());
    for (const u of root.querySelectorAll("[data-uptime]")) u.textContent = formatUptime(Number(u.dataset.uptime) + Math.round((now() - Number(u.dataset.at)) / 1000));
  };
  load();
  const timers = [setInterval(tick, 30_000)]; // new builds are announced by the badge; no refetch here
  return { load, stop: () => timers.forEach(clearInterval) };
}
