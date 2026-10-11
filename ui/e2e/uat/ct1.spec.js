import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { openProject } from '../tests/support/browseProject.js';
import { waitForCockpitReady } from '../tests/support/cockpit.js';
import { API, copySample, watchForProblems } from './support/uat.js';

// ct1 UAT (docs/line/review.md "ct1", "UAT"), walked as the owner would: Trace and Auto on, ask, watch Auto do it with
// a caption per move, Approve yourself; then Auto alone with Auto approval allowed. Fails on console errors or 4xx/5xx.
test.describe.serial('UAT ct1: Auto acts it out, you approve', () => {
  test.describe.configure({ timeout: 120_000 });
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

  test('1-2: Trace + Auto, "Show me and do it", watch the captions, Approve yourself', async ({ page }) => {
    const watch = watchForProblems(page);
    await page.goto('/components');
    await waitForCockpitReady(page); // the owner waits for Cockpit to finish loading before typing
    const bar = page.getByRole('region', { name: 'Trace and Auto' });
    await expect(bar).toBeVisible({ timeout: 60_000 });
    await bar.getByRole('button', { name: 'Trace' }).click();
    await bar.getByRole('button', { name: 'Auto' }).click();
    await bar.getByLabel('What do you want to do?').fill('Base a new StatusBadge on Badge in orders');
    await expect(bar.getByRole('status').first()).toHaveText(/^Base a new StatusBadge/);
    // Click 1: Show me and do it.
    await bar.getByRole('button', { name: 'Show me and do it' }).click();
    const caption = bar.getByTestId('auto-caption');
    await expect(caption).toHaveText('Choose the feature orders.', { timeout: 20_000 });
    await expect(caption).toHaveText(/^Waiting for you: click Approve/, { timeout: 30_000 });
    expect(fs.existsSync(path.join(base, 'features/orders/components/StatusBadge.tsx'))).toBe(false);
    // Click 2: Approve.
    await page.getByRole('button', { name: /^Approve step/ }).first().click();
    await expect(caption).toHaveText('You approved it; the plan runner runs the change.');
    await expect(page.getByTestId('plan-step').first()).toHaveAttribute('data-state', 'done');
    expect(fs.existsSync(path.join(base, 'features/orders/components/StatusBadge.tsx'))).toBe(true);
    watch.check();
  });

  test('3: Auto alone with "Let Auto approve in this session": one click does it', async ({ page }) => {
    const watch = watchForProblems(page);
    await page.goto('/components');
    await waitForCockpitReady(page); // the owner waits for Cockpit to finish loading before typing
    const bar = page.getByRole('region', { name: 'Trace and Auto' });
    await expect(bar).toBeVisible({ timeout: 60_000 });
    await bar.getByRole('button', { name: 'Auto' }).click();
    await bar.getByLabel('Let Auto approve in this session').check();
    await bar.getByLabel('What do you want to do?').fill('Base a new PaidBadge on Badge in orders');
    await expect(bar.getByRole('status').first()).toHaveText(/^Base a new PaidBadge/);
    await bar.getByRole('button', { name: 'Do it' }).click();
    await expect(bar.getByTestId('auto-caption')).toHaveText('Auto finished; the plan shows what ran.', { timeout: 30_000 });
    // The approved step runs through the plan runner after Auto's last move; the file lands a moment later.
    await expect.poll(() => fs.existsSync(path.join(base, 'features/orders/components/PaidBadge.tsx')), { timeout: 30_000 }).toBe(true);
    watch.check();
  });
});
