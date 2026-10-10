// LIN-255/TR-53 — the import wizard's Contract card (Swagger step) shows a "not generated" badge
// (contract-panel.mjs's endpointList, `.ex.no`) on any endpoint that does not drive the generated page's
// list/create/update/remove/summary behavior, even though LIN-250/TR-49 made every endpoint "wired" (callable
// by the generator) regardless of its path-parameter count. describeContract() in src/contract.mjs now
// recomputes a per-endpoint `wired` flag from match.mjs's findEndpoints() roles instead of reusing openapi.mjs's
// own `wired` field (which only ever means "callable at all"). Real browser only: the badge is rendered by the
// wizard's live GET /api/contract round-trip, not reachable from a node:test that only imports pure functions.
import { test, expect } from "@playwright/test";

// examples/orgs-items-reviews has GET/POST /api/items (list/create), PUT/DELETE /api/items/{id} (update/remove),
// and GET /api/orgs/{orgId}/items/{itemId}/reviews/{reviewId}: three path params, no list/create/update/remove/
// summary role fits, so it lands in match.mjs's `extra` — it still gets a generated Service function, but the
// badge should flag that it is not driving the page.
async function selectExample(page, name) {
  await page.goto("/import-wizard");
  const select = page.locator("#example");
  await expect(select.locator("option")).not.toHaveCount(0, { timeout: 15_000 });
  await select.selectOption(name);
}

test("the orgs-items-reviews 3-param endpoint shows the 'not generated' badge; list/create/update/remove endpoints do not", async ({ page }) => {
  await selectExample(page, "orgs-items-reviews");

  const rows = page.locator("#app .ct-eps li");
  await expect(rows).not.toHaveCount(0, { timeout: 15_000 });

  // openapi.mjs's toColon() renders OpenAPI's "{id}" path params as ":id" everywhere (contract.apis, .endpoints),
  // so that is how the panel's <code> shows them too.
  const threeParam = rows.filter({ has: page.locator("code", { hasText: "/api/orgs/:orgId/items/:itemId/reviews/:reviewId" }) });
  await expect(threeParam).toHaveCount(1);
  await expect(threeParam.locator(".ex.no")).toContainText("not generated");

  const drivingPaths = [
    { method: "GET", path: "/api/items" },
    { method: "POST", path: "/api/items" },
    { method: "PUT", path: "/api/items/:id" },
    { method: "DELETE", path: "/api/items/:id" },
  ];
  for (const { method, path } of drivingPaths) {
    const row = rows.filter({ has: page.locator("code", { hasText: path }) }).filter({ hasText: method });
    await expect(row).toHaveCount(1);
    await expect(row).not.toContainText("not generated");
  }
});
