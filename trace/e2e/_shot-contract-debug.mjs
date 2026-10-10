import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.goto("http://localhost:4200/?canvasdebug");
await page.locator('.scen-card[data-id="orders"]').click();
const wireButton = page.locator("#bWire");
await page.waitForFunction(() => document.querySelector("#bWire") && !document.querySelector("#bWire").disabled, undefined, { timeout: 15000 });
await wireButton.click();
await page.locator("#s-fit").waitFor({ state: "visible", timeout: 15000 });
await page.waitForFunction(() => document.querySelector("#pv [data-part]"), undefined, { timeout: 15000 });
console.log("wired, ringNum:", await page.locator("#ringNum").textContent());

await page.locator("#vMap").click();
await page.waitForTimeout(1500);
const hasTrace = await page.evaluate(() => !!window.__trace);
console.log("has __trace:", hasTrace);
const nodes = await page.evaluate(() => window.__trace?.map?.index?.nodes?.map(n => n.id) ?? null);
console.log("nodes:", nodes);
await page.screenshot({ path: "/tmp/debug1.png" });
await browser.close();
