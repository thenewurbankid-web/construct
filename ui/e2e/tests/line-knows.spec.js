import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gotoCockpit } from './support/cockpit.js';
import { openProject } from './support/browseProject.js';
import { runAxe, isBlocking, format } from './support/axe.js';
import { failOnConsoleErrors } from './support/consoleGuard.js';

// "What Line knows" on a copy of the Line sample, real server: open orders and read "based on ListPage"; ask what breaks
// if OrderButton changes (InvoicesPage); in Change, plan "move OrderButton to the library", approve it, and the
// cross-feature finding is gone from the Map. Axe at 1280 and 375 px.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = path.resolve(__dirname, '../../../examples/line-sample');
const API = process.env.E2E_API_BASE || 'http://localhost:4000';

const axeClean = async (page) => {
  const found = await runAxe(page, { include: '[data-testid="line-knows"]' });
  expect(found.filter(isBlocking), format(found.filter(isBlocking))).toEqual([]);
};

test.describe.serial('Line: What Line knows (Line sample project)', () => {
  failOnConsoleErrors(test);
  test.setTimeout(120_000);
  let base;
  let restore;

  test.beforeAll(async () => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'line-sample-')));
    fs.cpSync(SAMPLE, base, { recursive: true });
    restore = await openProject(API, base);
  });
  test.afterAll(async () => {
    await restore?.();
    if (base) fs.rmSync(base, { recursive: true, force: true });
  });

  test('Map: open orders, read its bases, ask what breaks if OrderButton changes', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoCockpit(page, '/knows');
    const map = page.getByTestId('knows-map');
    await expect(map.getByTestId('knows-map-pick')).toBeVisible({ timeout: 60_000 });
    await axeClean(page);

    await map.getByTestId('knows-start').filter({ hasText: 'orders' }).filter({ hasText: 'Feature orders' }).click();
    await expect(map.getByTestId('knows-focus')).toHaveText('orders');
    await expect(map.getByTestId('knows-sentence').filter({ hasText: 'OrdersPage is based on ListPage.' })).toBeVisible();
    await expect(map.getByTestId('knows-sentence').first()).toContainText('InvoicesPage uses OrderButton from feature orders, which a feature may not do.');

    await map.getByTestId('knows-start').filter({ hasText: 'OrderButton' }).click();
    await expect(map.getByTestId('knows-focus')).toHaveText('OrderButton');
    await map.getByTestId('knows-what-breaks').click();
    const breaks = map.getByTestId('knows-breaks-list');
    await expect(breaks.getByTestId('knows-breaks-list-item').filter({ hasText: 'InvoicesPage' })).toBeVisible();
    await map.getByTestId('knows-who-uses').click();
    await expect(map.getByTestId('knows-who-uses-list')).toContainText('InvoicesPage');
    await expect(map.getByTestId('knows-picture')).toBeVisible();
    // The layer filter: with only the runtime layer on, the structure sentences go.
    for (const l of ['structure', 'static', 'process']) await map.getByTestId(`knows-layer-${l}`).uncheck();
    await expect(map.getByTestId('knows-sentence').filter({ hasText: 'is based on' })).toHaveCount(0);
    await map.getByTestId('knows-layer-structure').check();
    await axeClean(page);
  });

  test('Change: plan "move OrderButton to the library", approve it, and the finding is gone', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoCockpit(page, `/knows?tab=map&focus=${encodeURIComponent('item:orders/components/OrderButton')}`);
    await expect(page.getByTestId('knows-focus')).toHaveText('OrderButton', { timeout: 60_000 });
    await page.getByTestId('knows-change-it').click();
    const card = page.getByTestId('knows-change').filter({ hasText: /Move OrderButton.*into the library/ }).first();
    await expect(card).toHaveAttribute('data-state', 'proposed', { timeout: 60_000 });
    await axeClean(page);
    await card.getByTestId('knows-change-plan').click();
    await expect(card).toHaveAttribute('data-state', 'waiting');
    expect(fs.existsSync(path.join(base, 'library/components/OrderButton.tsx'))).toBe(false);
    await card.getByTestId('knows-change-approve').click();
    await expect(card).toHaveAttribute('data-state', 'done', { timeout: 60_000 });
    expect(fs.existsSync(path.join(base, 'library/components/OrderButton.tsx'))).toBe(true);
    // No proposal for the cross-feature finding is left, and the Map no longer reads it.
    await expect(page.getByTestId('knows-change').filter({ hasText: /Move OrderButton/ }).and(page.locator('[data-state="proposed"]'))).toHaveCount(0);
    await page.getByTestId('knows-tab-map').click();
    await page.getByTestId('knows-start').filter({ hasText: 'Feature billing' }).click();
    await expect(page.getByTestId('knows-focus')).toHaveText('billing');
    await expect(page.getByTestId('knows-sentence').filter({ hasText: 'which a feature may not do' })).toHaveCount(0);
    await expect(page.getByTestId('knows-sentence').filter({ hasText: /uses OrderButton from the library/ })).toBeVisible();
  });

  test('every tab is accessible at 375 px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    for (const tab of ['map', 'memory', 'change', 'smart']) {
      await gotoCockpit(page, `/knows?tab=${tab}&focus=${encodeURIComponent('feature:orders')}`);
      await expect(page.getByTestId(`knows-panel-${tab}`)).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId(`knows-panel-${tab}`).locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 60_000 });
      await axeClean(page);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `no sideways scroll on ${tab}`).toBeLessThanOrEqual(1);
    }
  });
});
