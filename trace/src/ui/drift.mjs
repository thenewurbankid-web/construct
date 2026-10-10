// The Drift page (/drift): a stored contract-drift result (from drift-routes.mjs's /api/drift), read only.
// Rendering is pure (payload in, HTML string out) so it is unit-tested in Node; mountDrift() is the only DOM
// part. Same convention as src/ui/quality.mjs. No trigger logic here — this never runs a diff, only displays
// what `storeDrift` (drift-policy.mjs) already wrote.
import { esc } from "./about.mjs";

const rowsOf = (list, kind) => list.map((e) => `<li><span class="chip k-${kind}">${esc(kind)}</span> <code>${esc(e.method)} ${esc(e.path)}</code></li>`).join("");

export function renderEndpointGroups(data) {
  const groups = [
    ["Added", data.added, "feat"],
    ["Removed", data.removed, "fix"],
    ["Changed", data.changed.map((c) => ({ method: c.method, path: c.path ?? c.after ?? c.before })), "change"],
  ].filter(([, list]) => list.length);
  if (!groups.length) return "";
  return groups.map(([label, list, kind]) => `<h2>${esc(label)} (${list.length})</h2><ul>${rowsOf(list, kind)}</ul>`).join("");
}

export function renderChangedDetail(changed) {
  if (!changed.length) return "";
  const rows = changed.map((c) => `<li><code>${esc(c.method)} ${esc(c.path ?? c.after ?? c.before)}</code> — ${esc(c.kind)}: <code>${esc(c.before)}</code> → <code>${esc(c.after)}</code></li>`).join("");
  return `<h2>Change detail</h2><ul>${rows}</ul>`;
}

export function renderPage(data) {
  if (!data.available) return `<p class="empty">No drift check has been stored yet for this example.</p>`;
  const status = data.status === "clean"
    ? `<span class="chip k-feat">Clean</span>`
    : `<span class="chip k-fix">${data.affected.length} endpoint${data.affected.length === 1 ? "" : "s"} drifted</span>`;
  const blocked = data.blocked ? `<p class="sub k-fix">${esc(data.reason)}</p>` : "";
  return [
    `<p>${status} <span class="sub">stored drift check against the contract</span></p>`,
    blocked,
    renderEndpointGroups(data),
    renderChangedDetail(data.changed),
  ].join("");
}

// DOM part. root: the element to fill; opts.fetchJson for tests; opts.example overrides the page's own ?example=.
export function mountDrift(root, opts = {}) {
  const get = opts.fetchJson ?? (async (u) => (await fetch(u, { cache: "no-store" })).json());
  const example = opts.example ?? new URLSearchParams(window.location.search).get("example");
  if (!example) { root.innerHTML = `<p class="empty">No example given. Open this page with <code>?example=&lt;name&gt;</code>.</p>`; return; }
  (async () => {
    try { root.innerHTML = renderPage(await get(`/api/drift?example=${encodeURIComponent(example)}`)); }
    catch { root.innerHTML = `<p class="empty">Could not load /api/drift. Is the server running?</p>`; }
  })();
}
