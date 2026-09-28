// Playwright spec for the feature-grouper paste page (serve.mjs / page.html): paste a fixture, group, check the
// results and highlights, the threshold slider, the embedder dropdown, a parse error, and the demo picker.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, listen } from "../serve.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, "..", "fixtures");
const dashboard = fs.readFileSync(path.join(FIXTURES, "dashboard.tsx"), "utf8");
const profile = fs.readFileSync(path.join(FIXTURES, "profile.tsx"), "utf8");

let server;
let base;

test.beforeAll(async () => {
  server = createServer();
  const port = await listen(server, 4319);
  base = `http://127.0.0.1:${port}`;
});
test.afterAll(() => server.close());

test("paste a page and group it: groups, member counts and highlights appear", async ({ page }) => {
  await page.goto(base);
  await page.fill("#src", dashboard);
  await page.click("#go");
  await expect(page.locator(".group")).toHaveCount(4);
  await expect(page.locator("#sum")).toContainText("4 groups");
  const repeating = page.locator(".group", { hasText: "repeating" });
  await expect(repeating).toContainText("3 members");
  await repeating.hover();
  await expect(page.locator(".ln.hl")).toHaveCount(15); // lines 20-34
});

const setRange = (locator, value) => locator.evaluate((el, v) => {
  el.value = v;
  el.dispatchEvent(new Event("input", { bubbles: true }));
}, value);

test("threshold slider changes the grouping", async ({ page }) => {
  await page.goto(base);
  await page.fill("#src", profile); // has a threshold-sensitive cluster (see grouper.test.mjs)
  await setRange(page.locator("#th"), "0.5");
  const lo = await Promise.all([page.waitForResponse("**/api/group"), page.click("#go")]).then(([r]) => r.json());
  await setRange(page.locator("#th"), "0.99");
  const hi = await Promise.all([page.waitForResponse("**/api/group"), page.click("#go")]).then(([r]) => r.json());
  expect(lo.threshold).toBe(0.5);
  expect(hi.threshold).toBe(0.99);
  expect(lo.groups.length).not.toEqual(hi.groups.length);
});

test("embedder dropdown: hashed always works; ollama is offered and used when the model is installed", async ({ page }) => {
  await page.goto(base);
  await page.fill("#src", dashboard);
  await expect(page.locator("#emb")).toHaveValue("hashed");
  const hashedResult = await Promise.all([page.waitForResponse("**/api/group"), page.click("#go")]).then(([r]) => r.json());
  expect(hashedResult.embedder).toBe("hashed-structural");

  await page.selectOption("#emb", "ollama");
  const ollamaResult = await Promise.all([page.waitForResponse("**/api/group"), page.click("#go")]).then(([r]) => r.json());
  // Either the model is installed and used, or it is missing and the response says so and falls back -- both are
  // correct behaviour; only a silent wrong embedder would be a failure.
  const usedOllama = ollamaResult.embedder.startsWith("ollama:");
  const fellBack = ollamaResult.embedder === "hashed-structural" && typeof ollamaResult.notice === "string" && ollamaResult.notice.length > 0;
  expect(usedOllama || fellBack).toBe(true);
});

test("a page that cannot be parsed shows an error, not a crash", async ({ page }) => {
  await page.goto(base);
  await page.fill("#src", "const a = <div");
  await page.click("#go");
  await expect(page.locator("#err")).toContainText("cannot parse");
  await expect(page.locator(".group")).toHaveCount(0);
});

test("the demo picker loads and groups a real demo-app page", async ({ page }) => {
  await page.goto(base);
  await page.selectOption("#demo", "1");
  await expect(page.locator(".group").first()).toBeVisible();
  const value = await page.locator("#demo").inputValue();
  expect(value).toBe("1");
});
