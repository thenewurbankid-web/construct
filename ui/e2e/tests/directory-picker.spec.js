import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// #223 / #568: the "Your projects" list on the Settings screen (one flat level of my own workspace). Real servers,
// real filesystem fixture; nothing mocked.
const API = process.env.E2E_API_BASE || 'http://localhost:4000';

test.describe.serial('#223/#568 my-projects list', () => {
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

  test('#568: the list is only my projects, flat, and offers no way to reach a path outside it', async ({ page }) => {
    await page.goto('/settings');
    await page.getByRole('button', { name: 'Choose a project…' }).click();

    const picker = page.getByRole('region', { name: 'Your projects' });
    const rows = picker.getByRole('listitem');
    // Exactly the direct child folders of my workspace: files, hidden folders and the escaping symlink are not there.
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText('notes');
    await expect(rows.nth(0)).toContainText('not a Construct project yet');
    await expect(rows.nth(1)).toContainText('shop-app');
    await expect(rows.nth(1)).toContainText('Construct project');
    await expect(rows.nth(1)).not.toContainText('not a Construct project yet');
    await expect(rows.nth(2)).toContainText('web-ui');
    await expect(rows.nth(2)).toContainText('React');
    await expect(picker.getByText('passwords.txt')).toHaveCount(0);
    await expect(picker.getByText('.secret-cache')).toHaveCount(0);
    await expect(picker.getByText('sneaky-link')).toHaveCount(0);
    await expect(picker.getByText('off-limits')).toHaveCount(0);

    // No navigation of any kind: no path, breadcrumbs, up-a-level, open-a-subfolder, hidden toggle or typing.
    await expect(picker.getByTestId('dir-picker-path')).toHaveCount(0);
    await expect(picker.getByTestId('dir-picker-crumbs')).toHaveCount(0);
    await expect(picker.getByRole('button', { name: 'Up one level' })).toHaveCount(0);
    await expect(picker.getByRole('button', { name: /^Open / })).toHaveCount(0);
    await expect(picker.getByLabel('Show hidden folders')).toHaveCount(0);
    await expect(picker.getByRole('textbox')).toHaveCount(0);
    await expect(page.getByPlaceholder('Choose one of your projects below')).toHaveAttribute('readonly', '');
    // The only actions are one Select per listed project.
    await expect(picker.getByRole('button')).toHaveCount(3);

    // Choose (keyboard) - fills the field; Save applies it.
    await picker.getByRole('button', { name: 'Select shop-app' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByPlaceholder('Choose one of your projects below')).toHaveValue(path.join(root, 'shop-app'));
    await expect(picker).toHaveCount(0);
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByText('Settings saved.')).toBeVisible();
  });

  test('server refuses traversal, escape, foreign origin (real HTTP)', async ({ request }) => {
    const get = (p, headers) => request.get(`${API}/api/fs/browse`, { params: p ? { path: p } : {}, headers });
    expect((await get(path.join(root, '..'))).status()).toBe(403);
    expect((await get(`${root}/shop-app/../../off-limits`)).status()).toBe(403);
    expect((await get(path.join(root, 'sneaky-link'))).status()).toBe(403);
    expect((await get('/etc')).status()).toBe(403);
    // #568: one level only - even a real folder inside the workspace is not navigable, and answers like an outside one.
    expect((await get(path.join(root, 'passwords.txt'))).status()).toBe(400);
    const outside = await (await get('/etc')).text();
    for (const inside of [path.join(root, 'shop-app'), 'shop-app', path.join(root, 'notes')]) {
      const r = await get(inside);
      expect(r.status(), inside).toBe(403);
      expect(await r.text(), inside).toBe(outside);
    }
    expect((await get(root, { Origin: 'http://evil.example' })).status()).toBe(403);
    const ok = await (await get(root)).json();
    expect(JSON.stringify(ok)).not.toContain('passwords.txt');
    expect(ok.entries.map((e) => e.name)).toEqual(['notes', 'shop-app', 'web-ui']);
    expect(ok.parent).toBeNull();
    // Hidden folders stay hidden even when a client asks for them.
    const hidden = await (await request.get(`${API}/api/fs/browse`, { params: { showHidden: 'true' } })).json();
    expect(hidden.entries.map((e) => e.name)).not.toContain('.secret-cache');
  });
});
