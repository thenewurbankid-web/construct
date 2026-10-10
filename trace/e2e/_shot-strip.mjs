import { chromium } from "playwright";

const shotsDir = "/Users/shashank/Repositories/construct/trace/src/ui/changelog/shots";
const port = process.argv[2] || "47301";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.goto(`http://localhost:${port}/`);
const wireButton = page.locator("#bWire");
await wireButton.waitFor({ state: "visible", timeout: 15000 });
await page.waitForFunction(() => !document.querySelector("#bWire")?.disabled, { timeout: 15000 });
await wireButton.click();
await page.waitForFunction(() => document.querySelector("#buildStrip")?.textContent?.trim().length > 0, { timeout: 20000 });

// R6.17: the header's slim summary strip, next to the release badge — replaces the old tall ring card
await page.locator("header.top#top").screenshot({ path: `${shotsDir}/R6.17.jpg`, type: "jpeg" });

await browser.close();
console.log("done");
