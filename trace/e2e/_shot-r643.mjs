// LIN-201 R6.43 screenshot: the demo shell's done card for Orders, showing the new "Conditional rendering"
// list and the opened inspector panel with the rule-default "Make it conditional" option.
import { chromium } from "@playwright/test";

const BASE = "http://127.0.0.1:48711";

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.request.post(`${BASE}/api/reset`, { data: { example: "orders" } });
  await page.goto(BASE + "/");
  await page.locator('.scen-card[data-id="orders"]').click();
  await page.locator("#bWire").click();
  const skip = page.locator("[data-stskip]");
  await skip.waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
  if (await skip.isVisible()) await skip.click();
  await page.locator("#buildStrip").waitFor({ state: "visible", timeout: 15000 });
  const skipRest = page.locator("[data-skiprest]");
  await skipRest.waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
  if (await skipRest.isVisible()) await skipRest.click();
  const exprItem = page.getByRole("button", { name: "Conditional: orderCount === 0" });
  await exprItem.waitFor({ state: "visible", timeout: 15000 });
  await exprItem.click();
  await page.locator(".pi[role='dialog']").waitFor({ state: "visible", timeout: 10000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: "src/ui/changelog/shots/R6.43.jpg", fullPage: false });
  await browser.close();
  console.log("Saved src/ui/changelog/shots/R6.43.jpg");
}

main().catch((e) => { console.error(e); process.exit(1); });
