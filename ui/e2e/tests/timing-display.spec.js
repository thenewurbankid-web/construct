import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { materializeLegacyShop } from './support/legacyShop.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.resolve(__dirname, '../screenshots');
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

const API_BASE = process.env.E2E_API_BASE || 'http://localhost:4000';

// #167 -- the Dashboard's result panel shows the per-step + total timing #165/#166 add to every
// generation/scaffolding command's console output. Per commandRunner.mjs's
// own doc comment, most of this "just works" because the Dashboard already
// renders `result.output` verbatim -- these tests are the real,
// rendered-browser proof of that, plus the new `durationSeconds` total
// ui/server now measures itself (commandRunner.mjs's own wrapping timer).

test.describe('Demo/verification #167 -- timing breakdown shows in the UI', () => {
  test('Dashboard: Create form result panel shows per-step timing text and a Total: line', async ({ page, request }) => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-timing-167-dash-'));
    const settingsRes = await request.post(`${API_BASE}/api/settings`, { data: { projectDir } });
    expect(settingsRes.ok()).toBeTruthy();
    const initRes = await request.post(`${API_BASE}/api/init`);
    expect(initRes.ok()).toBeTruthy();

    await page.goto('/dashboard');
    await expect(page.locator('h1')).toHaveText('Dashboard', { timeout: 15_000 });
    const createForm = page.locator('.command-form', { has: page.getByRole('heading', { name: 'Create' }) });

    // A vertical slice (several layers in one command) -- #165's richest
    // case: one duration per created file, plus a "Total:" line.
    await createForm.locator('select').first().selectOption('layer');
    await createForm.getByPlaceholder('e.g. CpoAccess').fill('OrderFlow');
    await createForm.getByPlaceholder('e.g. cpo-v2').fill('billing');
    for (const layer of ['domain', 'hook', 'page']) {
      await createForm.locator('.layer-checkboxes .checkbox', { hasText: layer }).locator('input[type="checkbox"]').check();
    }
    await createForm.getByRole('button', { name: /^Create (feature|slice|file)$/ }).click();

    const output = createForm.locator('.command-output');
    await expect(output).toBeVisible({ timeout: 15_000 });
    const outputText = await output.innerText();
    // Per-step timing text from #165, passed through by the Dashboard's
    // existing output rendering with no UI-side change needed.
    expect(outputText).toMatch(/Created .* \(\d+\.\d\ds\)/);
    expect(outputText).toMatch(/Total: \d+\.\d\ds/);

    // The whole-command total ui/server itself measures (#167's own
    // addition to commandRunner.mjs), rendered as its own line.
    const duration = createForm.locator('.command-duration');
    await expect(duration).toBeVisible();
    await expect(duration).toHaveText(/Total: \d+\.\d\ds/);

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '167-1-dashboard-timing.png'), fullPage: true });

    fs.rmSync(projectDir, { recursive: true, force: true });
  });

});
