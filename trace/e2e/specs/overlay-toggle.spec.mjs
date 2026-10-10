// LIN-104 — the fit screen's Overlay toggle hides/shows the wires and part highlights over the design without
// touching selection, and remembers the choice per viewer. Real browser only: computed opacity and localStorage
// persistence across a reload are not pure functions (those are covered by src/ui/overlay-toggle.test.mjs).
import { test, expect } from "@playwright/test";

test("Overlay toggles the wires and highlights, keeps selection, remembers the choice, and answers to O", async ({ page }) => {
  await page.goto("/?canvasdebug");
  await page.locator('.scen-card[data-id="orders"]').click();
  await page.locator("#bWire").click();
  await expect(page.locator("#s-fit")).toBeVisible({ timeout: 15_000 });
  await page.waitForFunction(() => document.querySelector("#pv [data-part]"), { timeout: 15_000 });

  const overlay = page.locator("#bOverlay"), canvas = page.locator("#traceCanvas");
  await expect(overlay).toHaveAttribute("aria-pressed", "true");
  await expect(canvas).toHaveCSS("opacity", "1");

  // pick a part before toggling: its selection must survive the overlay being hidden and shown again
  const id = await page.evaluate(() => {
    const el = document.querySelector("#pv [data-id]");
    el.classList.add("picked");
    return el.dataset.id;
  });

  await overlay.click();
  await expect(overlay).toHaveAttribute("aria-pressed", "false");
  await expect(canvas).toHaveCSS("opacity", "0");
  await expect(page.locator(`[data-id="${id}"]`)).toHaveClass(/picked/);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("trace-overlay"))).toBe("0");

  // reload: a fresh load of the fit screen respects the remembered choice
  await page.goto("/?canvasdebug");
  await page.locator('.scen-card[data-id="orders"]').click();
  await page.locator("#bWire").click();
  await expect(page.locator("#s-fit")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("#bOverlay")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#traceCanvas")).toHaveCSS("opacity", "0");

  // the O shortcut toggles it back on
  await page.keyboard.press("o");
  await expect(page.locator("#bOverlay")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#traceCanvas")).toHaveCSS("opacity", "1");
});
