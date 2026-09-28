// T16.8 — the Trace demo front door ("/"), the app's most-used screen: pick a curated screen, press Wire it,
// and see the fit ring fill in with real, client-rendered state. This is genuinely a browser-only check: the
// counts and labels only exist after src/ui/demo.mjs runs in a DOM (node:test's fetch-based tests around this
// module — see src/ui/demo.test.mjs — check its pure helpers, never that the browser actually renders this).
import { test, expect } from "@playwright/test";

test("shows the three curated screens and lets you pick one", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".scen-card")).toHaveCount(3);
  await expect(page.locator('.scen-card[data-id="portfolio"]')).toContainText("Portfolio Health");
  await expect(page.locator('.scen-card[data-id="invoices"]')).toContainText("Invoices");
  await expect(page.locator('.scen-card[data-id="orders"]')).toContainText("Orders");

  await page.locator('.scen-card[data-id="invoices"]').click();
  await expect(page.locator('.scen-card[data-id="invoices"]')).toHaveAttribute("aria-checked", "true");
});

test("Wire it runs the real pipeline and fills in the fit ring", async ({ page }) => {
  await page.goto("/");
  // Portfolio Health is the default scenario (SCENARIOS[0] in src/ui/scenarios.mjs); its expect.fit = 8, the
  // number of parts the real API contract explains outright (docs/DEMO.md quotes this same number).
  const wireButton = page.locator("#bWire");
  await expect(wireButton).toBeEnabled({ timeout: 15_000 });
  await wireButton.click();
  await expect(page.locator("#ringNum")).toHaveText("8", { timeout: 15_000 });
});
