import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.resolve(__dirname, '../screenshots');
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

const API_BASE = 'http://localhost:4000';

// Ticket F.4 (#123, epic #119) — the Code/Visual toggle on SnippetEditor.
const FIXTURE_PAGE = `import React from 'react';
import { Card } from '../components/Card';

export default function HomePage({ title }: { title: string }) {
  return (
    <main>
      <Card title={title} />
    </main>
  );
}
`;
const FIXTURE_CARD = `export function Card({ title }: { title: string }) {
  return <section>{title}</section>;
}
`;

test.describe('Pages Editor: SnippetEditor Code/Visual toggle (#123, epic #119)', () => {
  let tmpProjectDir;
  let pagePath;

  // beforeEach/afterEach (not once per describe) — two of these three tests
  // confirm a real save, so each needs its own untouched fixture rather
  // than sharing one file across tests.
  test.beforeEach(async ({ request }) => {
    tmpProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-ui-e2e-flow-toggle-'));
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir: tmpProjectDir } });
    await request.post(`${API_BASE}/api/init`);
    await request.post(`${API_BASE}/api/create`, { data: { kind: 'single', name: 'Home', feature: 'catalog', layer: 'page' } });
    pagePath = path.join(tmpProjectDir, 'features/catalog/pages/HomePage.tsx');
    fs.writeFileSync(pagePath, FIXTURE_PAGE);
    fs.mkdirSync(path.join(tmpProjectDir, 'features/catalog/components'), { recursive: true });
    fs.writeFileSync(path.join(tmpProjectDir, 'features/catalog/components/Card.tsx'), FIXTURE_CARD);
  });

  test.afterEach(async ({ request }) => {
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir: path.resolve(__dirname, '../../..') } });
    fs.rmSync(tmpProjectDir, { recursive: true, force: true });
  });

  test('pages-editor-flow-toggle.png — only one view is mounted at a time, and only Code is shown by default', async ({ page }) => {
    await page.goto('/pages');
    await page.locator('.pages-browser select').selectOption('catalog');
    await page.getByRole('button', { name: 'HomePage.tsx' }).click();
    await expect(page.locator('.tree-panel')).toBeVisible();
    await page.locator('.tree-panel').getByText('<main>', { exact: true }).click();

    await expect(page.locator('.snippet-textarea')).toBeVisible();
    await expect(page.locator('.snippet-flow-canvas')).toHaveCount(0);
    await expect(page.getByRole('tablist', { name: 'Snippet view' }).getByRole('button', { name: 'Code' })).toHaveClass(/active/);

    await page.getByRole('button', { name: 'Visual', exact: true }).click();
    await expect(page.locator('.snippet-textarea')).toHaveCount(0);
    await expect(page.locator('.snippet-flow-canvas')).toBeVisible();
    await expect(page.locator('.jsx-flow-node')).toHaveCount(2, { timeout: 10_000 });
    await page.locator('.snippet-flow-canvas').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'pages-editor-flow-toggle.png') });
  });

  test('no edits are lost switching views mid-edit, in either direction', async ({ page }) => {
    await page.goto('/pages');
    await page.locator('.pages-browser select').selectOption('catalog');
    await page.getByRole('button', { name: 'HomePage.tsx' }).click();
    await expect(page.locator('.tree-panel')).toBeVisible();
    await page.locator('.tree-panel').getByText('<main>', { exact: true }).click();

    // Edit in Code, switch to Visual — the graph must reflect the unsaved
    // hand-typed change (two nodes, not one) before any save happens.
    const textarea = page.locator('.snippet-textarea');
    await expect(textarea).toHaveValue(/<Card title=\{title\} \/>/);
    await textarea.fill('<main>\n      <Card title={title} />\n      <Card title={title} />\n    </main>');
    await page.getByRole('button', { name: 'Visual', exact: true }).click();
    await expect(page.locator('.jsx-flow-node')).toHaveCount(3, { timeout: 10_000 });

    // Add a child visually, switch back to Code — the textarea must show
    // both the earlier hand-typed change AND the visual op's new text.
    const mainNode = page.locator('[data-id="n0"]');
    await page.locator('.snippet-flow-canvas').scrollIntoViewIfNeeded();
    const [addResp] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/api/pages/snippet-add-child')),
      mainNode.getByTitle('Add child <div />').click(),
    ]);
    expect((await addResp.json()).ok).toBe(true);

    await page.getByRole('button', { name: 'Code', exact: true }).click();
    await expect(textarea).toHaveValue(/<Card title=\{title\} \/>\s*<Card title=\{title\} \/>\s*<div \/>/);

    // The visual add-child op already opened the diff preview (same
    // auto-preview behavior as a rewired wire, #121/#122) — switching back
    // to Code doesn't close it, so "Confirm save" is already showing.
    await expect(page.locator('.snippet-diff-preview')).toBeVisible();
    const [saveResponse] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/api/pages/node') && res.request().method() === 'POST'),
      page.getByRole('button', { name: 'Confirm save' }).click(),
    ]);
    expect(saveResponse.ok()).toBeTruthy();
    const saved = fs.readFileSync(pagePath, 'utf8');
    expect((saved.match(/<Card title=\{title\} \/>/g) || []).length).toBe(2);
    expect(saved).toContain('<div />');
  });

  test('enforcement applies identically after toggling views — a fetch() call is still blocked by PAGE-004', async ({ page }) => {
    await page.goto('/pages');
    await page.locator('.pages-browser select').selectOption('catalog');
    await page.getByRole('button', { name: 'HomePage.tsx' }).click();
    await expect(page.locator('.tree-panel')).toBeVisible();
    await page.locator('.tree-panel').getByText('<main>', { exact: true }).click();

    const before = fs.readFileSync(pagePath, 'utf8');

    // Toggle to Visual and back to Code — proves the save path isn't
    // reset/bypassed by having visited the other view first.
    await page.getByRole('button', { name: 'Visual', exact: true }).click();
    await expect(page.locator('.jsx-flow-node')).toHaveCount(2, { timeout: 10_000 });
    await page.getByRole('button', { name: 'Code', exact: true }).click();

    const textarea = page.locator('.snippet-textarea');
    await expect(textarea).toHaveValue(/<Card title=\{title\} \/>/);
    await textarea.fill('<main>\n      <Card title={title} onClick={() => fetch("/api/x")} />\n    </main>');
    await page.getByRole('button', { name: 'Preview & save' }).click();
    const [saveResponse] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/api/pages/node') && res.request().method() === 'POST'),
      page.getByRole('button', { name: 'Confirm save' }).click(),
    ]);
    expect(saveResponse.status()).toBe(422);
    expect((await saveResponse.json()).ok).toBe(false);

    const errorStatus = page.locator('.status-error').first();
    await expect(errorStatus).toBeVisible({ timeout: 10_000 });
    await expect(errorStatus.locator('.violation-list')).toContainText('PAGE-004');
    expect(fs.readFileSync(pagePath, 'utf8')).toEqual(before);
  });
});
