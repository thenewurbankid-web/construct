import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.goto("http://localhost:4210/studio");
await page.locator("#exsel").waitFor({ state: "visible", timeout: 15000 });
await page.selectOption("#exsel", "roster");
await page.locator("#bStart").click();
await page.waitForFunction(() => document.querySelector("#pv [data-part]"), undefined, { timeout: 20000 });

const badges = page.locator(".pvb[data-open-part]");
const count = await badges.count();
console.log("badge count:", count);
const ids = await badges.evaluateAll((els) => els.map((e) => e.getAttribute("data-open-part")));
console.log("ids:", ids);

for (let i = 0; i < count; i++) {
  await badges.nth(i).click();
  await page.locator(".pi[role=dialog]").waitFor({ state: "visible", timeout: 10000 });
  const suggestBtn = page.locator("[data-suggest]");
  if (await suggestBtn.count() === 0) { await page.locator(".pi-x").click(); continue; }
  await suggestBtn.click();
  await page.waitForFunction(() => {
    const p = document.querySelector(".pi-sg");
    return p && !p.querySelector(".busy");
  }, undefined, { timeout: 20000 }).catch(() => {});
  const factText = await page.locator(".pi-sg .fact").textContent().catch(() => null);
  console.log("part", ids[i], "fact:", factText);
  if (factText && /goal/i.test(factText)) {
    await page.locator(".pi").screenshot({ path: "/tmp/goal-hit.png" });
    console.log("GOAL HIT on part", ids[i]);
    break;
  }
  await page.locator(".pi-x").click();
  await page.locator(".pi[role=dialog]").waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
}

await browser.close();
console.log("done");
