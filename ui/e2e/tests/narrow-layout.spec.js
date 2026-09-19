import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Design #250 — below 900px the Cockpit shows ONE pane at a time (Browser /
// Stage / Tools) switched from a bottom tab bar. Tested at 390px (phone) and
// 768px (tablet); >= 900px keeps the three panes.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(__dirname, '../screenshots/shell-states');
fs.mkdirSync(SHOTS, { recursive: true });

const noHorizontalScroll = async (page) => {
  const { scroll, inner } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
  expect(scroll).toBeLessThanOrEqual(inner);
};

for (const [name, width, height] of [['phone-390', 390, 844], ['tablet-768', 768, 1024]]) {
  test.describe(`narrow layout at ${width}px`, () => {
    test.use({ viewport: { width, height } });

    test('one pane at a time: Stage by default, Browser and Tools via the bottom tab bar', async ({ page }) => {
      await page.goto('/help');
      const bar = page.getByRole('tablist', { name: 'Panes' });
      await expect(bar).toBeVisible();
      await expect(bar.getByRole('tab')).toHaveText(['Browser', 'Stage', 'Tools']);
      await expect(bar.getByRole('tab', { name: 'Stage' })).toHaveAttribute('aria-selected', 'true');

      // Stage: the screen is visible, the side panes are not.
      await expect(page.getByRole('main')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Help', level: 1 })).toBeVisible();
      await expect(page.getByRole('complementary', { name: 'Browser' })).toHaveCount(0);
      await expect(page.getByRole('complementary', { name: 'Tools' })).toHaveCount(0);
      await noHorizontalScroll(page);
      await page.screenshot({ path: path.join(SHOTS, `narrow-${name}-stage-dark.png`) });

      // Browser: the screens list replaces the stage.
      await bar.getByRole('tab', { name: 'Browser' }).click();
      await expect(page.getByRole('complementary', { name: 'Browser' })).toBeVisible();
      // Help's own Contents tab comes first; the shell's Screens tab follows.
      await page.getByRole('complementary', { name: 'Browser' }).getByRole('tab', { name: 'Screens' }).click();
      await expect(page.getByRole('link', { name: 'Settings' }).first()).toBeVisible();
      await expect(page.getByRole('main')).toHaveCount(0);
      await noHorizontalScroll(page);
      await page.screenshot({ path: path.join(SHOTS, `narrow-${name}-browser-dark.png`) });

      // Tools: project info.
      await bar.getByRole('tab', { name: 'Tools' }).click();
      await expect(page.getByRole('complementary', { name: 'Tools' })).toBeVisible();
      await expect(page.getByRole('complementary', { name: 'Browser' })).toHaveCount(0);
      await noHorizontalScroll(page);
    });

    test('choosing a screen in the Browser returns to the Stage showing it', async ({ page }) => {
      await page.goto('/help');
      const bar = page.getByRole('tablist', { name: 'Panes' });
      await bar.getByRole('tab', { name: 'Browser' }).click();
      await page.getByRole('complementary', { name: 'Browser' }).getByRole('tab', { name: 'Screens' }).click();
      await page.getByRole('complementary', { name: 'Browser' }).getByRole('link', { name: 'Local Model' }).click();
      await expect(page).toHaveURL(/\/ollama$/);
      await expect(bar.getByRole('tab', { name: 'Stage' })).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByRole('heading', { name: 'Local model (Ollama)' })).toBeVisible();
    });

    test('keyboard: arrows move between panes, focus follows', async ({ page }) => {
      await page.goto('/help');
      const bar = page.getByRole('tablist', { name: 'Panes' });
      await bar.getByRole('tab', { name: 'Stage' }).focus();
      await page.keyboard.press('ArrowRight');
      await expect(bar.getByRole('tab', { name: 'Tools' })).toHaveAttribute('aria-selected', 'true');
      await expect(bar.getByRole('tab', { name: 'Tools' })).toBeFocused();
      await page.keyboard.press('Home');
      await expect(bar.getByRole('tab', { name: 'Browser' })).toHaveAttribute('aria-selected', 'true');
    });

    test('a screen keeps its state while you look at another pane (panes stay mounted)', async ({ page }) => {
      await page.goto('/wizard');
      const bar = page.getByRole('tablist', { name: 'Panes' });
      const seed = page.getByPlaceholder('/v2/home');
      await seed.fill('/v2/keep-me');
      await bar.getByRole('tab', { name: 'Tools' }).click();
      await bar.getByRole('tab', { name: 'Stage' }).click();
      await expect(seed).toHaveValue('/v2/keep-me');
    });

    test('light theme: same layout, screenshots for review', async ({ page }) => {
      await page.addInitScript(() => localStorage.setItem('construct.theme', 'light'));
      await page.goto('/help');
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
      await expect(page.getByRole('tablist', { name: 'Panes' })).toBeVisible();
      await noHorizontalScroll(page);
      await page.screenshot({ path: path.join(SHOTS, `narrow-${name}-stage-light.png`) });
      await page.getByRole('tab', { name: 'Browser' }).click();
      await page.screenshot({ path: path.join(SHOTS, `narrow-${name}-browser-light.png`) });
    });
  });
}

test('at 900px and wider the three-pane layout stays (no bottom tab bar)', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 800 });
  await page.goto('/help');
  await expect(page.getByRole('complementary', { name: 'Browser' })).toBeVisible();
  await expect(page.getByRole('tablist', { name: 'Panes' })).toHaveCount(0);
  await page.setViewportSize({ width: 899, height: 800 });
  await expect(page.getByRole('tablist', { name: 'Panes' })).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.getByRole('tablist', { name: 'Panes' })).toHaveCount(0);
  await expect(page.getByRole('complementary', { name: 'Browser' })).toBeVisible();
});
