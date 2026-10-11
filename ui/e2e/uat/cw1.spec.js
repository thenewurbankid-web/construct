import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gotoCockpit } from '../tests/support/cockpit.js';
import { openProject } from '../tests/support/browseProject.js';

// UAT walk for cw1 (docs/line/review.md, "cw1", To try it in Cockpit), as a non-technical owner: only clicks and
// typing in the browser, counting the clicks each decision takes (at most two), and failing on any console error or
// any 4xx/5xx answer. The project is a copy of examples/line-sample opened the way the review's step 1 says.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = path.resolve(__dirname, '../../../examples/line-sample');
const API = process.env.E2E_API_BASE || 'http://localhost:4000';

test('cw1 UAT: start a workflow from the library, choose its page, add a When -> Do, each approved in the Plan panel', async ({ page }) => {
  test.setTimeout(120_000);
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'line-sample-')));
  fs.cpSync(SAMPLE, base, { recursive: true });
  const restore = await openProject(API, base);
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  page.on('response', (r) => { if (r.status() >= 400) problems.push(`${r.status()} ${r.request().method()} ${r.url()}`); });
  let clicks = 0;
  const click = async (locator) => { clicks += 1; await locator.click({ timeout: 30_000 }); };
  const plan = page.getByTestId('line-plan');
  const approve = async () => {
    await click(plan.locator('[data-testid="plan-step"][data-state="waiting"]').first().getByRole('button', { name: /^Approve step/ }));
    await expect(plan.locator('[data-testid="plan-step"][data-state="waiting"]')).toHaveCount(0, { timeout: 30_000 });
  };
  try {
    // 1. Open Cockpit (Features) and pick the orders feature, then its Workflows tab.
    await gotoCockpit(page, '/');
    await click(page.getByRole('list', { name: 'Features' }).getByTestId('lf-feature').filter({ hasText: 'orders' }));
    await click(page.getByRole('tab', { name: 'Workflows' }));
    await expect(page.getByText('orders has no workflows yet. Start one from a library workflow below.')).toBeVisible({ timeout: 30_000 });

    // 2. Start "list then detail" from the library: one click, then Approve (two clicks for the decision).
    clicks = 0;
    await click(page.getByRole('button', { name: 'Use listDetail in orders' }));
    await expect(page.getByRole('status')).toContainText('Waiting for your approval: Creates the workflow ordersListDetail in feature orders');
    await approve();
    expect(clicks).toBeLessThanOrEqual(2);
    await expect(page.getByText('0 of 2 pages are chosen; still to choose: list and detail.', { exact: false })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('img', { name: 'State diagram of ordersListDetail' })).toBeVisible();

    // 3. Choose OrdersPage for the list page: pick it, then Approve.
    clicks = 0;
    await page.getByLabel(/^list\s+The page that lists the items$/).selectOption('OrdersPage');
    clicks += 1;
    await expect(page.getByRole('status')).toContainText('Chooses OrdersPage for the list page');
    await approve();
    expect(clicks).toBeLessThanOrEqual(2);
    await expect(page.getByText('When OrdersPage sends OPEN.', { exact: false }).first()).toBeAttached();

    // 4. Add: when the detail page sends CANCEL, call cancelOrder, then go to the list.
    const form = page.getByRole('form', { name: 'Add a When and Do' });
    await form.getByLabel('When this state').selectOption('detail');
    await form.getByLabel('Event').fill('CANCEL');
    await form.getByLabel('Go to').selectOption('list');
    await form.getByLabel('Service to call').fill('cancelOrder');
    await click(form.getByRole('button', { name: 'Add to plan' }));
    await expect(page.getByRole('status')).toContainText('call the cancelOrder service, then go to OrdersPage');
    await approve();
    const own = page.locator('[data-testid="lw-card"][data-transition="detail|CANCEL"]');
    await expect(own).toContainText('Call the cancelOrder service, then go to OrdersPage.');
    await expect(own).toContainText('Added for orders');

    // Everything the owner read was plain English; no technical text outside a collapsed Details.
    const visible = await page.getByTestId('line-workflows').innerText();
    expect(visible).not.toMatch(/line\.\w+\(|LINE-[A-Z]+|\.tsx?:\d+|undefined|\[object/);
    expect(problems).toEqual([]);
  } finally {
    await restore?.();
    fs.rmSync(base, { recursive: true, force: true });
  }
});
