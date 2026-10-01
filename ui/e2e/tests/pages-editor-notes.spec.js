import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gotoCockpit } from './support/cockpit.js';
import { makeBrowseProject, openProject } from './support/browseProject.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(__dirname, '../screenshots');
const API = process.env.E2E_API_BASE || 'http://localhost:4000';

// #832 (design 8.2's "Notes" inspector section), end to end against the REAL #373 Notes store -- a note created
// here is a real file under the state directory, and the standalone Notes screen (#596) reads it back with its
// anchor. The pin-on-preview half of #832's acceptance is not covered here: it is meant to land alongside #831's
// pin idiom, which is itself split to #835 pending new previewBridge rect machinery.
test.describe.serial('Inspector Notes section (#832)', () => {
  let project;
  let restore;

  test.beforeAll(async () => {
    project = makeBrowseProject('og832-notes-');
    restore = await openProject(API, project.repo);
  });
  test.afterAll(async () => {
    await restore?.();
    project?.remove();
  });

  async function openPage(page, feature, buttonName) {
    await page.goto('/pages');
    await expect(page.locator('h1')).toHaveText('Pages Editor');
    await page.locator('.pages-browser select').selectOption(feature);
    const openButton = page.getByRole('button', { name: buttonName });
    await expect(openButton).toBeVisible({ timeout: 10_000 });
    await openButton.click();
    await expect(page.locator('.tree-panel')).toBeVisible();
    await page.locator('.tree-node').first().click();
  }

  test('a node with no anchored notes shows "0 notes"; a different page shows its own, unrelated, "0 notes"', async ({ page }) => {
    await openPage(page, 'billing', 'BillingPage.tsx');
    const tools = page.getByRole('complementary', { name: 'Right panel: Inspect' });
    const panel = tools.getByTestId('node-notes-panel');
    await expect(panel).toBeVisible();
    await expect(panel.getByTestId('node-notes-count')).toHaveText('0 notes');

    await openPage(page, 'checkout', 'CheckoutPage.tsx');
    await expect(tools.getByTestId('node-notes-panel').getByTestId('node-notes-count')).toHaveText('0 notes');
  });

  test('adding a note anchors it to the selected node; it appears here and on the standalone Notes screen with its anchor', async ({ page }) => {
    await openPage(page, 'billing', 'BillingPage.tsx');
    const tools = page.getByRole('complementary', { name: 'Right panel: Inspect' });
    const panel = tools.getByTestId('node-notes-panel');
    await panel.locator('summary').click();
    await panel.getByTestId('node-notes-new-title').fill('Check this prop wiring');
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/notes') && r.request().method() === 'POST'),
      panel.getByTestId('node-notes-new-submit').click(),
    ]);

    await expect(panel.getByTestId('node-notes-count')).toHaveText('1 note');
    const list = panel.getByTestId('node-notes-list');
    await expect(list).toContainText('Check this prop wiring');
    await page.screenshot({ path: path.join(SHOTS, '832-node-notes.png') });

    // A different page's node still shows none of it -- the anchor is real, not a shared list.
    await openPage(page, 'checkout', 'CheckoutPage.tsx');
    await expect(tools.getByTestId('node-notes-panel').getByTestId('node-notes-count')).toHaveText('0 notes');

    // The standalone Notes screen (#373) reads the SAME note back, anchor included.
    await gotoCockpit(page, '/notes');
    const row = page.getByTestId('notes-row').filter({ hasText: 'Check this prop wiring' });
    await expect(row).toBeVisible();
    await expect(row.getByTestId('notes-row-anchor')).toContainText('billing');
    await expect(row.getByTestId('notes-row-anchor')).toContainText('BillingPage.tsx');
  });
});
