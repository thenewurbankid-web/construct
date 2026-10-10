import { chromium } from "playwright";

const shotsDir = "/Users/shashank/Repositories/construct/trace/src/ui/changelog/shots";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.goto("http://localhost:4200/changelog");
await page.waitForSelector("#h-next", { timeout: 15000 });
await page.waitForSelector("details", { timeout: 15000 });

// R6.2: the Changelog page itself
await page.locator(".wrap").screenshot({ path: `${shotsDir}/R6.2.png` });

// R6.3: the "Coming next" section at top
await page.locator("section:has(#h-next)").screenshot({ path: `${shotsDir}/R6.3.png` });

await browser.close();
console.log("done");
