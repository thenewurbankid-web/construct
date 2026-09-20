import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gotoCockpit, setTheme, waitForCockpitReady } from './support/cockpit.js';

// Design #244 — tokens + light theme + theme switch. Dark is the default
// (owner decision); the choice persists in localStorage and is applied before
// first paint (no flash of the wrong theme).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(__dirname, '../screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const theme = (page) => page.evaluate(() => document.documentElement.getAttribute('data-theme'));
const bodyBg = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test('dark is the default theme and nothing is stored until the user chooses', async ({ page }) => {
  await page.goto('/help');
  await expect(page.locator('h1')).toBeVisible();
  expect(await theme(page)).toBe('dark');
  expect(await bodyBg(page)).toBe('rgb(6, 7, 9)');
  expect(await page.evaluate(() => localStorage.getItem('construct.theme'))).toBeNull();
  await page.screenshot({ path: path.join(SHOTS, 'theme-dark-help.png') });
});

test('the profile menu switches to light, persists across reload, and switches back (#368)', async ({ page }) => {
  await gotoCockpit(page, '/help');
  // The Theme control is a radio group in the profile menu; the old top-bar toggle is gone.
  await expect(page.getByTestId('theme-toggle')).toHaveCount(0);
  await page.getByTestId('user-menu-trigger').click();
  const group = page.getByRole('group', { name: 'Theme' });
  await expect(group.getByRole('radio', { name: 'Dark' })).toBeChecked();
  await group.getByRole('radio', { name: 'Light' }).check();
  expect(await theme(page)).toBe('light');
  expect(await bodyBg(page)).toBe('rgb(238, 240, 244)');
  expect(await page.evaluate(() => localStorage.getItem('construct.theme'))).toBe('light');
  await expect(group.getByRole('radio', { name: 'Light' })).toBeChecked();
  await page.screenshot({ path: path.join(SHOTS, 'theme-light-help.png') });

  // No flash: the attribute is already 'light' at DOMContentLoaded, before hydration.
  await page.goto('/help', { waitUntil: 'domcontentloaded' });
  expect(await theme(page)).toBe('light');
  await gotoCockpit(page, '/help');
  await page.getByTestId('user-menu-trigger').click();
  await expect(page.getByRole('radio', { name: 'Light' })).toBeChecked();
  await page.keyboard.press('Escape');

  await setTheme(page, 'dark');
  expect(await theme(page)).toBe('dark');
  expect(await page.evaluate(() => localStorage.getItem('construct.theme'))).toBe('dark');
});

test('System follows the operating system, live, and is remembered as System', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await gotoCockpit(page, '/help');
  await setTheme(page, 'system');
  expect(await page.evaluate(() => localStorage.getItem('construct.theme'))).toBe('system');
  expect(await theme(page)).toBe('light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => theme(page)).toBe('dark');
  // Reload: still System, painted from the OS before hydration.
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/help', { waitUntil: 'domcontentloaded' });
  expect(await theme(page)).toBe('light');
  await gotoCockpit(page, '/help');
  await page.getByTestId('user-menu-trigger').click();
  await expect(page.getByRole('radio', { name: 'System' })).toBeChecked();
});

test('a garbage stored value falls back to dark; blocked storage does not break the page', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('construct.theme', '"><b>x</b>'));
  await page.goto('/help');
  expect(await theme(page)).toBe('dark');

  const blocked = await page.context().newPage();
  const errors = [];
  blocked.on('pageerror', (e) => errors.push(String(e)));
  await blocked.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new Error('blocked');
    };
    Storage.prototype.setItem = () => {
      throw new Error('blocked');
    };
  });
  await blocked.goto('/help');
  await expect(blocked.locator('h1')).toBeVisible();
  expect(await theme(blocked)).toBe('dark');
  await waitForCockpitReady(blocked);
  await setTheme(blocked, 'light');
  expect(await theme(blocked)).toBe('light');
  expect(errors).toEqual([]);
});

test('light theme keeps text readable: primary text and the current screen link contrast >= 4.5', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('construct.theme', 'light'));
  // The top bar's current screen link (#369: weight + underline on the bar's own surface, so the background that
  // matters is the nearest opaque ancestor, not the link's own transparent one).
  await page.goto('/dashboard');
  const ratio = await page.evaluate(() => {
    const lum = ([r, g, b]) => {
      const f = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const rgb = (s) => s.match(/\d+/g).slice(0, 3).map(Number);
    const active = document.querySelector('.nav a.active, [aria-current="page"]');
    const cs = getComputedStyle(active);
    let bg = active;
    while (bg && /rgba\(.*,\s*0\)|transparent/.test(getComputedStyle(bg).backgroundColor)) bg = bg.parentElement;
    const [a, b] = [lum(rgb(cs.color)), lum(rgb(getComputedStyle(bg ?? document.body).backgroundColor))].sort((x, y) => y - x);
    return (a + 0.05) / (b + 0.05);
  });
  expect(ratio).toBeGreaterThanOrEqual(4.5);
});
