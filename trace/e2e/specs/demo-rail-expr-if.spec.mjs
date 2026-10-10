// LIN-201 R6.50 — the "if" managed-expression kind (docs/design/mark-as-list-managed-expressions.md), wired
// through to the live-run rail: a `cond && <X/>` conditional with no else branch shows up as its own row in
// "the trace, as a list" with a ⚡ glyph, and its condition can be bound to a real API field from the rail.
import { test, expect } from "@playwright/test";

// LIN-106's run-start "story gate" blocks orders' Wire it until Confirm or Skip is clicked (same helper as
// demo-map-contract-panel.spec.mjs) -- not this ticket's concern, just a prerequisite to get past.
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

test("the rail shows a ⚡ row for an unguarded conditional, and binding it to a field flips the row to fit", async ({ page }) => {
  await page.request.post("/api/reset", { data: { example: "orders" } });
  await page.goto("/");
  await wireOrders(page);

  // Orders ("Lots of Asks") pauses for its own Asks before the rail settles; skip straight to the result.
  const skipRest = page.locator("[data-skiprest]");
  await skipRest.waitFor({ state: "visible", timeout: 15_000 }).catch(() => {});
  if (await skipRest.isVisible()) await skipRest.click();

  // "The trace, as a list" is a collapsed <details> by default.
  const details = page.locator("#traceDetails");
  if (!(await details.evaluate((el) => el.open))) await details.locator("summary").click();

  const row = page.locator('.tl-btn:has(.expr-glyph)').first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row.locator(".tl-name")).toContainText("Conditional:");
  await expect(row.locator("i.sw")).toHaveClass(/\bgap\b/);
  const partId = await row.getAttribute("data-part");

  // Open any endpoint's own details from the Contract rail -- that's where "Bind this condition" lives.
  const chip = page.locator("#railEps li.ep[data-ep]").first();
  await expect(chip).toBeVisible({ timeout: 15_000 });
  await chip.click();
  const panel = page.locator("#focusSlot .ep-panel");
  await expect(panel).toBeVisible({ timeout: 10_000 });

  const bindHeading = panel.locator("h4", { hasText: "Bind this condition" });
  await expect(bindHeading).toBeVisible({ timeout: 10_000 });
  const bindBtn = panel.locator(`[data-bind-expr="${partId}"]`).first();
  await expect(bindBtn).toBeVisible();
  await bindBtn.click();

  // The bind flips the row to fit immediately, with the field it bound to.
  await expect(row.locator("i.sw")).toHaveClass(/\bfit\b/, { timeout: 10_000 });
  await expect(row.locator(".tl-where")).toContainText("from");

  // LIN-221: the bind now persists through /api/part-apply (answers.json), not just the client-side Map --
  // a hard reload (no /api/reset, which would erase the persisted bind) must still show it as fit.
  await page.reload();
  await wireOrders(page);
  const skipRestAfterReload = page.locator("[data-skiprest]");
  await skipRestAfterReload.waitFor({ state: "visible", timeout: 15_000 }).catch(() => {});
  if (await skipRestAfterReload.isVisible()) await skipRestAfterReload.click();
  const detailsAfterReload = page.locator("#traceDetails");
  if (!(await detailsAfterReload.evaluate((el) => el.open))) await detailsAfterReload.locator("summary").click();
  const rowAfterReload = page.locator(`.tl-btn[data-part="${partId}"]`);
  await expect(rowAfterReload).toBeVisible({ timeout: 15_000 });
  await expect(rowAfterReload.locator("i.sw")).toHaveClass(/\bfit\b/, { timeout: 15_000 });
  await expect(rowAfterReload.locator(".tl-where")).toContainText("from");

  // Undo reverts the whole answers.json[id] entry, bind included -- back to a gap row on the next reload.
  const undoRes = await page.request.post("/api/part-undo", { data: { example: "orders", id: partId } });
  expect(undoRes.ok()).toBeTruthy();
  await page.reload();
  await wireOrders(page);
  const skipRestAfterUndo = page.locator("[data-skiprest]");
  await skipRestAfterUndo.waitFor({ state: "visible", timeout: 15_000 }).catch(() => {});
  if (await skipRestAfterUndo.isVisible()) await skipRestAfterUndo.click();
  const detailsAfterUndo = page.locator("#traceDetails");
  if (!(await detailsAfterUndo.evaluate((el) => el.open))) await detailsAfterUndo.locator("summary").click();
  const rowAfterUndo = page.locator(`.tl-btn[data-part="${partId}"]`);
  await expect(rowAfterUndo).toBeVisible({ timeout: 15_000 });
  await expect(rowAfterUndo.locator("i.sw")).toHaveClass(/\bgap\b/, { timeout: 15_000 });
});
