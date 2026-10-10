// LIN-224 §5 ("list"): the endpoint panel's "Fields used by this run" list groups a list's item fields
// (list.number, list.customer, ...) under one row named for the list, with a ×N count badge, instead of one
// flat <li> per field (docs/design/mark-as-list-managed-expressions.md §5, bullet "List"). The individual
// field links underneath are unchanged — same `data-part`, same click target — just nested.
import { test, expect } from "@playwright/test";

// LIN-106's run-start "story gate" blocks orders' Wire it until Confirm or Skip is clicked (same helper as
// demo-rail-expr-if.spec.mjs) -- not this ticket's concern, just a prerequisite to get past.
async function wireOrders(page) {
  await page.locator('.scen-card[data-id="orders"]').click();
  const wireButton = page.locator("#bWire");
  await expect(wireButton).toBeEnabled({ timeout: 15_000 });
  await wireButton.click();
  const skip = page.locator("[data-stskip]");
  await skip.waitFor({ state: "visible", timeout: 15_000 }).catch(() => {});
  if (await skip.isVisible()) await skip.click();
  await expect(page.locator("#buildStrip")).toBeVisible({ timeout: 15_000 });
}

test("the GET /api/orders endpoint panel groups its list fields under one ×N row, and the nested field links still work", async ({ page }) => {
  await page.request.post("/api/reset", { data: { example: "orders" } });
  await page.goto("/");
  await wireOrders(page);

  // Orders ("Lots of Asks") pauses for its own Asks before the rail settles; skip straight to the result.
  const skipRest = page.locator("[data-skiprest]");
  await skipRest.waitFor({ state: "visible", timeout: 15_000 }).catch(() => {});
  if (await skipRest.isVisible()) await skipRest.click();

  // The rail lists every endpoint of the contract; pick GET /api/orders specifically (there's also a POST/PUT).
  const chip = page.locator('#railEps li.ep[data-ep="GET /api/orders"]');
  await expect(chip).toBeVisible({ timeout: 15_000 });
  await chip.click();

  const panel = page.locator("#focusSlot .ep-panel");
  await expect(panel).toBeVisible({ timeout: 10_000 });

  const group = panel.locator(".ep-field-group");
  await expect(group).toBeVisible({ timeout: 10_000 });

  const fieldLinks = group.locator('.ep-field-link[data-part^="list."]');
  const n = await fieldLinks.count();
  expect(n).toBeGreaterThanOrEqual(2); // several list fields fit this run; exact count depends on fit vs tie matching

  const badge = group.locator(".ep-field-group-head .ep-n");
  await expect(badge).toHaveText(`×${n}`);

  // The nested field links are the same ep-field-link rows as before grouping: clicking one still opens that
  // part's own details (partDetailsHtml), replacing the endpoint panel in the same focus slot.
  const firstLink = fieldLinks.first();
  const partId = await firstLink.getAttribute("data-part");
  await firstLink.click();

  const detailsPanel = page.locator("#focusSlot .ep-panel");
  await expect(detailsPanel.locator(`[data-show="${partId}"]`)).toBeVisible({ timeout: 10_000 });
});
