import { chromium } from "playwright";

const shotsDir = "/Users/shashank/Repositories/construct/trace/src/ui/changelog/shots";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 760 } });

await page.goto("http://localhost:48911/pagemap?example=spacing-demo");
await page.waitForSelector("#wire", { timeout: 15000 });
await page.waitForFunction(() => {
  const f = document.querySelector("#wire");
  return f && f.contentDocument && f.contentDocument.querySelector("[data-pm-gap]");
}, { timeout: 15000 });
await page.waitForTimeout(300);
await page.locator("#wire").screenshot({ path: `${shotsDir}/R6.50.jpg`, quality: 85, type: "jpeg" });

await browser.close();
console.log("done");
