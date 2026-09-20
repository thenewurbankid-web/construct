import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// #223: allowlisted directory picker on the Settings screen. Real servers,
// real filesystem fixture; nothing mocked.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.resolve(__dirname, '../screenshots');
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
const API = process.env.E2E_API_BASE || 'http://localhost:4000';

test.describe.serial('#223 directory picker', () => {
  let base;
  let root;

  test.beforeAll(async ({ request }) => {
    // #365: the picker's only root is the server's workspace (playwright.workspace.config.js), so the fixture
    // lives directly in it and `off-limits` is a sibling of the workspace, outside it.
    base = process.env.E2E_WORKSPACE_SANDBOX;
    root = process.env.E2E_WORKSPACE_ROOT;
    fs.mkdirSync(path.join(root, 'shop-app'), { recursive: true });
    fs.writeFileSync(path.join(root, 'shop-app', 'architecture.yml'), 'version: 1\n');
    fs.mkdirSync(path.join(root, 'web-ui'));
    fs.writeFileSync(path.join(root, 'web-ui', 'package.json'), JSON.stringify({ dependencies: { react: '^19.0.0' } }));
    fs.mkdirSync(path.join(root, 'notes'));
    fs.mkdirSync(path.join(root, '.secret-cache'));
    fs.writeFileSync(path.join(root, 'passwords.txt'), 'hunter2');
    fs.mkdirSync(path.join(base, 'off-limits'));
    fs.symlinkSync(path.join(base, 'off-limits'), path.join(root, 'sneaky-link'));
    const res = await request.post(`${API}/api/settings`, { data: { projectDir: root } });
    expect(res.ok()).toBeTruthy();
  });

  test.afterAll(async ({ request }) => {
    await request.post(`${API}/api/settings`, { data: { closeProject: true } });
    for (const name of fs.readdirSync(root)) fs.rmSync(path.join(root, name), { recursive: true, force: true });
    fs.rmSync(path.join(base, 'off-limits'), { recursive: true, force: true });
  });

  test('browse, keyboard-navigate, mark projects, hide hidden/escape/files, choose a folder', async ({ page }) => {
    await page.goto('/settings');
    await page.getByRole('button', { name: 'Browse folders…' }).click();

    const picker = page.getByRole('region', { name: 'Choose a project folder' });
    await expect(picker.getByTestId('dir-picker-path')).toHaveText(root);
    // Markers, and only directories.
    await expect(picker.getByRole('button', { name: 'Open shop-app' })).toBeVisible();
    await expect(picker.locator('li', { hasText: 'shop-app' }).getByText('Construct project')).toBeVisible();
    await expect(picker.locator('li', { hasText: 'web-ui' }).getByText('React')).toBeVisible();
    await expect(picker.getByText('passwords.txt')).toHaveCount(0);
    await expect(picker.getByText('.secret-cache')).toHaveCount(0);
    await expect(picker.getByText('sneaky-link')).toHaveCount(0);
    // At the allowlisted root you cannot go up.
    await expect(picker.getByRole('button', { name: 'Up one level' })).toBeDisabled();
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'directory-picker-browse.png'), fullPage: true });

    await picker.getByLabel('Show hidden folders').check();
    await expect(picker.getByRole('button', { name: 'Open .secret-cache' })).toBeVisible();
    await picker.getByLabel('Show hidden folders').uncheck();

    // Keyboard only: focus a row's open button and press Enter to descend.
    await picker.getByRole('button', { name: 'Open notes' }).focus();
    await page.keyboard.press('Enter');
    await expect(picker.getByTestId('dir-picker-path')).toHaveText(path.join(root, 'notes'));
    await expect(picker.getByRole('button', { name: 'Up one level' })).toBeEnabled();
    await picker.getByRole('button', { name: 'Up one level' }).focus();
    await page.keyboard.press('Enter');
    await expect(picker.getByTestId('dir-picker-path')).toHaveText(root);

    // Choose (keyboard) — fills the input; Save applies it.
    await picker.getByRole('button', { name: 'Select shop-app' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByPlaceholder('/path/to/your/construct-project')).toHaveValue(path.join(root, 'shop-app'));
    await expect(picker).toHaveCount(0);
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByText('Settings saved.')).toBeVisible();
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'directory-picker-chosen.png'), fullPage: true });
  });

  test('server refuses traversal, escape, foreign origin (real HTTP)', async ({ request }) => {
    const get = (p, headers) => request.get(`${API}/api/fs/browse`, { params: p ? { path: p } : {}, headers });
    expect((await get(path.join(root, '..'))).status()).toBe(403);
    expect((await get(`${root}/shop-app/../../off-limits`)).status()).toBe(403);
    expect((await get(path.join(root, 'sneaky-link'))).status()).toBe(403);
    expect((await get('/etc')).status()).toBe(403);
    expect((await get(path.join(root, 'passwords.txt'))).status()).toBe(400);
    expect((await get(root, { Origin: 'http://evil.example' })).status()).toBe(403);
    const ok = await (await get(root)).json();
    expect(JSON.stringify(ok)).not.toContain('passwords.txt');
  });
});
