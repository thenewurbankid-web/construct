import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.resolve(__dirname, '../screenshots');
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

const API_BASE = process.env.E2E_API_BASE || 'http://localhost:4000';

const BEFORE = `import type { ReactNode } from 'react';

export default function HomePage({ title }: { title: string }): ReactNode {
  return (
    <main>
      <h1>{title}</h1>
    </main>
  );
}
`;

const AFTER = BEFORE.replace('<h1>{title}</h1>', '<h1 className="hero">{title}</h1>\n      <p>Edited by an agent</p>');

// #224 — a page file changed on disk outside the editor (agent/CLI) shows a
// notice plus a readable before/after diff.
test.describe('Pages Editor: last external change as a diff (#224)', () => {
  let tmpProjectDir;
  let pagePath;

  test.beforeAll(async ({ request }) => {
    tmpProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-ui-e2e-ext-change-'));
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir: tmpProjectDir } });
    await request.post(`${API_BASE}/api/init`);
    await request.post(`${API_BASE}/api/create`, { data: { kind: 'single', name: 'Home', feature: 'billing', layer: 'page' } });
    pagePath = path.join(tmpProjectDir, 'features/billing/pages/HomePage.tsx');
    fs.writeFileSync(pagePath, BEFORE);
  });

  test.afterAll(async ({ request }) => {
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir: path.resolve(__dirname, '../../..') } });
    fs.rmSync(tmpProjectDir, { recursive: true, force: true });
  });

  test('external write shows a notice and diff; dismiss hides it; scope guard holds', async ({ page, request }) => {
    await page.goto('/pages');
    await page.locator('.pages-browser select').selectOption('billing');
    await page.getByRole('button', { name: 'HomePage.tsx' }).click();
    await expect(page.locator('.tree-panel')).toBeVisible();
    await expect(page.locator('.external-change-notice')).toHaveCount(0);

    // Simulate an agent editing the file behind the editor's back.
    fs.writeFileSync(pagePath, AFTER);

    const notice = page.locator('.external-change-notice');
    await expect(notice).toBeVisible({ timeout: 10_000 });
    await expect(notice).toContainText('HomePage.tsx changed outside the editor');
    await expect(notice.locator('.diff-view-removed')).toContainText('<h1>{title}</h1>');
    await expect(notice.locator('.diff-view-added').first()).toContainText('className="hero"');
    await expect(notice.locator('.diff-view-added').nth(1)).toContainText('Edited by an agent');
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'pages-editor-external-change-diff.png'), fullPage: true });

    // Reloading refreshes the tree from disk and clears the notice.
    await notice.getByRole('button', { name: 'Reload from disk' }).click();
    await expect(notice).toHaveCount(0);
    await expect(page.locator('.tree-panel')).toContainText('<p>');

    // A second external change appears again; Dismiss clears it.
    fs.writeFileSync(pagePath, BEFORE);
    await expect(notice).toBeVisible({ timeout: 10_000 });
    await notice.getByRole('button', { name: 'Dismiss' }).click();
    await expect(notice).toHaveCount(0);

    // Path-scoped like every other route.
    const escaped = await request.get(`${API_BASE}/api/pages/changes?feature=billing&file=${encodeURIComponent('../../../architecture.yml')}`);
    expect(escaped.status()).toBe(400);
  });
});
