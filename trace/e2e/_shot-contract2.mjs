import { chromium } from "playwright";

const shotsDir = "/Users/shashank/Repositories/construct/trace/src/ui/changelog/shots";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.goto("http://localhost:4210/?canvasdebug");
await page.locator('.scen-card[data-id="orders"]').click();
const wireButton = page.locator("#bWire");
await page.waitForFunction(() => document.querySelector("#bWire") && !document.querySelector("#bWire").disabled, undefined, { timeout: 15000 });
await wireButton.click();
await page.locator("#s-fit").waitFor({ state: "visible", timeout: 15000 });
await page.waitForFunction(() => document.querySelector("#pv [data-part]"), undefined, { timeout: 15000 });

await page.locator("#vMap").click();
await page.waitForFunction(() => window.__trace?.map?.index?.nodes?.some((n) => n.id.startsWith("ep:")), undefined, { timeout: 15000 });

const hit = await page.evaluate(() => {
  const t = window.__trace, idx = t.map.index, v = t.map.view;
  const n = idx.nodes.find((n) => n.id.startsWith("ep:"));
  const r = document.querySelector("#mapCanvas").getBoundingClientRect();
  return { x: r.left + (n.x + n.w / 2) * v.k + v.tx, y: r.top + (n.y + n.h / 2) * v.k + v.ty };
});
await page.mouse.click(hit.x, hit.y);
await page.locator(".ep-panel").waitFor({ state: "visible", timeout: 10000 });

await page.locator("#mapPick").screenshot({ path: `${shotsDir}/R6.5.png` });

await browser.close();
console.log("done");
