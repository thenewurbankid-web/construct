// T16.8 — the import wizard ("/import-wizard", T13): four steps (Swagger, Endpoint, Subframe, Markers), each
// state lives in one inline <script type="module"> in src/ui/import-wizard.html that calls installImportWizard()
// from src/ui/import-wizard.mjs, which renders by hitting the real server (GET /api/examples, /api/contract,
// /api/wizard/subframe/status, POST /api/wizard/markers/suggest) — nothing here is reachable from a node:test
// that only imports the pure render functions (stepsHtml, markerQuestionsHtml, ...; see
// src/ui/import-wizard.test.mjs), so this is the first check that the page, the step nav and the server's own
// marker-suggestion route actually work together end to end.
import { test, expect } from "@playwright/test";

test("loads with the example picker populated and the Swagger step current", async ({ page }) => {
  await page.goto("/import-wizard");
  const options = page.locator("#example option");
  await expect(options).not.toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator(".iw-steps li.cur")).toContainText("Swagger");
});

test("Markers step suggests a real action marker for a pasted page", async ({ page }) => {
  await page.goto("/import-wizard");
  await expect(page.locator("#example option")).not.toHaveCount(0, { timeout: 15_000 });

  await page.locator('[data-iwgoto="markers"]').click();
  await expect(page.locator(".iw-steps li.cur")).toContainText("Markers");

  const source = 'export default function P() {\n  return (\n    <button onClick={() => {}}>Save</button>\n  );\n}\n';
  await page.locator("[data-iwsource]").fill(source);
  await page.locator("[data-iwsuggest]").click();

  // suggestMarkers() (src/import/suggest-markers.mjs) turns a Button with an onClick into one yes/no question;
  // "save" is KNOWN_VERBS.save, so the action name is deterministic for this exact source.
  await expect(page.locator(".iw-marks li")).toContainText('Should the "Save" button do something (action "save")?');
});
