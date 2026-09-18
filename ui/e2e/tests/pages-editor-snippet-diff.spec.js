import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.resolve(__dirname, '../screenshots');
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

const API_BASE = process.env.E2E_API_BASE || 'http://localhost:4000';

const FIXTURE_PAGE = `import type { ReactNode } from 'react';

export default function HomePage({ title }: { title: string }): ReactNode {
  return (
    <main>
      <h1>{title}</h1>
    </main>
  );
}
`;

// #81 — the isolated snippet editor gained JSX syntax highlighting and a
// diff preview shown before a save-back-to-source is committed. This is
// dedicated, real Playwright coverage for both (the existing pages-editor-
// editing.spec.js suite only drives the confirm step quickly to keep
// testing #52/#56's save-back mechanics; this file is the one that
// actually shows the highlighted editor and the diff panel on screen).
test.describe('Pages Editor: snippet syntax highlighting + diff preview (#81)', () => {
  let tmpProjectDir;
  let pagePath;

  test.beforeAll(async ({ request }) => {
    tmpProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-ui-e2e-snippet-diff-'));
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir: tmpProjectDir } });
    await request.post(`${API_BASE}/api/init`);
    await request.post(`${API_BASE}/api/create`, { data: { kind: 'single', name: 'Home', feature: 'billing', layer: 'page' } });
    pagePath = path.join(tmpProjectDir, 'features/billing/pages/HomePage.tsx');
    fs.writeFileSync(pagePath, FIXTURE_PAGE);
  });

  test.afterAll(async ({ request }) => {
    // Same restoration as pages-editor-editing.spec.js — other spec files
    // share one backend process's global projectDir setting.
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir: path.resolve(__dirname, '../../..') } });
    fs.rmSync(tmpProjectDir, { recursive: true, force: true });
  });

  test('1. pages-editor-snippet-highlight.png — the snippet editor renders real JSX syntax highlighting', async ({ page }) => {
    await page.goto('/pages');
    await expect(page.locator('h1')).toHaveText('Pages Editor');
    await page.locator('.pages-browser select').selectOption('billing');
    await page.getByRole('button', { name: 'HomePage.tsx' }).click();
    await expect(page.locator('.tree-panel')).toBeVisible();
    await page.locator('.tree-panel').getByText('<h1>', { exact: true }).click();

    const textarea = page.locator('.snippet-textarea');
    await expect(textarea).toBeVisible();
    await expect(textarea).toHaveValue('<h1>{title}</h1>');

    // The overlay textarea is transparent — its own text isn't what's
    // visible on screen; the highlighted <pre> underneath is. Prove it's
    // real tokenized markup (Prism's own token classes), not a static
    // image or a plain unstyled string.
    const highlight = page.locator('.snippet-highlight');
    await expect(highlight).toBeVisible();
    await expect(highlight.locator('.token.tag').first()).toBeVisible();
    await expect(highlight.locator('.token.tag').first()).toContainText('h1');
    // The transparent textarea and the highlighted <pre> underneath must
    // show the identical text content (proves they're actually in sync,
    // not just two unrelated boxes stacked on top of each other).
    await expect(highlight).toContainText('h1');
    await expect(highlight).toContainText('title');

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'pages-editor-snippet-highlight.png'), fullPage: true });
  });

  test('2. pages-editor-snippet-diff-preview.png — editing shows a real diff before the save is confirmed', async ({ page }) => {
    await page.goto('/pages');
    await expect(page.locator('h1')).toHaveText('Pages Editor');
    await page.locator('.pages-browser select').selectOption('billing');
    await page.getByRole('button', { name: 'HomePage.tsx' }).click();
    await expect(page.locator('.tree-panel')).toBeVisible();
    await page.locator('.tree-panel').getByText('<h1>', { exact: true }).click();

    const textarea = page.locator('.snippet-textarea');
    await expect(textarea).toHaveValue('<h1>{title}</h1>');
    await textarea.fill('<h1 className="headline">{title}</h1>');

    // "Preview & save" must NOT save immediately — only open the diff.
    const previewButton = page.getByRole('button', { name: 'Preview & save' });
    await expect(previewButton).toBeEnabled();
    await previewButton.click();

    const diffPreview = page.locator('.snippet-diff-preview');
    await expect(diffPreview).toBeVisible();
    // A real before/after diff: the old line removed, the new line added.
    await expect(diffPreview.locator('.diff-removed')).toContainText('<h1>{title}</h1>');
    await expect(diffPreview.locator('.diff-added')).toContainText('<h1 className="headline">{title}</h1>');

    // Nothing written to disk yet — the whole point of a preview step.
    const beforeConfirm = fs.readFileSync(pagePath, 'utf8');
    expect(beforeConfirm).not.toContain('className="headline"');

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'pages-editor-snippet-diff-preview.png'), fullPage: true });

    // Cancel must close the preview and leave the source file untouched.
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(diffPreview).toBeHidden();
    expect(fs.readFileSync(pagePath, 'utf8')).toEqual(beforeConfirm);

    // Re-open the preview and actually confirm this time.
    await previewButton.click();
    await expect(page.locator('.snippet-diff-preview')).toBeVisible();
    const [response] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/api/pages/node') && res.request().method() === 'POST'),
      page.getByRole('button', { name: 'Confirm save' }).click(),
    ]);
    expect(response.ok()).toBeTruthy();
    expect(fs.readFileSync(pagePath, 'utf8')).toContain('className="headline"');
  });
});
