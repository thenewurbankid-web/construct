// LIN-201 close-out (R6.49) — the acceptance criterion "a Playwright e2e spec under trace/ covering at least one
// managed expression of each kind end to end before closing" (docs/design/mark-as-list-managed-expressions.md v3).
// The four per-kind specs (demo-expr-if/list/ternary/switch.spec.mjs) each prove one kind in isolation, with its
// own fresh reset; this spec proves all four coexist in ONE run (the Orders scenario, which carries one fixture
// of each by now) and that the fifth kind, "value", is unaffected -- value has no option card of its own (spec
// §4d: it is the default state when no other kind's AST pattern matches), so its coverage here is a regression
// check: a plain `data-dyn` value part still resolves normally alongside four applied managed-expression kinds.
import { test, expect } from "@playwright/test";

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

// Opens a managed-expression part by its accessible name, confirms the rule-default option, applies it.
async function applyExprKind(page, name) {
  const item = page.getByRole("button", { name });
  await expect(item).toBeVisible();
  await item.click();
  const panel = page.locator(".pi[role='dialog']");
  await expect(panel).toBeVisible({ timeout: 10_000 });
  const option = panel.locator('[data-opt^="exprKind."]').first();
  await expect(option).toBeVisible();
  await expect(option).toContainText("Rule default");
  await option.click();
  const applyBtn = panel.locator("[data-apply]");
  await expect(applyBtn).toBeEnabled();
  await applyBtn.click();
  await expect(option).toContainText("In use now", { timeout: 10_000 });
  await panel.locator("[aria-label='Close the inspector']").click();
}

test("if, list, ternary and switch all apply in one run without interfering, value parts still resolve normally", async ({ page }) => {
  await page.request.post("/api/reset", { data: { example: "orders" } });
  await page.goto("/");
  await wireOrders(page);

  const skipRest = page.locator("[data-skiprest]");
  await skipRest.waitFor({ state: "visible", timeout: 15_000 }).catch(() => {});
  if (await skipRest.isVisible()) await skipRest.click();

  // The done card renders: four managed-expression sections (two share "Conditional rendering": if + ternary).
  await expect(page.locator(".pl-h", { hasText: "Conditional rendering" })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".pl-h", { hasText: "Repeated rows (lists)" })).toBeVisible();
  await expect(page.locator(".pl-h", { hasText: "Lookup / switch" })).toBeVisible();

  // Name prefixes only (not anchored at the end): once applied, the part list button gains a trailing "Edited by
  // you" badge (`partListHtml`, `inspector.mjs:428`) that extends its accessible name.
  const names = [/^Conditional: orderCount === 0/, /^List: <li>/, /^Ternary: orderCount > 0/, /^Switch: orderCount/];

  // Apply all four kinds in the same run, in source order (if, list, ternary, switch).
  for (const name of names) await applyExprKind(page, name);

  // Re-open each one: all four stay independently applied (no cross-kind interference through shared history/answers).
  for (const name of names) {
    await page.getByRole("button", { name }).click();
    const panel = page.locator(".pi[role='dialog']");
    await expect(panel).toBeVisible({ timeout: 10_000 });
    await expect(panel.locator('[data-opt^="exprKind."]').first()).toContainText("In use now");
    await panel.locator("[aria-label='Close the inspector']").click();
  }

  // Value: an ordinary `data-dyn` value part (the header's order count) is untouched by any of the above -- it is
  // still a real, already-fit matcher part, never one of the four synthetic exprKind parts just applied, and the
  // page is still showing its designed value ("3 orders"), not a Gap or an error from the exprKind machinery.
  await expect(page.locator("#buildStrip")).toBeVisible();
  await expect(page.getByText("3 orders", { exact: false }).first()).toBeVisible();
});
