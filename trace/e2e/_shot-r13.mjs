import { chromium } from "playwright";

const shotsDir = "/Users/shashank/Repositories/construct/trace/src/ui/changelog/shots";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://localhost:4210/quality");
await page.waitForSelector("#h-headline", { timeout: 15000 });
// crop to the section containing the headline metrics summary
const section = page.locator("section:has(#h-headline)");
await section.screenshot({ path: `${shotsDir}/R1.3.png` });
await browser.close();
console.log("done");
