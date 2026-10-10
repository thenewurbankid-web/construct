import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const shotsDir = "/Users/shashank/Repositories/construct/trace/src/ui/changelog/shots";
const invoicesDir = "/Users/shashank/Repositories/construct/trace/examples/invoices";
const STATE_FILES = ["answers.json", "decisions.json", "ai-cache.json", "answers.history.jsonl"];

const before = STATE_FILES.map((f) => {
  const p = path.join(invoicesDir, f);
  return [p, fs.existsSync(p) ? fs.readFileSync(p) : null];
});
const restore = () => { for (const [p, buf] of before) { if (buf === null) fs.rmSync(p, { force: true }); else fs.writeFileSync(p, buf); } };

try {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  await page.goto("http://localhost:4210/?canvasdebug");
  await page.evaluate(() => fetch("/api/reset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ example: "invoices" }) }));
  await page.locator('.scen-card[data-id="invoices"]').click();
  const wireButton = page.locator("#bWire");
  await page.waitForFunction(() => document.querySelector("#bWire") && !document.querySelector("#bWire").disabled, undefined, { timeout: 15000 });
  await wireButton.click();

  const asking = page.locator("[data-asking]").first();
  await asking.waitFor({ state: "visible", timeout: 15000 });
  await page.waitForFunction(() => document.querySelector("[data-asking]")?.dataset.part === "tie", undefined, { timeout: 15000 });
  const partId = await asking.evaluate((el) => el.dataset.id);

  await page.locator("#vMap").click();
  await page.waitForFunction((id) => window.__trace?.map?.index?.nodes?.some((n) => n.id === id), partId, { timeout: 15000 });
  const hit = await page.evaluate((id) => {
    const t = window.__trace, idx = t.map.index, v = t.map.view;
    const n = idx.nodes.find((n) => n.id === id);
    const r = document.querySelector("#mapCanvas").getBoundingClientRect();
    return { x: r.left + (n.x + n.w / 2) * v.k + v.tx, y: r.top + (n.y + n.h / 2) * v.k + v.ty };
  }, partId);
  await page.mouse.click(hit.x, hit.y);

  const chooser = page.locator(".mp-attach");
  await chooser.waitFor({ state: "visible", timeout: 10000 });

  await page.locator("#mapPick").screenshot({ path: `${shotsDir}/R6.6.png` });

  await browser.close();
  console.log("done");
} finally {
  restore();
}
