import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gotoCockpit } from './support/cockpit.js';

// #368 - the profile menu (docs/design/ia-five-screens.md section 2). On this default server there is no login
// gate, so the menu is the same disclosure without an account header; the signed-in header (avatar, login,
// "Signed in with GitHub", Sign out) is asserted in auth.spec.js under the auth config.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(__dirname, '../screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

test('the profile menu holds Settings, Local model, Theme and Help, and each opens in the stage', async ({ page }) => {
  await gotoCockpit(page, '/help');
  const trigger = page.getByTestId('user-menu-trigger');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  const menu = page.locator('#sh-user-menu');
  await expect(menu).toBeVisible();
  // Focus moves in on open (popovers.md), and the surface is not a modal.
  await expect.poll(() => page.evaluate(() => !!document.getElementById('sh-user-menu')?.contains(document.activeElement))).toBe(true);
  await expect(menu.getByTestId('profile-settings')).toContainText('Settings');
  await expect(menu.getByTestId('profile-local-model')).toContainText('Local model');
  await expect(menu.getByTestId('profile-model-status')).toContainText(/Ready|Offline|Checking/);
  await expect(menu.getByRole('group', { name: 'Theme' }).getByRole('radio')).toHaveCount(3);
  await expect(menu.getByTestId('profile-help')).toContainText('Help and shortcuts');
  await page.screenshot({ path: path.join(SHOTS, '368-profile-menu.png') });

  // Settings opens the full page in the stage and closes the menu.
  await menu.getByTestId('profile-settings').click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.locator('#sh-user-menu')).toHaveCount(0);

  await trigger.click();
  await expect(page.getByTestId('profile-settings')).toHaveAttribute('aria-current', 'page');
  await page.getByTestId('profile-local-model').click();
  await expect(page).toHaveURL(/\/ollama$/);

  await trigger.click();
  await page.getByTestId('profile-help').click();
  await expect(page).toHaveURL(/\/help$/);
});

test('Escape closes the menu and returns focus to the trigger; the old top-bar theme toggle is gone', async ({ page }) => {
  await gotoCockpit(page, '/help');
  await expect(page.getByTestId('theme-toggle')).toHaveCount(0);
  const trigger = page.getByTestId('user-menu-trigger');
  await trigger.click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#sh-user-menu')).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('the Theme choice is a keyboard-operable radio group and persists', async ({ page }) => {
  await gotoCockpit(page, '/help');
  await page.getByTestId('user-menu-trigger').click();
  const light = page.getByTestId('theme-light');
  await light.focus();
  await page.keyboard.press('Space');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  // The menu stays open so the change can be seen.
  await expect(page.locator('#sh-user-menu')).toBeVisible();
  await page.screenshot({ path: path.join(SHOTS, '368-profile-menu-light.png') });
  expect(await page.evaluate(() => localStorage.getItem('construct.theme'))).toBe('light');
});

test('at 390 px the menu is a bottom sheet', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await gotoCockpit(page, '/help');
  await page.getByTestId('user-menu-trigger').click();
  const sheet = page.locator('#sh-user-menu');
  // Poll: the surface fades in over 120 ms, so measure once it has settled against the bottom edge.
  await expect.poll(async () => { const b = await sheet.boundingBox(); return Math.round(b.y + b.height); }).toBe(800);
  expect((await sheet.boundingBox()).width).toBeGreaterThanOrEqual(389);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: path.join(SHOTS, '368-profile-menu-narrow.png') });
});
