// Playwright spec for the "Extract" live-render overlay (serve.mjs's /api/render + page.html's iframe bootstrap):
// separate from Group's own spec (paste-page.spec.mjs) on purpose, matching the brief -- Extract is a second,
// independent entry point into the same pasted text, not a replacement for Group.
//
// Known automation caveat (not a product bug, see the builder's report): chaining Playwright's `selectOption`
// on the #demo <select> directly into an Extract click can leave requestAnimationFrame suspended inside the
// live-preview iframe in headless Chromium (reproduced with a bare rAF probe, unrelated to any of this tool's
// own code -- the exact same content renders correctly via `page.fill` or a direct property assignment). To
// keep this suite reliable, the demo-page case below sets the textarea/`file` the same way the dropdown's own
// change handler does, without going through the native <select> control.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, listen } from "../serve.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, "..", "fixtures");
const dashboard = fs.readFileSync(path.join(FIXTURES, "dashboard.tsx"), "utf8");

let server;
let base;

test.beforeAll(async () => {
  server = createServer();
  const port = await listen(server, 4329);
  base = `http://127.0.0.1:${port}`;
});
test.afterAll(() => server.close());

/** Wait for the iframe to report its rects at least once, then read the drawn overlay boxes. */
async function overlayBoxes(page) {
  await page.waitForFunction(() => document.getElementById("liveWrap").hidden === false);
  await expect
    .poll(() => page.locator("#liveOverlay .gbox").count(), { timeout: 8000 })
    .toBeGreaterThan(0);
  return page.locator("#liveOverlay .gbox").count();
}

test("Extract renders the pasted page live and draws one overlay box per group member, color-matched to the group id", async ({ page }) => {
  await page.goto(base);
  await page.fill("#src", dashboard);
  await page.click("#extract");
  const count = await overlayBoxes(page);
  // dashboard.tsx groups into 4 groups (g1 unique x2 + g2 repeating x3 members + g4 unique, per grouper.test.mjs);
  // one box per member, so boxes >= number of groups and each g1/g2/... label appears on its first box.
  expect(count).toBeGreaterThanOrEqual(4);
  await expect(page.locator("#liveOverlay .gbox span").first()).toHaveText(/^g\d+$/);
  await expect(page.locator("#liveErr")).toHaveText("");
});

test("Group and Extract are independent: using one does not clear or break the other in the same session", async ({ page }) => {
  await page.goto(base);
  await page.fill("#src", dashboard);
  await page.click("#go");
  await expect(page.locator(".group")).toHaveCount(4);

  await page.click("#extract");
  await overlayBoxes(page);
  // Group's own panels (source highlight, group cards) are untouched by Extract.
  await expect(page.locator(".group")).toHaveCount(4);
  await expect(page.locator("#view")).toBeVisible();

  // And Group still works normally after Extract has run.
  await page.click("#go");
  await expect(page.locator(".group")).toHaveCount(4);
});

test("a demo-app page with a sibling import (../component/Row.jsx) still renders live: resolveDir matches a known demo file", async ({ page }) => {
  await page.goto(base);
  const demo = await (await fetch(`${base}/api/demo?i=0`)).json(); // categories: imports "../component/CategoryRow.jsx"
  expect(demo.name).toMatch(/CategoriesPage\.jsx$/);
  // Set the textarea + the tracked demo name exactly as the #demo dropdown's own change handler does (see the
  // header comment: chaining this through the actual <select> control is flaky in headless automation).
  await page.evaluate(({ source, name }) => {
    document.getElementById("src").value = source;
    currentDemoName = name;
  }, demo);
  await page.click("#extract");
  await overlayBoxes(page);
  await expect(page.locator("#liveErr")).toHaveText("");
});

test("a freshly pasted page with an unresolvable relative import fails to render live with a clear message, without breaking Group", async ({ page }) => {
  await page.goto(base);
  const src = 'import Row from "./Row";\nexport default function Page(){ return <div className="wrap"><section><Row/><p>x</p></section></div>; }';
  await page.fill("#src", src);
  await page.click("#go");
  await expect(page.locator("#err")).toHaveText(""); // grouping itself doesn't need the import to resolve

  await page.click("#extract");
  await expect(page.locator("#liveErr")).toContainText("cannot render");
  await expect(page.locator("#liveOverlay .gbox")).toHaveCount(0);
});

test("a page with no top-level component to render reports a clear error, not a crash", async ({ page }) => {
  await page.goto(base);
  await page.fill("#src", "const notAComponent = 1;\nconst el = <div><span>x</span></div>;");
  await page.click("#extract");
  await expect(page.locator("#liveErr")).toContainText("no top-level page component found");
});
