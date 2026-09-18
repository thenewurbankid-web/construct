import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.resolve(__dirname, '../screenshots');
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

const API_BASE = 'http://localhost:4000';

// #160 — the SnippetEditor heading ("Snippet (<nodeId>) — isolated to this
// node only") and the Code/Visual view toggle directly beneath it had no
// real spacing between them (both sat against the global `* { margin: 0 }`
// reset with only the toggle's own 8px margin between them), so once the
// heading wrapped to two lines in the Pages Editor's third grid column the
// wrapped second line ("...only") sat right against the toggle buttons —
// cramped/overlapping rather than clearly separated. This test proves the
// heading's bottom edge and the toggle's top edge have a real visual gap.
const FIXTURE_PAGE = `import React from 'react';

export default function HomePage({ title }: { title: string }) {
  return (
    <main>
      <h1>{title}</h1>
    </main>
  );
}
`;

test.describe.serial('Pages Editor layout: snippet heading / view-toggle spacing (#160)', () => {
  let tmpProjectDir;

  test.beforeAll(async ({ request }) => {
    tmpProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-ui-e2e-layout-'));
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir: tmpProjectDir } });
    await request.post(`${API_BASE}/api/init`);
    await request.post(`${API_BASE}/api/create`, { data: { kind: 'single', name: 'Home', feature: 'billing', layer: 'page' } });
    fs.writeFileSync(path.join(tmpProjectDir, 'features/billing/pages/HomePage.tsx'), FIXTURE_PAGE);
  });

  test.afterAll(async ({ request }) => {
    // Same restore-known-good-projectDir rationale as pages-editor-editing.spec.js.
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir: path.resolve(__dirname, '../../..') } });
    fs.rmSync(tmpProjectDir, { recursive: true, force: true });
  });

  test('1. pages-editor-snippet-toggle-spacing.png — snippet heading does not crowd the Code/Visual toggle', async ({ page }) => {
    await page.goto('/pages');
    await expect(page.locator('h1')).toHaveText('Pages Editor');
    await page.locator('.pages-browser select').selectOption('billing');
    const openButton = page.getByRole('button', { name: 'HomePage.tsx' });
    await expect(openButton).toBeVisible({ timeout: 10_000 });
    await openButton.click();
    await expect(page.locator('.tree-panel')).toBeVisible();
    await page.locator('.tree-panel').getByText('<h1>', { exact: true }).click();

    const heading = page.locator('.snippet-editor h4');
    const toggle = page.locator('.snippet-view-toggle');
    await expect(heading).toBeVisible();
    await expect(toggle).toBeVisible();

    const headingBox = await heading.boundingBox();
    const toggleBox = await toggle.boundingBox();
    expect(headingBox).not.toBeNull();
    expect(toggleBox).not.toBeNull();

    // The bug: heading's bottom edge at/below the toggle's top edge (zero or
    // negative gap = visually crowded or overlapping). Require a real gap.
    const gap = toggleBox.y - (headingBox.y + headingBox.height);
    expect(gap).toBeGreaterThanOrEqual(6);

    await page.locator('.inspector-panel').screenshot({ path: path.join(SCREENSHOTS_DIR, 'pages-editor-snippet-toggle-spacing.png') });
  });

  // #160 (second half) — the visual composer canvas's React Flow zoom
  // controls (+/-/fit-view, bottom-left of the canvas) rendered with the
  // library's default *light*-theme colors (near-white buttons, near-
  // invisible icons) against this app's dark theme — visually broken
  // "floating" buttons. SnippetFlowCanvas.tsx now passes colorMode="dark"
  // plus matching border/background overrides in globals.css.
  test('2. pages-editor-flow-controls-dark.png — visual composer zoom controls are dark-themed, not default-light', async ({ page }) => {
    await page.goto('/pages');
    await page.locator('.pages-browser select').selectOption('billing');
    await page.getByRole('button', { name: 'HomePage.tsx' }).click();
    await expect(page.locator('.tree-panel')).toBeVisible();
    await page.locator('.tree-panel').getByText('<h1>', { exact: true }).click();
    await page.getByRole('button', { name: 'Visual', exact: true }).click();
    await expect(page.locator('.react-flow__controls')).toBeVisible();

    const bg = await page.locator('.react-flow__controls-button').first().evaluate((el) => getComputedStyle(el).backgroundColor);
    // Library default light-mode button background is #fefefe (rgb(254, 254, 254));
    // confirm it's been overridden to a dark value instead.
    expect(bg).not.toBe('rgb(254, 254, 254)');

    await page.locator('.inspector-panel').screenshot({ path: path.join(SCREENSHOTS_DIR, 'pages-editor-flow-controls-dark.png') });
  });
});
