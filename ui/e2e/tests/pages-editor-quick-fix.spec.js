import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_BASE = process.env.E2E_API_BASE || 'http://localhost:4000';

// A clean page: no diagnostics until the test types a violating edit.
const FIXTURE_PAGE = `export default function HomePage({ title }: { title: string }) {
  return (
    <main>
      <h1>{title}</h1>
    </main>
  );
}
`;

// Typed onto the end of the buffer: a banned-layer import (PAGE-003), which
// packages/core/ruleFixes.mjs knows a deterministic fix for.
const BANNED_IMPORT = "import { fetchThing } from '../services/BillingService';\n";

/** Sets the Monaco model's value directly (typing key-by-key is eaten by
 * autocomplete) -- fires the editor's onChange, exactly like components-screen.spec.js's appendToSource. */
async function appendToSource(page, text) {
  const editor = page.locator('[data-source-editor="monaco"]');
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => Boolean(window.monaco?.editor.getModels().length))).toBe(true);
  await page.evaluate((extra) => {
    const model = window.monaco.editor.getModels()[0];
    model.setValue(extra + model.getValue());
  }, text);
}

test.describe('Pages Editor: code drill-down rule markers and quick fixes (#551)', () => {
  let tmpProjectDir;

  test.beforeAll(async ({ request }) => {
    tmpProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-ui-e2e-quick-fix-'));
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir: tmpProjectDir } });
    await request.post(`${API_BASE}/api/init`);
    await request.post(`${API_BASE}/api/create`, { data: { kind: 'single', name: 'Home', feature: 'billing', layer: 'page' } });
    fs.writeFileSync(path.join(tmpProjectDir, 'features/billing/pages/HomePage.tsx'), FIXTURE_PAGE);
  });

  test.afterAll(async ({ request }) => {
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir: path.resolve(__dirname, '../../..') } });
    fs.rmSync(tmpProjectDir, { recursive: true, force: true });
  });

  test('typing a banned import shows a marker without saving, and the Mechanical quick fix removes it', async ({ page }) => {
    await page.goto('/pages');
    await page.locator('.pages-browser select').selectOption('billing');
    await page.getByRole('button', { name: 'HomePage.tsx' }).click();
    await expect(page.locator('.tree-panel')).toBeVisible();

    await page.getByRole('tab', { name: 'Source' }).click();
    await page.getByRole('button', { name: 'View source' }).click();
    const monaco = page.locator('[data-source-editor="monaco"]');
    await expect(monaco).toBeVisible({ timeout: 30_000 });
    await expect(monaco.locator('.view-lines')).toContainText('HomePage', { timeout: 30_000 });

    // Clean buffer: no diagnostics yet.
    await expect(page.getByTestId('source-summary')).toContainText('No problems', { timeout: 15_000 });

    // Type an edit that violates PAGE-003 (a page importing straight from services/).
    await appendToSource(page, BANNED_IMPORT);

    // The buffer is unsaved (never written to disk) yet a marker appears -- this is the
    // "diagnostics track what's typed, not what was last saved" behaviour #551 adds.
    await expect
      .poll(() => page.evaluate(() => window.monaco?.editor.getModelMarkers({}).map((m) => m.code)), { timeout: 15_000 })
      .toContain('PAGE-003');
    await expect(monaco.locator('.squiggly-error').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('source-diagnostics')).toContainText('PAGE-003');
    const onDiskAfterEdit = fs.readFileSync(path.join(tmpProjectDir, 'features/billing/pages/HomePage.tsx'), 'utf8');
    expect(onDiskAfterEdit).toBe(FIXTURE_PAGE); // unsaved buffer never lands on disk

    // Open the quick fix for the PAGE-003 diagnostic (an unresolved import specifier also
    // trips IMPORT-001/TS2307 on this fixture -- scope to the one diagnostic under test).
    const pageRuleItem = page.getByTestId('source-diagnostics').locator('li').filter({ hasText: 'PAGE-003' });
    await pageRuleItem.getByTestId('quick-fix-open').click();
    const panel = page.getByTestId('quick-fix-panel');
    await expect(panel).toBeVisible();
    await panel.getByTestId('quick-fix-mechanical').click();

    // Reviewed as a diff before it lands -- never applied silently.
    const preview = page.getByTestId('quick-fix-preview');
    await expect(preview).toBeVisible({ timeout: 15_000 });
    await expect(preview).toContainText('BillingService');
    await preview.getByTestId('quick-fix-apply').click();

    // Applying replaces the in-memory draft; the import is gone and the marker clears -- still unsaved.
    await expect
      .poll(() => page.evaluate(() => window.monaco?.editor.getModels()[0]?.getValue()), { timeout: 15_000 })
      .not.toContain('BillingService');
    await expect
      .poll(() => page.evaluate(() => window.monaco?.editor.getModelMarkers({}).map((m) => m.code)), { timeout: 15_000 })
      .not.toContain('PAGE-003');
    expect(fs.readFileSync(path.join(tmpProjectDir, 'features/billing/pages/HomePage.tsx'), 'utf8')).toBe(FIXTURE_PAGE);
  });
});
