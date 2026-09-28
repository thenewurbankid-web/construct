// T16.8 — the studio ("/studio"): the full pipeline UI (pick an example, Start, watch the tree grow). Its
// state lives in one inline <script type="module"> in src/ui/index.html, driven entirely by real fetches to
// the running server (/api/examples, /api/run, /api/events) — nothing here is reachable from a node:test that
// only imports pure helpers, so this is the first check that the page and the server actually talk to each
// other end to end.
import { test, expect } from "@playwright/test";

test("loads with the example picker populated", async ({ page }) => {
  await page.goto("/studio");
  await expect(page).toHaveTitle(/Trace/);
  const options = page.locator("#exsel option");
  await expect(options).not.toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator("#bStart")).toHaveText("Start");
});

test("Auto runs the real pipeline for an example without asking questions", async ({ page }) => {
  await page.goto("/studio");
  await page.locator("#exsel").selectOption("categories");
  // Auto (never Start): Start can block on an interactive Ask (e.g. categories has one open item per
  // docs/CONCEPT.md), which nothing here answers; Auto always finishes on its own.
  await page.locator("#bAuto").click();
  await expect(page.locator("#bStart")).toHaveText("Run again", { timeout: 20_000 });
});
