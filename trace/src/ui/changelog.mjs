// The Changelog page (/changelog): a "Coming next" list of planned capabilities, then every release, newest first,
// with the current one highlighted at the top. Reuses about.mjs's parsing-independent renderers
// (renderReleases/filterReleases/esc) and the same /api/about payload as the About page, so there is only one
// changelog parser (src/changelog.mjs, which also parses docs/NEXT.md) and one renderer for release lists. /about
// keeps the build/deploy info; this page is the changelog on its own, linkable and shareable.
import { esc, filterReleases, installShotZoom, renderReleases } from "./about.mjs";

export function renderCurrent(build) {
  if (!build.release) return `<p class="cur-none">No release recorded yet.</p>`;
  return `<p class="cur">You are on <b>${esc(build.release)}</b>${build.dev ? ` <span class="sub">(development checkout)</span>` : ""}</p>`;
}

// A "Building now" badge (icon + text, never colour alone) for the item(s) mid-flight; the aria-label repeats the
// visible text so a screen reader announces the same thing a sighted reader sees.
const BUILDING_BADGE = `<span class="badge-building" aria-label="Building now"><svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 4.5v4l2.5 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>Building now</span>`;

// The "Coming next" list (from docs/NEXT.md), shown above the history so the owner sees what's planned before what
// shipped. Building items sort first (stable order otherwise); each item's changes render as a nested sub-list.
// An empty file (or one with only unreadable lines) says so instead of showing nothing.
export function renderNext(next) {
  const items = next?.items ?? [];
  if (!items.length) return `<h2 id="h-next">Coming next</h2><p class="empty">Nothing planned yet.</p>`;
  const ordered = items.map((i, order) => ({ i, order })).sort((a, b) => (a.i.status === "building" ? 0 : 1) - (b.i.status === "building" ? 0 : 1) || a.order - b.order).map((x) => x.i);
  return `<h2 id="h-next">Coming next</h2><ul class="next">${ordered.map((i) =>
    `<li>${i.status === "building" ? BUILDING_BADGE + " " : ""}<b>${esc(i.id)}</b> ${esc(i.text)} <span class="sub">${esc(i.task)} · ETA ${esc(i.eta)}</span>${
      i.changes?.length ? `<ul class="next-changes">${i.changes.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>` : ""
    }</li>`).join("")}</ul>`;
}

export function renderPage(data, q = "") {
  const changelog = data.changelog;
  return [
    `<section aria-labelledby="h-cur">${renderCurrent(data.build)}</section>`,
    `<section aria-labelledby="h-next">${renderNext(data.next)}</section>`,
    `<section aria-labelledby="h-log">`,
    `<h1 id="h-log">Changelog</h1>`,
    changelog.releases.length
      ? `<label class="search"><span class="sr">Search the changelog</span><input type="search" id="q" placeholder="Search changes" value="${esc(q)}" autocomplete="off"></label><div id="rels">${renderReleases(changelog, q)}</div>${changelog.ignored ? `<p class="sub">${changelog.ignored} line(s) in CHANGELOG.md could not be read and were skipped.</p>` : ""}`
      : `<p class="empty">No CHANGELOG.md entries yet.</p>`,
    `</section>`,
  ].join("");
}

// DOM part. root: the element to fill; opts.fetchJson for tests.
export function mountChangelog(root, opts = {}) {
  const get = opts.fetchJson ?? (async (u) => (await fetch(u, { cache: "no-store" })).json());
  let data = null, q = "";
  installShotZoom(root);
  const draw = () => {
    root.innerHTML = renderPage(data, q);
    const input = root.querySelector("#q");
    input?.addEventListener("input", () => { q = input.value; root.querySelector("#rels").innerHTML = renderReleases(data.changelog, q); });
  };
  const load = async () => {
    try { data = await get("/api/about"); draw(); }
    catch { if (!data) root.innerHTML = `<p class="empty">Could not load /api/about. Is the server running?</p>`; }
  };
  load();
  return { load };
}

// re-exported so a page that only needs the changelog does not also have to import about.mjs directly
export { filterReleases };
