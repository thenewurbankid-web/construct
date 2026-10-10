// LIN-90 §4 (scoped): while a Tie's question is still open, the Map's side panel offers the same options the Ask
// card does, and clicking one answers it through the same /api/answer path — not a second way to decide, a second
// place to act on the one open question (docs/design/run-api-panel-and-wires.md §4, per the comments on LIN-90:
// this only works while the question is still open; a Tie already skipped/settled has no chooser here yet).
// POST /api/demo/release is now scoped to a named run (or grace-limited when unnamed, src/demo-server.mjs), so a
// different spec's page teardown can no longer skip this run's question before this spec ever sees it open.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// /api/reset deletes the example's saved-answer state files so a real question opens (see below) — but this
// example directory is the same one npm test's golden-output fixtures depend on (e2e's server has no isolated
// examples copy, LIN-90 comments), so snapshot and restore exactly what reset touches, pass or fail.
const invoicesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "examples", "invoices");
const STATE_FILES = ["answers.json", "decisions.json", "ai-cache.json", "answers.history.jsonl"];

test("the Map offers an open Tie's own options, and answering one there closes the Ask", async ({ page }) => {
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
  // The demo replays saved answers by default (useSaved: true) so the scripted walkthrough never re-asks; reset
  // this example's saved answers first so "Wire it" actually pauses on a live question, same as a first run would.
  await page.evaluate(() => fetch("/api/reset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ example: "invoices" }) }));
  await page.locator('.scen-card[data-id="invoices"]').click();
  const wireButton = page.locator("#bWire");
  await expect(wireButton).toBeEnabled({ timeout: 15_000 });
  await wireButton.click();

  // The first open Ask/Tie: paintTree marks the part currently being asked about with [data-asking], carrying
  // the term ("tie") it already had (src/ui/demo.mjs's paintTree sets el.dataset.part = term).
  const asking = page.locator("[data-asking]").first();
  await expect(asking).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(async () => (await asking.evaluate((el) => el.dataset.part)), { timeout: 15_000 })
    .toBe("tie");
  const partId = await asking.evaluate((el) => el.dataset.id);

  await page.locator("#vMap").click();
  await page.waitForFunction((id) => window.__trace?.map?.index?.nodes?.some((n) => n.id === id), partId);
  const hit = await page.evaluate((id) => {
    const t = window.__trace, idx = t.map.index, v = t.map.view;
    const n = idx.nodes.find((n) => n.id === id);
    const r = document.querySelector("#mapCanvas").getBoundingClientRect();
    return { x: r.left + (n.x + n.w / 2) * v.k + v.tx, y: r.top + (n.y + n.h / 2) * v.k + v.ty };
  }, partId);
  await page.mouse.click(hit.x, hit.y);

  const chooser = page.locator(".mp-attach");
  await expect(chooser).toBeVisible();
  const options = chooser.locator(".opt");
  await expect(options.first()).toBeVisible();

  await options.first().click();
  await expect(page.locator(`[data-id="${partId}"][data-asking]`)).toHaveCount(0, { timeout: 15_000 });
}
