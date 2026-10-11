import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { openProject } from '../tests/support/browseProject.js';
import { waitForCockpitReady } from '../tests/support/cockpit.js';
import { API, copySample, watchForProblems } from './support/owner.js';

// cg1 UAT (docs/line/review.md "cg1", "UAT"), walked as the owner would: turn Trace on, say what you want, see the
// controls light up here and follow the link to the screen where the rest are. Fails on any console error or 4xx/5xx.
test.describe.serial('UAT cg1: Trace highlights the controls for what you ask', () => {
  test.describe.configure({ timeout: 90_000 });
  let base;
  let restore;
  test.beforeAll(async () => {
    base = copySample();
    restore = await openProject(API, base);
  });
  test.afterAll(async () => {
    await restore?.();
    if (base) fs.rmSync(base, { recursive: true, force: true });
  });

  test('1-3: Components, Trace on, ask, see Badge light up; follow the link to Pages for a page change', async ({ page }) => {
    const watch = watchForProblems(page);
    // 1. Open Components.
    await page.goto('/components');
    await waitForCockpitReady(page); // the owner waits for Cockpit to finish loading before typing
    const bar = page.getByRole('region', { name: 'Trace and Auto' });
    await expect(bar).toBeVisible({ timeout: 60_000 });
    // 2. Click Trace (one click) and type the request.
    await bar.getByRole('button', { name: 'Trace' }).click();
    await bar.getByLabel('What do you want to do?').fill('Base a new StatusBadge on Badge in orders');
    await expect(bar.getByRole('status').first()).toHaveText('Base a new StatusBadge on Badge in orders. The lit controls do it.');
    await expect(page.getByRole('button', { name: 'Base on this: Badge' })).toHaveAttribute('data-line-lit', 'request');
    await expect(bar.getByText(/^Lit here: Base on this \(Badge\)/)).toBeVisible();
    // 3. Ask for a page change: a link goes to Pages, where the feature card lights up (one click).
    await bar.getByLabel('What do you want to do?').fill('Change the title of OrdersPage to My orders');
    await bar.getByRole('link', { name: /^Go to Pages:/ }).click();
    await expect(page).toHaveURL(/\/pages/);
    await expect(page.getByRole('button', { name: /^orders/ })).toHaveAttribute('data-line-lit', 'request', { timeout: 30_000 });
    await page.getByRole('button', { name: /^orders/ }).click();
    await expect(page.getByRole('button', { name: 'OrdersPage' })).toHaveAttribute('data-line-lit', 'request');
    watch.check();
  });
});
