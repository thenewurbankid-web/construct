// The Part inspector inside the full studio (/studio), added with one script tag so the studio's own script stays as it is.
// It adds the same issue badges over the studio's page stage and next to the open-items rows, and opens the inspector from
// a badge, from a row's "Inspect" button, or by double-clicking a part (a single click keeps its old job: show it in the tree).
// The studio's own click and keys are untouched. State comes from /api/parts, which reads the example's saved answers.
import { createInspector, PART_ID } from "/inspector/inspector.mjs";
import { badgeHtml } from "/inspector/issues.mjs";

const link = document.createElement("link");
link.rel = "stylesheet"; link.href = "/inspector/inspector.css";
// the studio's variables, mapped onto the tokens the inspector is written in
const map = document.createElement("style");
map.textContent = `.pi, .pi-back, .pv-badges, .ibg, .oi-i { --surface: var(--card); --surface-2: var(--stat); --text: var(--fg); --muted: var(--mut); --border: var(--bd); --border-strong: color-mix(in srgb, var(--fg) 25%, var(--bd)); --accent: var(--acc); --on-accent: #fff; --fit: var(--grn); --wait: var(--amb); --gap: var(--red); --tie: var(--amb); --stub: var(--ph); --font: system-ui, sans-serif; --mono: ui-monospace, Menlo, monospace; --shadow: 0 1px 6px rgba(0,0,0,.3); --shadow-lg: 0 18px 60px rgba(0,0,0,.55); }
.oi-i { display: inline-flex; gap: 6px; align-items: center; margin-left: 8px; } .oi-i button { font-size: 11px; border: 1px solid var(--bd); background: transparent; color: var(--fg); border-radius: 6px; padding: 1px 8px; }`;
document.head.append(link, map);

const example = () => (document.querySelector("#pv")?.dataset.src ?? "").split(":")[0];
let parts = {}, seenFor = null, t = null;
const inspector = createInspector({
  example, canOpen: () => !!example(),
  toast: (m) => console.warn(m),
  // an auto run wires the example again from its saved answers; give it a moment to finish (no run id to wait on here)
  replay: async () => { document.querySelector("#bAuto")?.click(); await new Promise((r) => setTimeout(r, 2500)); },
});

async function load() {
  const ex = example();
  if (!ex) return;
  try { const j = await (await fetch(`/api/parts?example=${encodeURIComponent(ex)}`)).json(); parts = Object.fromEntries((j.parts ?? []).map((p) => [p.id, p])); } catch { parts = {}; }
  await inspector.refreshEdited();
  paint();
}
function paint() {
  const box = document.querySelector("#pv");
  if (!box) return;
  const kinds = {}, unders = {};
  for (const [id, p] of Object.entries(parts)) if (p.kind) { kinds[id] = p.kind; unders[id] = p.under; }
  inspector.paintBadges({ box, kinds, unders });
  // the studio's open-items rows (.ir, keyed by data-iexp): a badge and an Inspect button in each row's head
  for (const row of document.querySelectorAll(".ir[data-iexp]")) {
    const id = row.dataset.iexp, head = row.querySelector(".ih");
    if (!head || head.querySelector(".oi-i") || !PART_ID.test(id)) continue;
    const p = parts[id];
    head.querySelector(".car")?.insertAdjacentHTML("beforebegin", `<span class="oi-i">${p?.kind ? badgeHtml(p.kind, { size: "s", under: p.under }) : ""}<button type="button" data-open-part="${id}">Inspect</button></span>`);
  }
}
new MutationObserver((muts) => { if (muts.every((m) => m.target.closest?.(".pv-badges, .pi-back"))) return; clearTimeout(t); t = setTimeout(() => { if (example() !== seenFor) { seenFor = example(); load(); } else paint(); }, 400); })
  .observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "data-src"] });
document.addEventListener("inspector-changed", load);
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-open-part]");
  if (b) { e.preventDefault(); e.stopPropagation(); inspector.open(b.dataset.openPart, b); }
}, true);
document.addEventListener("dblclick", (e) => {
  const el = e.target.closest("#pv [data-id]");
  if (el && PART_ID.test(el.dataset.id)) inspector.open(el.dataset.id, el);
});
