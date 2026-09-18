import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.resolve(__dirname, '../screenshots');
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

const API_BASE = 'http://localhost:4000';

// Ticket F.3 (#122, epic #119) — the visual composer's structural node
// toolbar (remove / move up / move down / add child), each writing back
// through the same save-back-to-source + diff-preview flow as F.1/F.2.
const FIXTURE_PAGE = `import React from 'react';
import { Card } from '../components/Card';
import { Aside } from '../components/Aside';

export default function HomePage() {
  return (
    <main>
      <Card />
      <Aside />
    </main>
  );
}
`;
const FIXTURE_CARD = `export function Card() {
  return <section>card</section>;
}
`;
const FIXTURE_ASIDE = `export function Aside() {
  return <aside>hi</aside>;
}
`;

test.describe('Pages Editor: visual composer structural node editing (#122, epic #119)', () => {
  let tmpProjectDir;
  let pagePath;

  test.beforeEach(async ({ request }) => {
    tmpProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-ui-e2e-flow-structure-'));
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir: tmpProjectDir } });
    await request.post(`${API_BASE}/api/init`);
    await request.post(`${API_BASE}/api/create`, { data: { kind: 'single', name: 'Home', feature: 'catalog', layer: 'page' } });
    pagePath = path.join(tmpProjectDir, 'features/catalog/pages/HomePage.tsx');
    fs.writeFileSync(pagePath, FIXTURE_PAGE);
    fs.mkdirSync(path.join(tmpProjectDir, 'features/catalog/components'), { recursive: true });
    fs.writeFileSync(path.join(tmpProjectDir, 'features/catalog/components/Card.tsx'), FIXTURE_CARD);
    fs.writeFileSync(path.join(tmpProjectDir, 'features/catalog/components/Aside.tsx'), FIXTURE_ASIDE);
  });

  test.afterEach(async ({ request }) => {
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir: path.resolve(__dirname, '../../..') } });
    fs.rmSync(tmpProjectDir, { recursive: true, force: true });
  });

  async function openMain(page) {
    await page.goto('/pages');
    await expect(page.locator('h1')).toHaveText('Pages Editor');
    await page.locator('.pages-browser select').selectOption('catalog');
    await page.getByRole('button', { name: 'HomePage.tsx' }).click();
    await expect(page.locator('.tree-panel')).toBeVisible();
    await page.locator('.tree-panel').getByText('<main>', { exact: true }).click();
    // F.4 (#123) made Code/Visual a real toggle -- Code is the default view.
    // Only needs clicking once per test: SnippetEditor stays mounted across
    // a tree re-selection (its `view` state isn't reset), so re-selecting
    // <main> later in a test after a save keeps showing Visual.
    await page.getByRole('button', { name: 'Visual', exact: true }).click();
    await expect(page.locator('.jsx-flow-node')).toHaveCount(3, { timeout: 10_000 });
    await page.locator('.snippet-flow-canvas').scrollIntoViewIfNeeded();
  }

  test('pages-editor-flow-structure.png — move/add-child/remove all patch the real source through the diff-preview flow', async ({ page }) => {
    await openMain(page);

    // Move <Card> down past <Aside>.
    const cardNode = page.locator('[data-id="n1"]');
    const [moveResp] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/api/pages/snippet-move-node')),
      cardNode.getByTitle('Move down').click(),
    ]);
    expect((await moveResp.json()).ok).toBe(true);
    await expect(page.locator('.snippet-diff-preview')).toBeVisible();
    // The line-based diff shows whichever single line actually changed
    // position relative to the other (here, <Card /> moving past the
    // unchanged <Aside /> line) — not necessarily both lines as "added".
    await expect(page.locator('.snippet-diff-preview')).toContainText('<Card />');
    await page.getByRole('button', { name: 'Confirm save' }).click();
    await expect(page.locator('.snippet-diff-preview')).toBeHidden();

    let saved = fs.readFileSync(pagePath, 'utf8');
    expect(saved.indexOf('<Aside')).toBeLessThan(saved.indexOf('<Card'));

    // Add a child <div/> to <main> (the root) — re-select it since the tree
    // refreshed after the save above.
    await page.locator('.tree-panel').getByText('<main>', { exact: true }).click();
    await expect(page.locator('.jsx-flow-node')).toHaveCount(3, { timeout: 10_000 });
    await page.locator('.snippet-flow-canvas').scrollIntoViewIfNeeded();
    const mainNode = page.locator('[data-id="n0"]');
    const [addResp] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/api/pages/snippet-add-child')),
      mainNode.getByTitle('Add child <div />').click(),
    ]);
    expect((await addResp.json()).ok).toBe(true);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'pages-editor-flow-structure.png') });
    await expect(page.locator('.snippet-diff-preview .diff-added')).toContainText('<div />');
    await page.getByRole('button', { name: 'Confirm save' }).click();
    await expect(page.locator('.snippet-diff-preview')).toBeHidden();
    saved = fs.readFileSync(pagePath, 'utf8');
    expect(saved).toContain('<div />');

    // Remove the <Aside> node.
    await page.locator('.tree-panel').getByText('<main>', { exact: true }).click();
    await expect(page.locator('.jsx-flow-node')).toHaveCount(4, { timeout: 10_000 });
    await page.locator('.snippet-flow-canvas').scrollIntoViewIfNeeded();
    const asideNode = page.locator('.jsx-flow-node').filter({ hasText: '<Aside>' }).locator('..');
    const [removeResp] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/api/pages/snippet-remove-node')),
      asideNode.getByTitle('Remove').click(),
    ]);
    expect((await removeResp.json()).ok).toBe(true);
    await expect(page.locator('.snippet-diff-preview .diff-removed')).toContainText('<Aside />');
    await page.getByRole('button', { name: 'Confirm save' }).click();
    await expect(page.locator('.snippet-diff-preview')).toBeHidden();
    saved = fs.readFileSync(pagePath, 'utf8');
    expect(saved).not.toContain('<Aside');
  });

  test('the root node has no Remove button, and moving past the last sibling shows an inline error', async ({ page }) => {
    await openMain(page);

    const mainNode = page.locator('[data-id="n0"]');
    await expect(mainNode.getByTitle('Remove')).toHaveCount(0);

    // <Aside> (n2) is already last — "move down" must be rejected inline,
    // not silently write anything.
    const asideNode = page.locator('[data-id="n2"]');
    const [moveResp] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/api/pages/snippet-move-node')),
      asideNode.getByTitle('Move down').click(),
    ]);
    expect((await moveResp.json()).ok).toBe(false);
    await expect(page.locator('.snippet-flow-wire-error')).toContainText('last position');
    await expect(page.locator('.snippet-diff-preview')).toBeHidden();
    expect(fs.readFileSync(pagePath, 'utf8')).toEqual(FIXTURE_PAGE);
  });
});
