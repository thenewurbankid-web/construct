import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(__dirname, '../screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const API_BASE = process.env.E2E_API_BASE || 'http://localhost:4000';

// #375 — the stage's own editor tab strip: a pinned Preview tab plus a
// breadcrumb (Pages > feature > file [> selected node]); opening a file's
// source joins the strip as a second, closeable tab.
const FIXTURE_PAGE = `export default function LoginPage({ title }: { title: string }) {
  return (
    <main>
      <h1>{title}</h1>
    </main>
  );
}
`;

test.describe.serial('Pages Editor: stage tab strip + breadcrumb (#375)', () => {
  let tmpProjectDir;

  test.beforeAll(async ({ request }) => {
    tmpProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-ui-e2e-pe-stage-tabs-'));
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir: tmpProjectDir } });
    await request.post(`${API_BASE}/api/init`);
    await request.post(`${API_BASE}/api/create`, { data: { kind: 'single', name: 'Login', feature: 'auth', layer: 'page' } });
    fs.writeFileSync(path.join(tmpProjectDir, 'features/auth/pages/LoginPage.tsx'), FIXTURE_PAGE);
  });

  test.afterAll(async ({ request }) => {
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir: path.resolve(__dirname, '../../..') } });
    fs.rmSync(tmpProjectDir, { recursive: true, force: true });
  });

  test('pages-editor-stage-tabs.png — Preview is pinned, breadcrumb shows the path, View source opens a closeable tab', async ({ page }) => {
    await page.goto('/pages');
    await page.locator('.pages-browser select').selectOption('auth');
    await page.getByRole('button', { name: 'LoginPage.tsx' }).click();
    await expect(page.locator('.tree-panel')).toBeVisible();

    // Breadcrumb: Pages > auth > LoginPage.tsx
    const crumb = page.getByTestId('pe-breadcrumb');
    await expect(crumb).toContainText('Pages');
    await expect(crumb).toContainText('auth');
    await expect(crumb).toContainText('LoginPage.tsx');

    // Preview tab: pinned, active, no close button.
    const previewTab = page.getByRole('tab', { name: 'Preview' });
    await expect(previewTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.pe-tab--pinned .pe-tab-close')).toHaveCount(0);
    await expect(page.locator('.live-preview-panel, .preview-panel').first()).toBeVisible();

    // Open the file's source as a second, closeable tab.
    await page.getByRole('button', { name: 'Open source' }).click();
    const sourceTab = page.getByRole('tab', { name: 'LoginPage.tsx' });
    await expect(sourceTab).toHaveAttribute('aria-selected', 'true');
    await expect(previewTab).toHaveAttribute('aria-selected', 'false');
    await expect(page.locator('[data-source-editor]').first()).toBeVisible({ timeout: 30_000 });

    await page.screenshot({ path: path.join(SHOTS, 'pages-editor-stage-tabs.png'), fullPage: true });

    // Close the source tab: back to Preview, tab is gone.
    await page.getByRole('button', { name: 'Close LoginPage.tsx' }).click();
    await expect(previewTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: 'LoginPage.tsx' })).toHaveCount(0);
  });
});
