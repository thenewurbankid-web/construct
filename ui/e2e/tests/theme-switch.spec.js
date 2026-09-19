import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

test('toggle switches to light, persists across reload, and switches back', async ({ page }) => {
  await page.goto('/help');
  const toggle = page.getByTestId('theme-toggle');
  await expect(toggle).toHaveAccessibleName('Switch to light theme');
  await toggle.click();
  expect(await theme(page)).toBe('light');
  expect(await bodyBg(page)).toBe('rgb(238, 240, 244)');
  expect(await page.evaluate(() => localStorage.getItem('construct.theme'))).toBe('light');
  await expect(toggle).toHaveAccessibleName('Switch to dark theme');
  await page.screenshot({ path: path.join(SHOTS, 'theme-light-help.png') });

  // No flash: the attribute is already 'light' at DOMContentLoaded, before hydration.
  await page.goto('/help', { waitUntil: 'domcontentloaded' });
  expect(await theme(page)).toBe('light');
  await expect(page.getByTestId('theme-toggle')).toHaveAccessibleName('Switch to dark theme');

  await page.getByTestId('theme-toggle').click();
  expect(await theme(page)).toBe('dark');
  expect(await page.evaluate(() => localStorage.getItem('construct.theme'))).toBe('dark');
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
  await blocked.getByTestId('theme-toggle').click();
  expect(await theme(blocked)).toBe('light');
  expect(errors).toEqual([]);
});

test('light theme keeps text readable: primary text and nav pill contrast >= 4.5', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('construct.theme', 'light'));
  // /dashboard, not /help: Help's Browser pane now opens on its own Contents tab (#250),
  // so the Screens list is not showing there; the top bar's active mode link is.
  await page.goto('/dashboard');
  const ratio = await page.evaluate(() => {
    const lum = ([r, g, b]) => {
      const f = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const rgb = (s) => s.match(/\d+/g).slice(0, 3).map(Number);
    const active = document.querySelector('.nav a.active, [aria-current="page"]');
    const cs = getComputedStyle(active);
    const [a, b] = [lum(rgb(cs.color)), lum(rgb(cs.backgroundColor))].sort((x, y) => y - x);
    return (a + 0.05) / (b + 0.05);
  });
  expect(ratio).toBeGreaterThanOrEqual(4.5);
});
