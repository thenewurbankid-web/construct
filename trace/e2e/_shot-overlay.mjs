import { chromium } from "playwright";

const shotsDir = "/Users/shashank/Repositories/construct/trace/src/ui/changelog/shots";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.goto("http://localhost:4200/?canvasdebug");
await page.locator('.scen-card[data-id="orders"]').click();
const wireButton = page.locator("#bWire");
await wireButton.waitFor({ state: "visible", timeout: 15000 });
await page.waitForFunction(() => document.querySelector("#bWire") && !document.querySelector("#bWire").disabled, { timeout: 15000 });
await wireButton.click();
await page.locator("#s-fit").waitFor({ state: "visible", timeout: 15000 });
await page.waitForFunction(() => document.querySelector("#pv [data-part]"), { timeout: 15000 });

// R6.4: the view toolbar (Page/Map/Overlay)
await page.locator("#viewTools").screenshot({ path: `${shotsDir}/R6.4.png` });

await browser.close();
console.log("done");
