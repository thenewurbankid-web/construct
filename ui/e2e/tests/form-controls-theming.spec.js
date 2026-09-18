import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.resolve(__dirname, '../screenshots');
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

const API_BASE = 'http://localhost:4000';

// #161 — raw browser-default checkboxes/selects visibly clashed with the
// dark glassmorphism theme. All of them already route through the shared
// `Input`/`Select` components (#46), so this is a CSS-only theming fix
// (`.ui-checkbox` accent-color, `.ui-select`'s native arrow replaced with a
// theme-matched chevron) — verified here by checking real computed styles,
// not just eyeballing a screenshot.
test.describe('Form control theming (#161)', () => {
  test.beforeAll(async ({ request }) => {
    // Dashboard/Settings render fine against this repo's own architecture.yml
    // (no dedicated fixture project needed) — same default projectDir other
    // non-fixture-driven specs rely on.
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir: path.resolve(__dirname, '../../..') } });
  });

  test('1. dashboard-form-controls.png — Create form\'s "Layers" checkboxes and "What to scaffold" select are theme-styled, not raw browser defaults', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.locator('h1')).toHaveText('Dashboard');

    const kindSelect = page.locator('.command-form', { hasText: 'Create' }).locator('select').first();
    await kindSelect.selectOption('layer');
    await expect(page.locator('.layer-checkboxes input[type="checkbox"]').first()).toBeVisible();

    // Select: native arrow replaced with a theme chevron via a background-image,
    // appearance suppressed so the OS/browser default arrow doesn't double up.
    const selectAppearance = await kindSelect.evaluate((el) => getComputedStyle(el).appearance || getComputedStyle(el).webkitAppearance);
    expect(selectAppearance).toBe('none');
    const selectBgImage = await kindSelect.evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(selectBgImage).toContain('data:image/svg+xml');

    // Checkbox: real native input, themed via accent-color (not a custom
    // div/SVG replacement) so it still IS an <input type="checkbox">.
    const checkbox = page.locator('.layer-checkboxes input[type="checkbox"]').first();
    await expect(checkbox).toHaveAttribute('type', 'checkbox');
    const accentColor = await checkbox.evaluate((el) => getComputedStyle(el).accentColor);
    expect(accentColor).not.toBe('auto');

    await page.locator('.command-form', { hasText: 'Create' }).screenshot({ path: path.join(SCREENSHOTS_DIR, 'dashboard-create-form-controls.png') });
  });

  test('2. settings-select.png — Settings LLM-provider selects are theme-styled', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.locator('h1')).toHaveText('Settings');
    const select = page.locator('select').first();
    await expect(select).toBeVisible();
    const appearance = await select.evaluate((el) => getComputedStyle(el).appearance || getComputedStyle(el).webkitAppearance);
    expect(appearance).toBe('none');
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'settings-form-controls.png') });
  });
});
