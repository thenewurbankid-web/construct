// LIN-257: the pointer path for drag-to-attach on the Map (src/ui/canvas/map.mjs). The only draggable wire is a
// Tie part that never got an endpoint — buildMap plants a "tie:none" node exactly then (parts.mjs:140), when some
// part's term is "tie" and sourceOf() could not parse any endpoint out of its cell at all.
//
// Reaching that shape through the demo's own "Wire it" button turns out not to work: every live Ask this demo
// presents already carries a resolved candidate endpoint by the time a person could skip it (confirmed empirically
// against the real server — "Skip for now"/"Skip the rest" on invoices' three Ties all settle on
// "GET /api/invoices", never null). The one thing that reliably produces a null-endpoint Tie is a fully
// non-interactive run — `POST /api/run` with `auto: true` (the same flag `startRun({auto:true})` uses for the
// Inspector's own "apply a fix, then replay" flow, src/ui/demo.mjs:162) run on a freshly reset example, fed
// straight into `createTrace`'s own public `update()` (the same call `trace.mjs`'s event handling makes) rather
// than through a second interactive run (confirmed by trial: starting the ordinary interactive "Wire it" run even
// once before the auto run changes the auto run's own outcome — some cross-run cache/ledger effect on the server
// makes the *second* run on the same example resolve the same Ties the first one did). So this spec never clicks
// "Wire it": it calls the same public entry points demo.mjs itself calls (`trace.begin`, `trace.update`,
// `trace.screen`, `trace.setView`, all exposed on `window.__trace` behind `?canvasdebug`) directly, with real
// data from a real, non-mocked run against the real server. See the report for this as a scoping note.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const invoicesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "examples", "invoices");
const STATE_FILES = ["answers.json", "decisions.json", "ai-cache.json", "answers.history.jsonl"];

test("dragging an unresolved Tie wire highlights compatible APIs and pins a valid drop (LIN-257)", async ({ page }) => {
  const before = STATE_FILES.map((f) => { const p = path.join(invoicesDir, f); return fs.existsSync(p) ? [p, fs.readFileSync(p)] : [p, null]; });
  const restore = () => { for (const [p, buf] of before) if (buf === null) fs.rmSync(p, { force: true }); else fs.writeFileSync(p, buf); };
  try {
    await runTest(page);
  } finally {
    restore();
  }
});

async function runTest(page) {
  await page.goto("/?canvasdebug");
  await page.waitForFunction(() => !!window.__trace);
  await page.evaluate(() => fetch("/api/reset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ example: "invoices" }) }));
  await page.evaluate(() => window.__trace.begin({ example: "invoices" }));

  // A real, non-interactive run against the real server (see the file header for why "auto" and not "Wire it").
  const run = await page.evaluate(async () => {
    const r = await fetch("/api/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ example: "invoices", useSaved: true, auto: true }) });
    const { run: runId } = await r.json();
    return new Promise((resolve, reject) => {
      const es = new EventSource(`/api/events?run=${runId}`);
      let tree = null, items = [], exprKinds = [];
      const timer = setTimeout(() => { es.close(); reject(new Error("the auto run did not finish in time")); }, 15_000);
      es.onmessage = (m) => {
        const ev = JSON.parse(m.data);
        if (ev.type === "tree") { tree = ev.data.tree; exprKinds = ev.data.exprKinds ?? exprKinds; }
        else if (ev.type === "items") { items = ev.data.items; }
        else if (ev.type === "done") { clearTimeout(timer); es.close(); resolve({ tree, items, exprKinds }); }
        else if (ev.type === "error") { clearTimeout(timer); es.close(); reject(new Error(ev.data.message)); }
      };
      es.onerror = () => { clearTimeout(timer); es.close(); reject(new Error("EventSource failed")); };
    });
  });
  // Feed it through the exact path demo.mjs's own event handling uses (summarize() -> trace.update()), then reveal
  // the fit screen's Map view directly (trace.screen/setView are the same calls go("fit")/vMap's click make) —
  // without ever starting a second, interactive run, which is what disturbs the first run's own resolution (see
  // the file header).
  await page.evaluate(async ({ tree, items, exprKinds }) => {
    const { summarize } = await import("/demo/vocab.mjs");
    const itemsMap = Object.fromEntries(items.map((i) => [i.id, i]));
    const sum = summarize(tree, { items: itemsMap });
    window.__trace.update(tree, sum.states, null, exprKinds ?? []);
  }, run);
  await page.evaluate(() => {
    for (const s of ["drop", "fit", "hand"]) { const el = document.querySelector(`#s-${s}`); if (el) el.hidden = s !== "fit"; }
    window.__trace.screen("fit");
    window.__trace.setView("map");
  });
  await expect(page.locator("#mapCanvas")).toBeVisible();
  await page.waitForFunction(() => window.__trace?.map?.index?.byId?.has?.("tie:none"));

  // The one draggable node: a left-side Tie node whose own edge targets "tie:none" (mirrors layout.mjs's own
  // isDraggableTie, which map.mjs uses internally) — this test reads the plain data idx already exposes, same as
  // demo-map-attach-tie.spec.mjs does for picking a node's on-screen rect.
  const partId = await page.evaluate(() => {
    const idx = window.__trace.map.index, none = idx.byId.get("tie:none");
    for (let i = 0; i < idx.nodes.length; i++) {
      const n = idx.nodes[i];
      if (n.side !== 0 || n.term !== "tie") continue;
      for (const e of idx.adj[i]) if (idx.edges.a[e] === none || idx.edges.b[e] === none) return n.id;
    }
    return null;
  });
  expect(partId, "the invoices example, run fully auto, should leave at least one Tie unresolved to tie:none").not.toBeNull();

  const rectOf = (id) => page.evaluate((id) => {
    const t = window.__trace, idx = t.map.index, v = t.map.view;
    const n = idx.nodes.find((n) => n.id === id);
    const r = document.querySelector("#mapCanvas").getBoundingClientRect();
    return { x: r.left + (n.x + n.w / 2) * v.k + v.tx, y: r.top + (n.y + n.h / 2) * v.k + v.ty };
  }, id);

  const partHit = await rectOf(partId);
  const endpointIds = await page.evaluate(() => window.__trace.map.index.nodes.filter((n) => n.kind === "endpoint").map((n) => n.id));
  expect(endpointIds.length).toBeGreaterThan(0);

  // ---- start a drag and read the compatible set ----
  await page.mouse.move(partHit.x, partHit.y);
  await page.mouse.down();
  await page.mouse.move(partHit.x + 30, partHit.y + 10, { steps: 4 }); // past the moved>4 click threshold
  await expect.poll(() => page.evaluate(() => window.__trace.map.drag?.nodeId ?? null)).toBe(partId);
  const compatible = await page.evaluate(() => window.__trace.map.drag.compatible);
  expect(Array.isArray(compatible)).toBe(true);
  for (const id of compatible) expect(endpointIds).toContain(id);
  const incompatibleId = endpointIds.find((id) => !compatible.includes(id));

  // ---- release over empty canvas: rejected, no pin, drag clears ----
  const box = await page.locator("#mapCanvas").boundingBox();
  await page.mouse.move(box.x + 4, box.y + 4);
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.__trace.map.drag)).toBeNull();
  await expect.poll(() => page.evaluate((id) => window.__trace.map.pinned[id], partId)).toBeUndefined();

  // ---- drop on an incompatible card (if one exists): still rejected ----
  if (incompatibleId) {
    const hit = await rectOf(incompatibleId);
    await page.mouse.move(partHit.x, partHit.y);
    await page.mouse.down();
    await page.mouse.move((partHit.x + hit.x) / 2, (partHit.y + hit.y) / 2, { steps: 4 });
    await page.mouse.move(hit.x, hit.y, { steps: 4 });
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => window.__trace.map.drag)).toBeNull();
    await expect.poll(() => page.evaluate((id) => window.__trace.map.pinned[id], partId)).toBeUndefined();
  }

  // ---- drop on a compatible card: pinned ----
  expect(compatible.length, "invoices' unresolved Ties should have at least one type-compatible endpoint").toBeGreaterThan(0);
  const compatHit = await rectOf(compatible[0]);
  await page.mouse.move(partHit.x, partHit.y);
  await page.mouse.down();
  await page.mouse.move((partHit.x + compatHit.x) / 2, (partHit.y + compatHit.y) / 2, { steps: 4 });
  await page.mouse.move(compatHit.x, compatHit.y, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.__trace.map.drag)).toBeNull();
  await expect.poll(() => page.evaluate((id) => window.__trace.map.pinned[id], partId)).toBe(compatible[0]);
}
