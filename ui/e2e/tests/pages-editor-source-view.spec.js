import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.resolve(__dirname, '../screenshots');
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
const API_BASE = process.env.E2E_API_BASE || 'http://localhost:4000';

// A page with a real type error on line 2.
const FIXTURE_PAGE = `export default function HomePage({ title }: { title: string }) {
  const count: number = 'three';
  return (
    <main>
      <h1>{title}</h1>
      <p>{count}</p>
    </main>
  );
}
`;

test.describe('Pages Editor: Monaco source view with diagnostics', () => {
  let tmpProjectDir;

  test.beforeAll(async ({ request }) => {
    tmpProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-ui-e2e-source-view-'));
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir: tmpProjectDir } });
    await request.post(`${API_BASE}/api/init`);
    await request.post(`${API_BASE}/api/create`, { data: { kind: 'single', name: 'Home', feature: 'billing', layer: 'page' } });
    fs.writeFileSync(path.join(tmpProjectDir, 'features/billing/pages/HomePage.tsx'), FIXTURE_PAGE);
  });

  test.afterAll(async ({ request }) => {
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir: path.resolve(__dirname, '../../..') } });
    fs.rmSync(tmpProjectDir, { recursive: true, force: true });
  });

  test('API: /api/pages/source returns source + diagnostics and is pages/-scoped', async ({ request }) => {
    const ok = await request.get(`${API_BASE}/api/pages/source?feature=billing&file=HomePage.tsx`);
    const body = await ok.json();
    expect(body.source).toBe(FIXTURE_PAGE);
    expect(body.diagnostics.some((d) => d.code === 'TS2322' && d.line === 2)).toBe(true);
    const escape = await request.get(`${API_BASE}/api/pages/source?feature=billing&file=${encodeURIComponent('../../../architecture.yml')}`);
    expect(escape.status()).toBe(400);
  });

  test('pages-editor-source-view.png — Monaco shows the full source with an error marker and a diagnostics list', async ({ page }) => {
    await page.goto('/pages');
    await page.locator('.pages-browser select').selectOption('billing');
    await page.getByRole('button', { name: 'HomePage.tsx' }).click();
    await expect(page.locator('.tree-panel')).toBeVisible();

    // Source is a tab of the shell's Tools panel (#247).
    await page.getByRole('tab', { name: 'Source' }).click();
    await page.getByRole('button', { name: 'View source' }).click();
    const monaco = page.locator('[data-source-editor="monaco"]');
    await expect(monaco).toBeVisible({ timeout: 30_000 });
    await expect(monaco.locator('.view-lines')).toContainText('HomePage', { timeout: 30_000 });

    // The type error is a real Monaco marker (error severity, line 2)...
    await expect
      .poll(() => page.evaluate(() => window.monaco?.editor.getModelMarkers({}).map((m) => ({ code: m.code, severity: m.severity, line: m.startLineNumber }))), { timeout: 15_000 })
      .toEqual([{ code: 'TS2322', severity: 8, line: 2 }]);
    // ...drawn as a visible squiggle in the (read-only) editor...
    await expect(monaco.locator('.squiggly-error').first()).toBeVisible({ timeout: 15_000 });
    // ...and listed with its code and position, with a summary line.
    await expect(page.getByTestId('source-summary')).toContainText('error');
    await expect(page.getByTestId('source-diagnostics')).toContainText('TS2322');
    await expect(page.getByTestId('source-diagnostics')).toContainText('line 2');

    await page.locator('.source-panel').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'pages-editor-source-view.png'), fullPage: true });
  });
});
