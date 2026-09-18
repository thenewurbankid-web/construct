import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.resolve(__dirname, '../screenshots');
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

const API_BASE = 'http://localhost:4000';
const ROW_COUNT = 30;

// #77 follow-up to #51: TreePanel.tsx and PreviewPanel.tsx are already
// bidirectionally linked via selectedId/onSelect, but nothing brought the
// corresponding row/box into view in the *other* panel when it was
// scrolled out of sight for a tall tree. This fixture is 30 flat sibling
// custom-component tags (`<Row0/>` .. `<Row29/>`) under one root — plenty
// to overflow both panels' `max-height: 70vh; overflow: auto`, so the last
// row starts genuinely off-screen in both.
function buildFixturePage() {
  const rows = Array.from({ length: ROW_COUNT }, (_, i) => `      <Row${i} />`).join('\n');
  return `import React from 'react';\n\nexport default function TallPage() {\n  return (\n    <main>\n${rows}\n    </main>\n  );\n}\n`;
}

/** Bounding box of `locator`, relative to nothing in particular — just
 * enough to compare against a container's own box below. */
async function box(locator) {
  const b = await locator.boundingBox();
  if (!b) throw new Error('locator has no bounding box (not rendered/visible)');
  return b;
}

function isFullyWithin(inner, outer) {
  return inner.y >= outer.y && inner.y + inner.height <= outer.y + outer.height;
}

test.describe.serial('Pages Editor auto-scroll tree/preview sync for tall trees (#77 follow-up to #51)', () => {
  let tmpProjectDir;

  test.beforeAll(async ({ request }) => {
    tmpProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-ui-e2e-autoscroll-'));
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir: tmpProjectDir } });
    await request.post(`${API_BASE}/api/init`);
    await request.post(`${API_BASE}/api/create`, { data: { kind: 'single', name: 'Tall', feature: 'listing', layer: 'page' } });

    const pagePath = path.join(tmpProjectDir, 'features/listing/pages/TallPage.tsx');
    fs.writeFileSync(pagePath, buildFixturePage());
  });

  test.afterAll(async ({ request }) => {
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir: path.resolve(__dirname, '../../..') } });
    fs.rmSync(tmpProjectDir, { recursive: true, force: true });
  });

  test('pages-editor-autoscroll.png — selecting an off-screen row from either panel scrolls it into view in the other', async ({ page }) => {
    await page.goto('/pages');
    await expect(page.locator('h1')).toHaveText('Pages Editor');
    await page.locator('.pages-browser select').selectOption('listing');
    const openButton = page.getByRole('button', { name: 'TallPage.tsx' });
    await expect(openButton).toBeVisible({ timeout: 10_000 });
    await openButton.click();

    const treePanel = page.locator('.tree-panel');
    const previewPanel = page.locator('.preview-panel');
    await expect(treePanel).toBeVisible();
    await expect(previewPanel).toBeVisible();

    const lastTag = `<Row${ROW_COUNT - 1}>`;
    const treeRow29 = treePanel.locator('.tree-node-tag', { hasText: lastTag });
    const previewRow29 = previewPanel.locator('.preview-node-label', { hasText: `Row${ROW_COUNT - 1}` });
    await expect(treeRow29).toHaveCount(1);
    await expect(previewRow29).toHaveCount(1);

    // Baseline: with nothing selected yet and both panels freshly loaded
    // (scrollTop 0), the fixture is genuinely tall enough that the last
    // row starts outside both panels' visible area — otherwise this test
    // wouldn't be proving anything.
    const treeBoxBefore = await box(treePanel);
    const treeRowBoxBefore = await box(treeRow29);
    expect(isFullyWithin(treeRowBoxBefore, treeBoxBefore)).toBe(false);
    const previewBoxBefore = await box(previewPanel);
    const previewRowBoxBefore = await box(previewRow29);
    expect(isFullyWithin(previewRowBoxBefore, previewBoxBefore)).toBe(false);

    // --- Direction 1: select from the tree -> preview panel scrolls. ---
    // Reset preview's own scroll first so any movement it makes is
    // unambiguously this feature's doing, not a leftover position.
    await previewPanel.evaluate((el) => { el.scrollTop = 0; });
    // Playwright scrolls the TREE panel itself as part of performing the
    // click (ordinary actionability, not this feature) -- that's expected
    // and irrelevant to what's being asserted here. Clicking the tag span
    // itself (not trying to select its ancestor .tree-node div, which
    // would ambiguously also match an outer/parent row via a `has`
    // filter) bubbles up to the row's own onClick same as clicking
    // anywhere else in it would.
    await treeRow29.click();
    await expect(page.locator('.preview-node.selected .preview-node-label', { hasText: `Row${ROW_COUNT - 1}` })).toBeVisible();
    await expect(async () => {
      const previewBox = await box(previewPanel);
      const previewRowBox = await box(previewRow29);
      expect(isFullyWithin(previewRowBox, previewBox)).toBe(true);
    }).toPass({ timeout: 2000 });

    // --- Direction 2: select from the preview -> tree panel scrolls. ---
    // Row29 is already the selected node from direction 1 -- clicking it
    // again in the preview wouldn't change `selectedId` at all (same id),
    // so the effect that watches it wouldn't re-run just because the
    // scrollTop was reset out-of-band below. Select a different node
    // first so the upcoming Row29 click is a genuine selection change.
    const treeRow0 = treePanel.locator('.tree-node-tag', { hasText: '<Row0>' });
    await expect(treeRow0).toHaveCount(1);
    await treeRow0.click();
    await expect(page.locator('.tree-node.selected .tree-node-tag', { hasText: '<Row0>' })).toBeVisible();

    await treePanel.evaluate((el) => { el.scrollTop = 0; });
    // Re-verify the reset actually put the tree row back out of view
    // before using it as this direction's baseline.
    const treeBoxReset = await box(treePanel);
    const treeRowBoxReset = await box(treeRow29);
    expect(isFullyWithin(treeRowBoxReset, treeBoxReset)).toBe(false);

    // Same reasoning as treeRow29.click() above -- click the label itself
    // rather than an ambiguous `has`-filtered ancestor lookup (main's own
    // outer box structurally "has" every row as a descendant too).
    await previewRow29.click();
    await expect(page.locator('.tree-node.selected .tree-node-tag', { hasText: lastTag })).toBeVisible();
    await expect(async () => {
      const treeBox = await box(treePanel);
      const treeRowBox = await box(treeRow29);
      expect(isFullyWithin(treeRowBox, treeBox)).toBe(true);
    }).toPass({ timeout: 2000 });

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'pages-editor-autoscroll.png'), fullPage: true });
  });
});
