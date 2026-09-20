import { test, expect } from '@playwright/test';
import { noDevBadge, shot, makeProject, cleanup } from './cockpit-fixture.mjs';
import { setTheme } from '../support/cockpit.js';

// Cockpit guide, stories 6-7: find anything with the command palette; work in
// light or dark and on a small screen.
test.describe.serial('Cockpit demo: command palette, themes, small screens', () => {
  let proj;
  test.beforeEach(async ({ page }) => { await noDevBadge(page); });

  test.beforeAll(async ({ request }) => { proj = await makeProject(request); });
  test.afterAll(async ({ request }) => { await cleanup(request, proj); });

  test('6. Ctrl K opens the palette; typing narrows the list; Enter runs the command', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/pages');
    await page.locator('.pages-browser select').selectOption('people');
    await page.keyboard.press('Control+k');
    const dialog = page.getByRole('dialog', { name: 'Command palette' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('combobox', { name: 'Search commands' }).fill('go to');
    await expect(dialog.getByRole('option').first()).toBeVisible();
    await page.screenshot({ path: shot('cockpit-7-command-palette.png') });
    await dialog.getByRole('combobox').fill('go to settings');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/settings$/);
  });

  test('7a. the drawer shows real Diagnostics, in light theme', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/pages');
    await page.keyboard.press('Control+j');
    const drawer = page.getByRole('region', { name: 'Drawer' });
    await expect(drawer.getByTestId('diagnostic-row').first()).toBeVisible({ timeout: 30_000 });
    await setTheme(page, 'light');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.screenshot({ path: shot('cockpit-8-diagnostics-light.png') });
    await setTheme(page, 'dark');
  });

  test('7b. on a phone-sized screen one pane shows at a time, switched from a bottom bar', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/pages');
    const bar = page.getByRole('tablist', { name: 'Panes' });
    await expect(bar.getByRole('tab')).toHaveText(['Browser', 'Stage', 'Tools']);
    await bar.getByRole('tab', { name: 'Browser' }).click();
    const browser = page.getByRole('complementary', { name: 'Browser' });
    await expect(browser).toBeVisible();
    await page.locator('.pages-browser select').selectOption('people');
    await expect(page.getByRole('button', { name: 'ProfilePage.tsx' })).toBeVisible();
    await page.screenshot({ path: shot('cockpit-9-phone-browser.png') });
  });
});
