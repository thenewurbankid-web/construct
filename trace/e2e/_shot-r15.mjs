import { chromium } from "playwright";

const shotsDir = "/Users/shashank/Repositories/construct/trace/src/ui/changelog/shots";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://localhost:4210/changelog");
await page.waitForSelector("#h-next", { timeout: 15000 });
await page.waitForSelector(".next .badge-building", { timeout: 15000 });

// R6.15: the "Coming next" section, with the Building now badge and the indented change bullets visible
const section = page.locator("section:has(#h-next)");
await section.screenshot({ path: `${shotsDir}/R6.15.jpg`, type: "jpeg" });

await browser.close();
console.log("done");
