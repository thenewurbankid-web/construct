import { chromium } from "playwright";

const shotsDir = "/Users/shashank/Repositories/construct/trace/src/ui/changelog/shots";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1400 } });

await page.goto("http://localhost:4200/?canvasdebug");
await page.locator('.scen-card[data-id="orders"]').click();
const wireButton = page.locator("#bWire");
await page.waitForFunction(() => document.querySelector("#bWire") && !document.querySelector("#bWire").disabled, undefined, { timeout: 15000 });
await wireButton.click();
await page.locator("#s-fit").waitFor({ state: "visible", timeout: 15000 });

const skip = page.locator("[data-stskip]");
if (await skip.count()) await skip.click();

await page.waitForFunction(() => document.querySelector("#pv [data-part]"), undefined, { timeout: 20000 });
await page.waitForTimeout(1500);

const chip = page.locator("#railEps li.ep").first();
await chip.waitFor({ state: "visible", timeout: 15000 });
await chip.click();
await page.locator("#focusSlot").waitFor({ state: "visible", timeout: 10000 });
await page.waitForSelector("#focusSlot .field-row, #focusSlot [data-part]", { timeout: 10000 }).catch(() => {});
await page.waitForTimeout(500);

await page.locator(".side").screenshot({ path: `${shotsDir}/R6.18.jpg`, type: "jpeg" });

await browser.close();
console.log("done");
