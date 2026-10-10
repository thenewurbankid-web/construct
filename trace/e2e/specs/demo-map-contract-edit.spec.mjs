// LIN-90 §2 — editing the API contract from the Map's contract panel. Real browser only: the panel's Edit
// depends on a live pointer click and a real fetch round-trip through POST /api/openapi (src/contract-routes.mjs,
// src/ui/canvas/contract-edit.mjs). This spec writes to examples/orders/openapi.json, the same shared fixture
// npm test's golden-output checks read, so it snapshots and restores that file itself (same hazard/pattern as
// demo-map-attach-tie.spec.mjs's examples/invoices handling).
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ordersFile = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "examples", "orders", "openapi.json");

test("Edit in the contract panel: invalid JSON disables Save, a valid Save persists and reloads, Cancel restores", async ({ page }) => {
  const before = fs.readFileSync(ordersFile, "utf8");
  try {
    await runTest(page);
  } finally {
    fs.writeFileSync(ordersFile, before);
  }
});

// LIN-106 landed a run-start "story gate" for any scenario with no story.md yet (orders is one): Wire it shows
// "Draft story, please confirm" instead of running until Confirm or Skip is clicked. Not this ticket's concern,
// but this spec needs to get past it to reach a real run.
async function openOrdersContractPanel(page) {
  await page.goto("/?canvasdebug");
  await page.locator('.scen-card[data-id="orders"]').click();
  const wireButton = page.locator("#bWire");
  await expect(wireButton).toBeEnabled({ timeout: 15_000 });
  await wireButton.click();
  const skip = page.locator("[data-stskip]");
  if (await skip.isVisible({ timeout: 5_000 }).catch(() => false)) await skip.click();
  await expect(page.locator("#buildStrip")).toBeVisible({ timeout: 15_000 });
  await page.locator("#railEps li.ep[data-ep]").filter({ hasText: "orders" }).first().click();
  await expect(page.locator(".ep-panel")).toBeVisible();
}

async function runTest(page) {
  await openOrdersContractPanel(page);

  // Cancel restores the view without saving
  await page.locator("[data-edit-ep]").click();
  const responseBox = page.locator('.ep-edit[data-ep-field="response"]');
  await expect(responseBox).toBeVisible();
  await responseBox.fill("not json");
  await expect(page.locator('.ep-edit-field[data-field="response"] .ct-err')).toBeVisible();
  await expect(page.locator("[data-save-edit]")).toBeDisabled();
  await page.locator("[data-cancel-edit]").click();
  await expect(page.locator(".ep-edit")).toHaveCount(0);
  await expect(page.locator(".ep-json").first()).toContainText("Northwind");

  // A valid Save persists and the view mode shows the new content
  await page.locator("[data-edit-ep]").click();
  const newValue = JSON.stringify([{ id: 1, number: "ORD-EDITED", customer: "Acme", total: 42, placedOn: "2026-09-29" }], null, 2);
  await page.locator('.ep-edit[data-ep-field="response"]').fill(newValue);
  await expect(page.locator("[data-save-edit]")).toBeEnabled();
  await page.locator("[data-save-edit]").click();
  await expect(page.locator(".ep-edit")).toHaveCount(0, { timeout: 10_000 });
  await expect(page.locator(".ep-json").first()).toContainText("ORD-EDITED");
  const saved = JSON.parse(fs.readFileSync(ordersFile, "utf8"));
  expect(saved.paths["/api/orders"].get.responses["200"].content["application/json"].example[0].customer).toBe("Acme");
}
