// LIN-106 — the Story panel on the Run screen ("the fit"), and gating "Wire it" on a confirmed story.
// Uses the "orders" demo scenario (examples/orders), the one demo scenario with no story.md on disk, so this
// spec can write and delete its own story.md without touching a curated fixture. "invoices" already has a
// story.md (old plain-bullet style, still loaded via loadStory's fallback), so it's used for the "no gate" case.
// Real browser only: the gate and editor are DOM/event driven, not pure functions.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ordersStory = path.join(here, "..", "..", "examples", "orders", "story.md");

test.afterAll(() => {
  // Never leave this spec's own fixture mutated: "orders" ships with no story.md.
  fs.rmSync(ordersStory, { force: true });
});

test.beforeEach(() => {
  fs.rmSync(ordersStory, { force: true });
});

test("a story already on disk: no gate on run start", async ({ page }) => {
  await page.goto("/");
  await page.locator('.scen-card[data-id="invoices"]').click();
  const wireButton = page.locator("#bWire");
  await expect(wireButton).toBeEnabled({ timeout: 15_000 });
  await wireButton.click();
  await expect(page.locator("#buildStrip")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("#storyPanel .st-gate")).toHaveCount(0);
});

test("no story: the gate shows and the run doesn't start until acted on", async ({ page }) => {
  await page.goto("/");
  await page.locator('.scen-card[data-id="orders"]').click();
  const wireButton = page.locator("#bWire");
  await expect(wireButton).toBeEnabled({ timeout: 15_000 });
  await wireButton.click();
  await expect(page.locator("#storyPanel .st-gate")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("#storyPanel")).toContainText("Draft story, please confirm");
  // The run never starts while the gate sits unacted-on: no EventSource-driven progress text appears.
  await expect(page.locator("#buildStrip")).toBeHidden();
});

test("Skip: the run starts without a story, with a visible indication", async ({ page }) => {
  await page.goto("/");
  await page.locator('.scen-card[data-id="orders"]').click();
  const wireButton = page.locator("#bWire");
  await expect(wireButton).toBeEnabled({ timeout: 15_000 });
  await wireButton.click();
  await expect(page.locator("#storyPanel .st-gate")).toBeVisible({ timeout: 15_000 });
  await page.locator("#storyPanel [data-stskip]").click();
  await expect(page.locator("#buildStrip")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("#storyPanel")).toContainText("Running without a story.");
  expect(fs.existsSync(ordersStory)).toBe(false);
});

test("Confirm: fill Goal + a criterion, run starts, story.md is written, and running again doesn't re-show the gate", async ({ page }) => {
  await page.goto("/");
  await page.locator('.scen-card[data-id="orders"]').click();
  const wireButton = page.locator("#bWire");
  await expect(wireButton).toBeEnabled({ timeout: 15_000 });
  await wireButton.click();
  const gate = page.locator("#storyPanel .st-gate");
  await expect(gate).toBeVisible({ timeout: 15_000 });
  await gate.locator("[data-stgoal]").fill("As a shopper, I want to see my order status, so that I know when it ships.");
  await gate.locator("[data-stcrit]").first().fill("The status is shown for every order.");
  await gate.locator("[data-stconfirm]").click();
  await expect(page.locator("#buildStrip")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("#storyPanel .st-gate")).toHaveCount(0);

  const written = fs.readFileSync(ordersStory, "utf8");
  expect(written).toContain("## Goal");
  expect(written).toContain("## Acceptance criteria");
  expect(written).toContain("As a shopper, I want to see my order status");

  // Running again (same page, same confirmed decision) never re-shows the gate.
  await page.keyboard.press("Escape"); // back to the Drop in screen (toDrop())
  await wireButton.click();
  await expect(page.locator("#storyPanel .st-gate")).toHaveCount(0);
  await expect(page.locator("#buildStrip")).toBeVisible({ timeout: 15_000 });
});
