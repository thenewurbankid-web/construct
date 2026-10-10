import { chromium } from "playwright";

const shotsDir = "/Users/shashank/Repositories/construct/trace/src/ui/changelog/shots";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1400 } });

await page.goto("http://localhost:4200/");
await page.locator('.scen-card[data-id="invoices"]').click();
const wireButton = page.locator("#bWire");
await page.waitForFunction(() => document.querySelector("#bWire") && !document.querySelector("#bWire").disabled, undefined, { timeout: 15000 });
await wireButton.click();
await page.locator("#s-fit").waitFor({ state: "visible", timeout: 15000 });
await page.locator("#storyPanel .st-loaded").waitFor({ state: "visible", timeout: 15000 });

await page.locator("#storyPanel").screenshot({ path: `${shotsDir}/R6.16.jpg`, type: "jpeg" });

await browser.close();
console.log("done");
