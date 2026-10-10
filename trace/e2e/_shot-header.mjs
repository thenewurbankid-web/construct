import { chromium } from "playwright";

const shotsDir = "/Users/shashank/Repositories/construct/trace/src/ui/changelog/shots";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.goto("http://localhost:4200/");
await page.waitForSelector("#bChangelog", { timeout: 15000 });
await page.waitForFunction(() => document.querySelector("#bBuild")?.textContent?.trim().length > 0, { timeout: 15000 });

// R6.8 (Changelog link) and R6.10 (release badge + Changelog link together) are the same header region
await page.locator("header.top#top").screenshot({ path: `${shotsDir}/R6.8.png` });
await page.locator("header.top#top").screenshot({ path: `${shotsDir}/R6.10.png` });

await browser.close();
console.log("done");
