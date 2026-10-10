import { chromium } from "playwright";

const shotsDir = "/Users/shashank/Repositories/construct/trace/src/ui/changelog/shots";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.goto("http://localhost:4200/changelog");
await page.waitForSelector("#h-next", { timeout: 15000 });

const section = page.locator("section:has(#h-next)");
await section.screenshot({ path: `${shotsDir}/R6.3.jpg`, type: "jpeg" });

await browser.close();
console.log("done");
