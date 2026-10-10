// T16.8 — the Page map ("/pagemap", src/pagemap-routes.mjs -> src/pagemap/service.mjs): a review screen that
// analyses one real example page (GET /api/pagemap/pages, GET /api/pagemap?example=...) and renders a structure
// tree, a wireframe and a node panel entirely by fetch()ing the real server — src/ui/pagemap.mjs's pure helpers
// have no node:test coverage of their own to check against, and the actual analysis (src/pagemap/*.mjs) only
// runs for real once a page is picked, so only a browser can confirm the picker loads, the tree renders real
// nodes for a real example, and clicking a node actually selects it and fills the panel.
import { test, expect } from "@playwright/test";

test("loads the example picker, analyses the default page and renders the structure tree", async ({ page }) => {
  await page.goto("/pagemap");

  // boot() (src/ui/pagemap.mjs) populates #picker from /api/pagemap/pages, then defaults to the "portfolio-figma-1"
  // example (or the first one) and fetches its map — both requests hit the real server.
  await expect(page.locator("#picker option")).not.toHaveCount(0, { timeout: 15_000 });

  // renderSummary() (src/ui/pagemap.mjs) replaces the "Loading..." placeholder with "<N> nodes: ..." once the
  // real analysis for the default example comes back.
  await expect(page.locator("#covText")).toContainText("nodes:", { timeout: 15_000 });
  await expect(page.locator("#covText")).not.toContainText("Loading...");

  // renderTree() (src/ui/pagemap.mjs) fills #tree with one .pm-row per visible node of the real analysed page.
  await expect(page.locator("#tree .pm-row").first()).toBeVisible();
  await expect(page.locator("#tree .pm-row")).not.toHaveCount(0);

  // Before any selection, the node panel shows its empty-state copy (renderPanel(), src/ui/pagemap.mjs).
  await expect(page.locator("#panel")).toContainText("Select a node in the structure or the wireframe.");
});

test("selecting a node in the tree fills the node panel with that node's real proposal", async ({ page }) => {
  await page.goto("/pagemap");
  await expect(page.locator("#tree .pm-row").first()).toBeVisible({ timeout: 15_000 });

  const firstRow = page.locator("#tree .pm-row").first();
  await firstRow.click();

  // select() -> renderPanel() (src/ui/pagemap.mjs) swaps the empty state for a real heading (the node's tag or
  // "Text"/"Page") plus a class chip, and marks the clicked row selected via aria-selected.
  await expect(page.locator("#panel")).not.toContainText("Select a node in the structure or the wireframe.");
  await expect(page.locator("#panel h2")).toBeVisible();
  await expect(page.locator("#panel")).toContainText("Mark this as");
  await expect(firstRow).toHaveAttribute("aria-selected", "true");
});

// LIN-197: a real Subframe .tsx page ("file" mode) gets a 4th "Rendered" tab (the real server-rendered design,
// src/pagemap-routes.mjs's /api/pagemap/render); clicking an element in it selects the matching Page map node,
// because src/subframe-data-id.mjs's injectPmSrc stamps the same line:col buildInventory uses for node ids.
test("a real Subframe page shows a Rendered tab; clicking a rendered element selects its Page map node", async ({ page }) => {
  test.setTimeout(45_000); // the first render of a run cold-starts Vite's SSR module runner
  await page.goto("/pagemap?file=PortfolioHealthFigmaRebuild.tsx");
  await expect(page.locator("#tabRendered")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("#tabRendered")).not.toBeHidden();

  await page.locator("#tabRendered").click();
  const frame = page.frameLocator("#rendered");
  const el = frame.locator("[data-pm-src]").first();
  // The first render of a run cold-starts Vite's SSR module runner (subframe-preview.mjs); generous timeout for that alone.
  await expect(el).toBeVisible({ timeout: 25_000 });
  await el.click();

  // select() -> renderPanel(): the panel fills in with the clicked node's real proposal, same as a tree click.
  await expect(page.locator("#panel")).not.toContainText("Select a node in the structure or the wireframe.");
  await expect(page.locator("#panel h2")).toBeVisible();
  // and the matching tree row is marked selected (aria-selected) — the overlay and the structure agree on the node.
  await expect(page.locator("#tree .pm-row[aria-selected='true']")).toHaveCount(1);
});

// Fallback: a plain-JSX example never gets a Rendered tab (no real-rendered HTML exists for it) — proves the
// overlay is entirely inert for example-mode pages.
test("a plain-JSX example page shows only the original 3 middle tabs, never Rendered", async ({ page }) => {
  await page.goto("/pagemap?example=orders");
  await expect(page.locator("#tabWire")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("#tabOrig")).toBeVisible();
  await expect(page.locator("#tabRendered")).toBeHidden();
});
