// LIN-201 R6.45 — the third of 5 planned "managed template-expression" kinds (docs/design/
// mark-as-list-managed-expressions.md): a `cond ? <X/> : <Y/>` ternary the rules find in the page's own markup
// (both branches present) shows up as a rule-default "Make it conditional" option, applied/undone through the
// existing Apply/Undo mechanism every other part already uses -- not a new panel, not a new write path.
import { test, expect } from "@playwright/test";

// LIN-106's run-start "story gate" blocks orders' Wire it until Confirm or Skip is clicked (same helper as
// demo-expr-if.spec.mjs / demo-expr-list.spec.mjs) -- not this ticket's concern, just a prerequisite to get past.
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

test("a detected ternary (both branches) offers a rule-default 'Make it conditional' option, reversible via Undo", async ({ page }) => {
  await page.request.post("/api/reset", { data: { example: "orders" } });
  await page.goto("/");
  await wireOrders(page);

  const skipRest = page.locator("[data-skiprest]");
  await skipRest.waitFor({ state: "visible", timeout: 15_000 }).catch(() => {});
  if (await skipRest.isVisible()) await skipRest.click();

  // "Conditional rendering" is shared with the "if" kind (R6.43); this ternary (orders' page.jsx now has a
  // `orderCount > 0 ? <span/> : <span/>` sync-status badge, added for this feature) shows up in the same section.
  const exprHeading = page.locator(".pl-h", { hasText: "Conditional rendering" });
  await expect(exprHeading).toBeVisible({ timeout: 15_000 });
  const exprItem = page.getByRole("button", { name: "Ternary: orderCount > 0" });
  await expect(exprItem).toBeVisible();
  await exprItem.click();

  const panel = page.locator(".pi[role='dialog']");
  await expect(panel).toBeVisible({ timeout: 10_000 });
  const option = panel.locator('[data-opt^="exprKind."]').first();
  await expect(option).toBeVisible();
  await expect(option).toContainText("Make it conditional");
  await expect(option).toContainText("Rule default");
  await expect(option).not.toHaveClass(/\bnow\b/); // not applied yet

  await option.click();

  // The ternary body (docs/design §4b): the condition's own text, and the Then/Else branches' real JSX source
  // (states.mjs's own branch records, not placeholders) -- "orderCount" has no matching API field (the orders
  // fixture's own "about" note: no envelope, no orderCount in the contract), so the condition is a correct Gap.
  const body = panel.locator(".pi-exprbody");
  await expect(body).toBeVisible();
  await expect(body).toContainText("orderCount > 0");
  await expect(body).toContainText("Gap");
  await expect(body).toContainText("Synced");
  await expect(body).toContainText("Not synced");

  const applyBtn = panel.locator("[data-apply]");
  await expect(applyBtn).toBeEnabled();
  await applyBtn.click();

  // Applied: the option now shows "In use now" and Undo is enabled.
  await expect(option).toContainText("In use now", { timeout: 10_000 });
  const undoBtn = panel.locator("[data-undo]");
  await expect(undoBtn).toBeEnabled();

  await undoBtn.click();
  await expect(option).not.toContainText("In use now", { timeout: 10_000 });
});
