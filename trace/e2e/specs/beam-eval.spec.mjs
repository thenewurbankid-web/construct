// #896 — the planner eval page (/beam): the committed fixtures (two setups, recorded with a scripted judge, no model)
// shown in review order, the owner grading one item with the rubric buttons, agreement and gold appearing after the
// grade, two setups compared side by side, and "Re-run with this setup" replaying recorded transcripts. The server
// writes to e2e/out/beam (TRACE_BEAM_RESULTS in playwright.config.mjs); the spec clears it first.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "out", "beam");

test.beforeAll(() => fs.rmSync(out, { recursive: true, force: true }));

test("review order, owner grading, agreement, compare and replay re-run", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  await page.goto("/beam");
  await expect(page.getByTestId("beam-summary")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("setup-select").selectOption("r-v1.g-v1");
  await expect(page.getByTestId("mean-grader")).toHaveText("10.17");
  await expect(page.getByTestId("agreement-rate")).toHaveText("75%");
  await expect(page.getByTestId("disagree-count")).toHaveText("1");

  // Review first: the item where grader and owner differ by 2 or more is at the top and selected.
  const first = page.getByTestId("beam-items").locator("button.item").first();
  await expect(first).toHaveAttribute("data-item", "orders-2");
  await expect(first.getByTestId("disagree-badge")).toHaveText("Δ -3 review");
  await expect(page.getByTestId("beam-detail")).toHaveAttribute("data-item", "orders-2");
  await expect(page.getByTestId("overall-diff")).toHaveText("-3");

  // An ungraded item with two runs: blind ids, the recommended mark, gold withheld until the owner grades.
  await page.locator('button.item[data-item="orders-1"]').click();
  const detail = page.getByTestId("beam-detail");
  await expect(detail).toHaveAttribute("data-item", "orders-1");
  await expect(page.getByTestId("requirement")).toContainText("total value of all orders");
  await expect(page.getByTestId("planner-question")).toContainText("api field or be computed");
  await expect(page.getByTestId("requester-answer")).toContainText("Add up the totals");
  await expect(page.getByTestId("beam-run")).toHaveCount(2);
  // the graded runs' mark (#902's beam tree above them has its own "recommended" chip for a question outcome)
  await expect(page.getByTestId("beam-run").getByText("recommended", { exact: true })).toBeVisible();
  await expect(detail.getByText(/graded blind as run [AB]/).first()).toBeVisible();
  await expect(page.getByTestId("grader-justification")).toContainText("Right computed path");
  await expect(page.getByTestId("gold")).toContainText("appear once you have graded");

  // The owner grades with the rubric buttons (same scores as the grader: full agreement) and a note.
  for (const [line, score] of [["intent", 2], ["path", 3], ["reuse", 2], ["question", 2], ["unused", 2]]) {
    await page.locator(`button.sbtn[data-line="${line}"][data-score="${score}"]`).click();
    await expect(page.locator(`button.sbtn[data-line="${line}"][data-score="${score}"]`)).toHaveAttribute("aria-pressed", "true");
  }
  await page.getByTestId("owner-note").fill("Computed is right; a new hook is fine here.");
  await page.getByTestId("owner-save").click();
  await expect(page.getByTestId("owner-status")).toContainText("saved");
  await expect(page.getByTestId("overall-diff")).toHaveText("0");
  await expect(page.getByTestId("gold")).toContainText("update.prop");
  await expect(page.getByTestId("gold")).toContainText("match");
  await expect(page.getByTestId("agreement-rate")).toHaveText("80%");
  expect(fs.existsSync(path.join(out, "results", "r-v1.g-v1", "owner.json"))).toBe(true);

  // Two setups side by side.
  await page.getByTestId("compare-select").selectOption("r-v1.g-v2");
  await expect(page.getByTestId("beam-compare")).toContainText("r-v1.g-v2");
  await expect(page.getByTestId("beam-compare")).toContainText("question (0–2)");

  // Re-run grader v2 in replay mode: recorded transcripts, no model; the results now come from the run.
  await expect(page.getByText("replay only")).toBeVisible();
  await page.getByTestId("requester-select").selectOption("v1");
  await page.getByTestId("grader-select").selectOption("v2");
  await page.getByTestId("rerun").click();
  await expect(page.getByTestId("run-status")).toContainText("r-v1.g-v2: replay done", { timeout: 15_000 });
  await expect(page.getByTestId("setup-select").locator("option:checked")).toContainText("r-v1.g-v2 · results · replay");
  await expect(page.getByTestId("beam-items").locator("button.item")).toHaveCount(6);
  expect(fs.existsSync(path.join(out, "results", "r-v1.g-v2", "items.json"))).toBe(true);

  expect(errors).toEqual([]);
});

test("phone width: the list stacks above the detail with no horizontal scroll", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/beam");
  await expect(page.getByTestId("beam-detail")).toBeVisible({ timeout: 15_000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
