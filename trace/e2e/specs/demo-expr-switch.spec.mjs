// LIN-201 — the fourth of 5 planned "managed template-expression" kinds (docs/design/
// mark-as-list-managed-expressions.md): a chained ternary with 3+ links (`a===x?A:a===y?B:a===z?C:D`) the rules
// find in a plain value expression shows up as a rule-default "Make it a switch" option, applied/undone through
// the existing Apply/Undo mechanism every other kind already uses -- not a new panel, not a new write path.
import { test, expect } from "@playwright/test";

// LIN-106's run-start "story gate" blocks orders' Wire it until Confirm or Skip is clicked (same helper as the
// other demo-expr-*.spec.mjs files) -- not this ticket's concern, just a prerequisite to get past.
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

test("a detected chained ternary (3+ links) offers a rule-default 'Make it a switch' option, reversible via Undo", async ({ page }) => {
  await page.request.post("/api/reset", { data: { example: "orders" } });
  await page.goto("/");
  await wireOrders(page);

  const skipRest = page.locator("[data-skiprest]");
  await skipRest.waitFor({ state: "visible", timeout: 15_000 }).catch(() => {});
  if (await skipRest.isVisible()) await skipRest.click();

  // orders' page.jsx now has a `orderCount === 0 ? "None" : orderCount < 5 ? "Low" : orderCount < 20 ? "Medium" :
  // "High"` volume label (3 links), added for this feature -- its own "Lookup / switch" section.
  const exprHeading = page.locator(".pl-h", { hasText: "Lookup / switch" });
  await expect(exprHeading).toBeVisible({ timeout: 15_000 });
  const exprItem = page.getByRole("button", { name: "Switch: orderCount" });
  await expect(exprItem).toBeVisible();
  await exprItem.click();

  const panel = page.locator(".pi[role='dialog']");
  await expect(panel).toBeVisible({ timeout: 10_000 });
  const option = panel.locator('[data-opt^="exprKind."]').first();
  await expect(option).toBeVisible();
  await expect(option).toContainText("Make it a switch");
  await expect(option).toContainText("Rule default");
  await expect(option).not.toHaveClass(/\bnow\b/); // not applied yet

  await option.click();

  // The switch body (docs/design §4c): the discriminant and a per-case table split from the chain's own `?`/`:`
  // structure -- the first link is a plain equality ("orderCount === 0") so it resolves to a real case value
  // ("0" -> "None"); the later links are range comparisons ("< 5", "< 20"), not equalities, so they stay as their
  // own condition text with a Gap verdict (never guessed into a fabricated discriminant value), plus the trailing
  // default ("High").
  const body = panel.locator(".pi-exprbody");
  await expect(body).toBeVisible();
  await expect(body).toContainText("orderCount");
  await expect(body).toContainText("None");
  await expect(body).toContainText("Low");
  await expect(body).toContainText("Medium");
  await expect(body).toContainText("High");
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

// LIN-248: the other half of the "switch" kind -- a `LOOKUP[x]` lookup-object dispatch (orders' header now also
// carries `STATUS_BADGE[status]`, its own independent "Switch: status" part, distinct from "Switch: orderCount"
// above). Every case in a lookup object is a literal fit (no range-comparison gaps the way a ternary chain can
// have), and there is no trailing default (options.mjs:231/233) -- so this test expects no "Gap" anywhere in the
// body, unlike the chained-ternary test above.
test("a detected LOOKUP[x] lookup object offers the same rule-default 'Make it a switch' option, all cases a fit, reversible via Undo", async ({ page }) => {
  await page.request.post("/api/reset", { data: { example: "orders" } });
  await page.goto("/");
  await wireOrders(page);

  const skipRest = page.locator("[data-skiprest]");
  await skipRest.waitFor({ state: "visible", timeout: 15_000 }).catch(() => {});
  if (await skipRest.isVisible()) await skipRest.click();

  const exprHeading = page.locator(".pl-h", { hasText: "Lookup / switch" });
  await expect(exprHeading).toBeVisible({ timeout: 15_000 });
  const exprItem = page.getByRole("button", { name: "Switch: status" });
  await expect(exprItem).toBeVisible();
  await exprItem.click();

  const panel = page.locator(".pi[role='dialog']");
  await expect(panel).toBeVisible({ timeout: 10_000 });
  const option = panel.locator('[data-opt^="exprKind."]').first();
  await expect(option).toBeVisible();
  await expect(option).toContainText("Make it a switch");
  await expect(option).toContainText("Rule default");
  await expect(option).not.toHaveClass(/\bnow\b/); // not applied yet

  await option.click();

  // The Discriminant fieldset can independently show "Gap" (orders' base openapi.json deliberately has no
  // "status" field yet -- feature.json's own "Missing API" story -- so the discriminant itself doesn't resolve
  // to a real field); that is unrelated to parseLookupObject. What this test checks is the Cases fieldset: every
  // lookup-object case is a literal fit, never a gap, unlike the chained-ternary test above.
  const body = panel.locator(".pi-exprbody");
  await expect(body).toBeVisible();
  await expect(body).toContainText("Shipped");
  await expect(body).toContainText("Pending");
  const casesFieldset = body.locator("fieldset:has(legend:text-is('Cases'))");
  await expect(casesFieldset).not.toContainText("Gap");

  const applyBtn = panel.locator("[data-apply]");
  await expect(applyBtn).toBeEnabled();
  await applyBtn.click();

  await expect(option).toContainText("In use now", { timeout: 10_000 });
  const undoBtn = panel.locator("[data-undo]");
  await expect(undoBtn).toBeEnabled();

  await undoBtn.click();
  await expect(option).not.toContainText("In use now", { timeout: 10_000 });
});
