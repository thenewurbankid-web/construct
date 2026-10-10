import { chromium } from "playwright";

const shotsDir = "/Users/shashank/Repositories/construct/trace/src/ui/changelog/shots";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.goto("http://localhost:4200/changelog");
await page.waitForSelector("#h-next", { timeout: 15000 });
await page.waitForSelector("details", { timeout: 15000 });

// R6.2: the Changelog page itself — just what's visible on load (header + coming next + top releases)
await page.screenshot({ path: `${shotsDir}/R6.2.png`, clip: { x: 0, y: 0, width: 1440, height: 900 } });

await browser.close();
console.log("done");
