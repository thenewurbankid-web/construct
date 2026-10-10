// LIN-90 — clicking an API card (an ep:* node) in the Run screen's Map view opens the API contract panel
// (docs/design/run-api-panel-and-wires.md §3). Real browser only: the panel's content depends on canvas node
// positions and a live pointer click, not just pure functions.
import { test, expect } from "@playwright/test";

// LIN-106 landed a run-start "story gate" for any scenario with no story.md yet (orders is one): Wire it shows
// "Draft story, please confirm" instead of running until Confirm or Skip is clicked. Not this ticket's concern,
// but every spec that presses Wire it on orders needs to get past it.
async function wireOrders(page) {
  await page.locator('.scen-card[data-id="orders"]').click();
  const wireButton = page.locator("#bWire");
  await expect(wireButton).toBeEnabled({ timeout: 15_000 });
  await wireButton.click();
  const skip = page.locator("[data-stskip]");
  if (await skip.isVisible({ timeout: 5_000 }).catch(() => false)) await skip.click();
  await expect(page.locator("#buildStrip")).toBeVisible({ timeout: 15_000 });
}

test("clicking an API card opens the contract panel, Escape closes it", async ({ page }) => {
  await page.goto("/?canvasdebug");
  await wireOrders(page);

  await page.locator("#vMap").click();
  await page.waitForFunction(() => window.__trace?.map?.index?.nodes?.some((n) => n.id.startsWith("ep:")));

  const hit = await page.evaluate(() => {
    const t = window.__trace, idx = t.map.index, v = t.map.view;
    const n = idx.nodes.find((n) => n.id.startsWith("ep:"));
    const r = document.querySelector("#mapCanvas").getBoundingClientRect();
    return { x: r.left + (n.x + n.w / 2) * v.k + v.tx, y: r.top + (n.y + n.h / 2) * v.k + v.ty, id: n.id };
  });

  await page.mouse.click(hit.x, hit.y);
  const panel = page.locator(".ep-panel");
  await expect(panel).toBeVisible();
  await expect(panel.locator(".ep-panel-head code")).toHaveText(hit.id.slice(hit.id.indexOf("/")));
  await expect(panel.locator(".method")).toHaveText(hit.id.slice(3, hit.id.indexOf(" ", 3)));

  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
});

// LIN-90 owner comment 2026-09-29: clicking a Contract rail chip opens an API details card in the right-hand
// column, ABOVE the existing Ask/progress cards (they move down) — it no longer switches to the Map view.
test("a Contract rail chip opens the details card in place, above the progress card, by click and by keyboard", async ({ page }) => {
  await page.goto("/?canvasdebug");
  await wireOrders(page);

  const chip = page.locator("#railEps li.ep[data-ep]").first();
  await expect(chip).toHaveAttribute("tabindex", "0");
  await expect(chip).toHaveAttribute("role", "button");
  const ep = await chip.getAttribute("data-ep");

  const progressTopBefore = await page.locator("#progress").evaluate((el) => el.getBoundingClientRect().top);

  await chip.click();
  await expect(page.locator('#stageMid[data-view="page"]')).toBeVisible(); // no view switch
  const slot = page.locator("#focusSlot");
  await expect(slot).toHaveClass(/\bopen\b/);
  const panel = slot.locator(".ep-panel");
  await expect(panel).toBeVisible();
  await expect(panel.locator(".ep-panel-head code")).toHaveText(ep.slice(ep.indexOf("/")));
  await expect(panel.locator(".method")).toHaveText(ep.slice(0, ep.indexOf(" ")));
  await expect(chip).toHaveClass(/\bactive\b/);
  await expect(chip).toHaveAttribute("aria-pressed", "true");

  const progressTopAfter = await page.locator("#progress").evaluate((el) => el.getBoundingClientRect().top);
  expect(progressTopAfter).toBeGreaterThan(progressTopBefore); // the progress card moved down to make room

  // clicking the same chip again closes it
  await chip.click();
  await expect(slot).not.toHaveClass(/\bopen\b/);
  await expect(chip).toHaveAttribute("aria-pressed", "false");

  // keyboard: focus + Enter opens it, Escape closes it
  await chip.focus();
  await page.keyboard.press("Enter");
  await expect(slot).toHaveClass(/\bopen\b/);
  await expect(panel).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(slot).not.toHaveClass(/\bopen\b/);
});

// The ✕ button inside the card also closes it.
test("the details card's close button closes it", async ({ page }) => {
  await page.goto("/?canvasdebug");
  await wireOrders(page);

  await page.locator("#railEps li.ep[data-ep]").first().click();
  const slot = page.locator("#focusSlot");
  await expect(slot).toHaveClass(/\bopen\b/);
  await slot.locator("[data-close-ep]").click();
  await expect(slot).not.toHaveClass(/\bopen\b/);
});
