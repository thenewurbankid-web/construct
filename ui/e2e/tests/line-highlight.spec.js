import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gotoCockpit } from './support/cockpit.js';
import { openProject } from './support/browseProject.js';
import { runAxe, isBlocking, format } from './support/axe.js';

// cg1: with Trace on, the controls that match the request and the plan's open steps light up wherever they are in
// Cockpit (buttons, form fields, page and feature cards, the Plan panel's Approve), each found through the one control
// registry (data-line-control). A control on another screen shows a link that goes there.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = path.resolve(__dirname, '../../../examples/line-sample');
const API = process.env.E2E_API_BASE || 'http://localhost:4000';

const lit = (page) => page.locator('[data-line-lit]');
const control = (page, id, target) => page.locator(`[data-line-control="${id}"]${target ? `[data-line-target="${target}"]` : ''}`);

async function traceOn(page, request) {
  const bar = page.getByTestId('line-trace');
  await expect(bar).toBeVisible({ timeout: 30_000 });
  await bar.getByTestId('trace-toggle').click();
  await expect(bar.getByTestId('trace-toggle')).toHaveAttribute('aria-pressed', 'true');
  if (request) await bar.getByLabel('What do you want to do?').fill(request);
  return bar;
}

test.describe.serial('Line: Trace lights up the controls for a request (Line sample project)', () => {
  test.describe.configure({ timeout: 60_000 });
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

  test('Components: "Base a new StatusBadge on Badge in orders" lights Badge\'s Base on this, then the form\'s fields and Create', async ({ page }) => {
    await gotoCockpit(page, '/components');
    const bar = await traceOn(page, 'Base a new StatusBadge on Badge in orders');
    await expect(bar.getByTestId('trace-sentence')).toHaveText('Base a new StatusBadge on Badge in orders. The lit controls do it.');
    await expect(control(page, 'components.baseOn', 'Badge')).toHaveAttribute('data-line-lit', 'request');
    await expect(control(page, 'components.baseOn', 'Button')).not.toHaveAttribute('data-line-lit', /.*/);
    await expect(bar.getByTestId('trace-lit-here')).toContainText('Base on this (Badge)');
    // The form opens: its Feature, Name and Create light up as they appear.
    await control(page, 'components.baseOn', 'Badge').click();
    await expect(control(page, 'components.baseOnFeature', 'Badge')).toHaveAttribute('data-line-lit', 'request');
    await expect(control(page, 'components.baseOnName', 'Badge')).toHaveAttribute('data-line-lit', 'request');
    await expect(control(page, 'components.baseOnCreate', 'Badge')).toHaveAttribute('data-line-lit', 'request');
    // The tools and who decided sit under Details.
    await bar.getByText('Details', { exact: true }).click();
    await expect(bar.locator('.ltr-tech')).toContainText('Decided by: static');
    const found = await runAxe(page, { include: '[data-testid="line-trace"]' });
    expect(found.filter(isBlocking), format(found.filter(isBlocking))).toEqual([]);
  });

  test('a waiting plan step lights its Approve; Trace off clears every light', async ({ page }) => {
    await gotoCockpit(page, '/components');
    const bar = await traceOn(page);
    await control(page, 'components.baseOn', 'Badge').click({ timeout: 30_000 });
    const form = page.getByRole('form', { name: 'Base a new component on Badge' });
    await form.getByLabel('Feature').selectOption('orders');
    await form.getByLabel('Name').fill('TraceBadge');
    await form.getByRole('button', { name: 'Create' }).click();
    const step = page.getByTestId('plan-step').first();
    await expect(step).toHaveAttribute('data-state', 'waiting');
    await expect(step.getByRole('button', { name: /^Approve step/ })).toHaveAttribute('data-line-lit', 'step');
    await expect(bar.getByTestId('trace-sentence')).toHaveText(/^Step \d+ waits for your approval\. The lit controls do it\.$/);
    await bar.getByTestId('trace-toggle').click();
    await expect(lit(page)).toHaveCount(0);
    expect(fs.existsSync(path.join(base, 'features/orders/components/TraceBadge.tsx'))).toBe(false);
  });

  test('a page change asked on Components links to Pages, where the feature, the page, the prop and Save light up', async ({ page }) => {
    await gotoCockpit(page, '/components');
    const bar = await traceOn(page, 'Change the title of OrdersPage to My orders');
    const link = bar.getByTestId('trace-elsewhere');
    await expect(link).toHaveText('Go to Pages: Which feature, Page, Prop value, Save light up there.');
    await link.click();
    await expect(page).toHaveURL(/\/pages/);
    await expect(control(page, 'pages.feature', 'orders')).toHaveAttribute('data-line-lit', 'request', { timeout: 30_000 });
    await expect(control(page, 'pages.feature', 'billing')).not.toHaveAttribute('data-line-lit', /.*/);
    await control(page, 'pages.feature', 'orders').click();
    await expect(control(page, 'pages.page', 'OrdersPage')).toHaveAttribute('data-line-lit', 'request');
    await control(page, 'pages.page', 'OrdersPage').click();
    await expect(control(page, 'pages.propInput', 'title')).toHaveAttribute('data-line-lit', 'request');
    await expect(control(page, 'pages.propSave', 'title')).toHaveAttribute('data-line-lit', 'request');
  });

  test('Features: "Show me the features" lights the feature cards; "Fix the problem in billing" lights what needs attention', async ({ page }) => {
    await gotoCockpit(page, '/');
    const bar = await traceOn(page, 'Show me the features');
    await expect(control(page, 'features.card')).toHaveCount(2);
    await expect(control(page, 'features.card', 'orders')).toHaveAttribute('data-line-lit', 'request');
    await bar.getByLabel('What do you want to do?').fill('Fix the problem in billing');
    await control(page, 'features.card', 'billing').click();
    await expect(control(page, 'features.finding').first()).toHaveAttribute('data-line-lit', 'request');
    await expect(bar.getByTestId('trace-elsewhere')).toHaveText('Go to the Plan panel on Components: Apply recommended fix, Approve light up there.');
  });

  test('when several tools fit, one is picked and the sentence says how; an unknown request says what words work', async ({ page }) => {
    await gotoCockpit(page, '/components');
    const bar = await traceOn(page, 'Move OrderButton into the library');
    await expect(bar.getByTestId('trace-choice')).toHaveText(/^Several tools fit; (jev picked|Line took) "/);
    await bar.getByLabel('What do you want to do?').fill('Make me a sandwich');
    await expect(bar.getByTestId('trace-sentence')).toHaveText('Trace found no control for that; try words like base on, promote, change the title, edit code or fix.');
    await expect(lit(page)).toHaveCount(0);
  });
});
