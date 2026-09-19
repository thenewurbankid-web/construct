import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { noDevBadge, shot, makeProject, cleanup, CHECKOUT_SRC } from './cockpit-fixture.mjs';

// Cockpit guide, story 5: read a workflow in plain English, then edit it.
test.describe.serial('Cockpit demo: workflows in plain English', () => {
  let proj;
  test.beforeEach(async ({ page }) => { await noDevBadge(page); });

  test.beforeAll(async ({ request }) => { proj = await makeProject(request); });
  test.afterAll(async ({ request }) => { await cleanup(request, proj); });

  async function open(page, file) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/workflows');
    await page.getByRole('combobox').first().selectOption('shop');
    await page.getByRole('button', { name: file }).click();
  }

  test('5a. read a refund workflow: diagram plus plain-English narrative and scenarios', async ({ page }) => {
    await open(page, 'RefundRequestWorkflow.ts');
    await expect(page.getByTestId('wf-state-submitted')).toBeVisible();
    await expect(page.getByTestId('wf-narrative-summary')).toContainText('The "refund request" flow has 8 steps.');
    await expect(page.getByTestId('wf-narrative-english')).toContainText('After 48 hours, the flow moves to escalated.');
    await expect(page.getByTestId('wf-scenario-1')).toContainText('Happy path');
    await page.screenshot({ path: shot('cockpit-5-workflow-narrative.png') });
  });

  test('5b. edit visually; the English and the health check follow the change', async ({ page }) => {
    await open(page, 'CheckoutWorkflow.tsx');
    await expect(page.getByTestId('wf-narrative-summary')).toContainText('can end in done.');
    await page.getByRole('tab', { name: 'Edit' }).click();
    await page.getByLabel('New state name').fill('refunded');
    await page.getByRole('button', { name: 'Add state' }).click();
    await page.getByRole('button', { name: 'Confirm save' }).click();
    await expect(page.getByTestId('wf-state-refunded')).toBeVisible();
    // the change is on disk, in the real file
    expect(fs.readFileSync(path.join(proj.dir, 'features/shop/workflows/CheckoutWorkflow.tsx'), 'utf8')).not.toBe(CHECKOUT_SRC);
    await page.getByRole('tab', { name: 'Narrative' }).click();
    await expect(page.getByTestId('wf-narrative-state-refunded')).toContainText('There is no way out of refunded');
    await expect(page.getByTestId('wf-finding-unreachable')).toContainText('refunded can never be reached');
    await page.screenshot({ path: shot('cockpit-6-workflow-edit-health.png') });
  });
});
