// LIN-201 R6.44 — the second of 5 planned "managed template-expression" kinds (docs/design/
// mark-as-list-managed-expressions.md): a raw `.map()` group the rules find in the page's own markup, with no
// `data-list` marker yet, shows up as a rule-default "Make it a list" option, applied/undone through the existing
// Apply/Undo mechanism every other part already uses -- not a new panel, not a new write path.
import { test, expect } from "@playwright/test";

// LIN-106's run-start "story gate" blocks orders' Wire it until Confirm or Skip is clicked (same helper as
// demo-expr-if.spec.mjs) -- not this ticket's concern, just a prerequisite to get past.
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

test("a detected raw .map() list offers a rule-default 'Make it a list' option, reversible via Undo", async ({ page }) => {
  await page.request.post("/api/reset", { data: { example: "orders" } });
  await page.goto("/");
  await wireOrders(page);

  const skipRest = page.locator("[data-skiprest]");
  await skipRest.waitFor({ state: "visible", timeout: 15_000 }).catch(() => {});
  if (await skipRest.isVisible()) await skipRest.click();

  // The done card's "Repeated rows (lists)" list is new: it only shows up once the rules have found at least one
  // `.map()` group with no `data-list` marker (orders' page.jsx now has one -- a `highlightTags.map()` list of
  // tags -- added for this feature).
  const exprHeading = page.locator(".pl-h", { hasText: "Repeated rows (lists)" });
  await expect(exprHeading).toBeVisible({ timeout: 15_000 });
  const exprItem = page.getByRole("button", { name: "List: <li>" });
  await expect(exprItem).toBeVisible();
  await exprItem.click();

  const panel = page.locator(".pi[role='dialog']");
  await expect(panel).toBeVisible({ timeout: 10_000 });
  const option = panel.locator('[data-opt^="exprKind."]').first();
  await expect(option).toBeVisible();
  await expect(option).toContainText("Make it a list");
  await expect(option).toContainText("Rule default");
  await expect(option).not.toHaveClass(/\bnow\b/); // not applied yet

  await option.click();

  // The list body (docs/design §4a): a source-list radio (the one matching API list, pre-selected) and an
  // item-field table, one row per field the item template (`{tag}`) actually references -- here the bare item
  // itself (no `.field` access), so one row named "value" with a Gap verdict (there is no API list of plain
  // strings for the rules to match it against -- a correct Gap, not a bug).
  const body = panel.locator(".pi-exprbody");
  await expect(body).toBeVisible();
  await expect(body).toContainText("GET /api/orders");
  await expect(body).toContainText("value");
  await expect(body).toContainText("Gap");

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
