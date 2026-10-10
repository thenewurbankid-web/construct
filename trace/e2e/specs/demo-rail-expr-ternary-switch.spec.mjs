// LIN-224 — the "ternary" and "switch" managed-expression kinds (docs/design/mark-as-list-managed-expressions.md),
// extended from LIN-201/R6.50's "if" kind: a `cond ? <X/> : <Y/>` and a 3+-link chained ternary/lookup each show
// up as their own row in "the trace, as a list" with the same ⚡ glyph, and bind to a real API field from the
// rail, same as demo-rail-expr-if.spec.mjs.
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

async function openTraceList(page) {
  const skipRest = page.locator("[data-skiprest]");
  await skipRest.waitFor({ state: "visible", timeout: 15_000 }).catch(() => {});
  if (await skipRest.isVisible()) await skipRest.click();
  const details = page.locator("#traceDetails");
  if (!(await details.evaluate((el) => el.open))) await details.locator("summary").click();
}

// Runs the same bind / reload-and-recover / undo sequence demo-rail-expr-if.spec.mjs runs for "if", against
// whichever row's name starts with `labelPrefix` ("Ternary:" or "Switch:" -- orders/page.jsx has one of each: the
// synced/not-synced ternary and the None/Low/Medium/High chained-ternary switch).
function railBindTest(kind, labelPrefix) {
  test(`the rail shows a ⚡ row for a ${kind}, and binding it to a field flips the row to fit`, async ({ page }) => {
    await page.request.post("/api/reset", { data: { example: "orders" } });
    await page.goto("/");
    await wireOrders(page);
    await openTraceList(page);

    const row = page.locator(".tl-btn", { hasText: labelPrefix }).first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row.locator(".expr-glyph")).toBeVisible();
    await expect(row.locator("i.sw")).toHaveClass(/\bgap\b/);
    const partId = await row.getAttribute("data-part");

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

    await expect(row.locator("i.sw")).toHaveClass(/\bfit\b/, { timeout: 10_000 });
    await expect(row.locator(".tl-where")).toContainText("from");

    // The bind persists through /api/part-apply (answers.json), same as "if" (LIN-221) -- a hard reload (no
    // /api/reset, which would erase the persisted bind) must still show it as fit.
    await page.reload();
    await wireOrders(page);
    await openTraceList(page);
    const rowAfterReload = page.locator(`.tl-btn[data-part="${partId}"]`);
    await expect(rowAfterReload).toBeVisible({ timeout: 15_000 });
    await expect(rowAfterReload.locator("i.sw")).toHaveClass(/\bfit\b/, { timeout: 15_000 });
    await expect(rowAfterReload.locator(".tl-where")).toContainText("from");

    // Undo reverts the whole answers.json[id] entry, bind included -- back to a gap row on the next reload.
    const undoRes = await page.request.post("/api/part-undo", { data: { example: "orders", id: partId } });
    expect(undoRes.ok()).toBeTruthy();
    await page.reload();
    await wireOrders(page);
    await openTraceList(page);
    const rowAfterUndo = page.locator(`.tl-btn[data-part="${partId}"]`);
    await expect(rowAfterUndo).toBeVisible({ timeout: 15_000 });
    await expect(rowAfterUndo.locator("i.sw")).toHaveClass(/\bgap\b/, { timeout: 15_000 });
  });
}

railBindTest("ternary", "Ternary:");
railBindTest("switch", "Switch:");
