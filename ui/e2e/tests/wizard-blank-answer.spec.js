import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.resolve(__dirname, '../screenshots');
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
const API_BASE = process.env.E2E_API_BASE || 'http://localhost:4000';

// #40: a blank wizard answer (a meaningful "finish adding routes") must
// render a visible italic "(blank)" placeholder, not an empty pill.
test.describe('Wizard blank answer (#40)', () => {
  let tmpProjectDir;

  test.beforeAll(async ({ request }) => {
    tmpProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-ui-e2e-wizard-blank-'));
    const settingsRes = await request.post(`${API_BASE}/api/settings`, { data: { projectDir: tmpProjectDir } });
    expect(settingsRes.ok()).toBeTruthy();
    const initRes = await request.post(`${API_BASE}/api/init`);
    expect(initRes.ok()).toBeTruthy();
  });

  test.afterAll(() => {
    fs.rmSync(tmpProjectDir, { recursive: true, force: true });
  });

  test('a blank answer shows an italic (blank) placeholder', async ({ page }) => {
    await page.goto('/wizard');
    await page.getByPlaceholder('/v2/home').fill('/definitely-not-a-real-route-xyz');
    await page.getByRole('button', { name: 'Start wizard session' }).click();

    await expect(page.locator('.chat-question').last()).toContainText('Destination feature');
    await page.locator('.chat-input input').fill('blankdemo');
    await page.getByRole('button', { name: 'Send' }).click();

    await expect(page.locator('.chat-question').last()).toContainText('Another route to include');
    await page.getByRole('button', { name: 'Send' }).click(); // empty answer

    const blank = page.locator('.chat-answer-blank');
    await expect(blank).toHaveText('(blank)');
    await expect(blank).toBeVisible();
    expect(await blank.evaluate((el) => getComputedStyle(el).fontStyle)).toBe('italic');
    await expect(page.locator('.chat-question').last()).toContainText('LLM also write the ported logic');
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'wizard-blank-answer.png'), fullPage: true });
  });
});
