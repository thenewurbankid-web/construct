import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gotoCockpit } from './support/cockpit.js';
import { openProject } from './support/browseProject.js';
import { runAxe, isBlocking, format } from './support/axe.js';

// cw1 -- Line workflows: state machines between a feature's pages, used like primitives. On the real server over a copy
// of examples/line-sample (library: wizard, listDetail, createConfirm, signInGate as xstate machines; checkout is plain
// functions). Inside a feature (Features screen, Workflows tab) the person starts a workflow from a library one,
// chooses which page fills each role, adds a When -> Do, removes it, and moves the workflow to the library. Every
// change is a plan step that waits in the Plan panel; nothing is written before Approve.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const SAMPLE = path.join(REPO, 'examples/line-sample');
const API = process.env.E2E_API_BASE || 'http://localhost:4000';
const FILE = 'features/orders/workflows/ordersListDetail.ts';
const URL = '/?feature=orders&view=workflows';

const tab = (page) => page.getByTestId('line-workflows');
const plan = (page) => page.getByTestId('line-plan');
const card = (page, id) => page.locator(`[data-testid="lw-card"][data-transition="${id}"]`);

/** Approve the newest waiting step and wait until it ran. */
async function approve(page) {
  const step = plan(page).locator('[data-testid="plan-step"][data-state="waiting"]').first();
  await expect(step).toBeVisible({ timeout: 30_000 });
  await step.getByRole('button', { name: /^Approve step \d+$/ }).click();
  await expect(plan(page).locator('[data-testid="plan-step"][data-state="waiting"]')).toHaveCount(0, { timeout: 30_000 });
}

test.describe.serial('Line workflows (Features > Workflows, Line sample project, real server)', () => {
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

  test('the Workflows tab of a feature lists the library\'s four workflows to start from, and none of its own yet', async ({ page }) => {
    await gotoCockpit(page, '/?feature=orders');
    await page.getByRole('tab', { name: 'Workflows' }).click({ timeout: 30_000 });
    await expect(page).toHaveURL(/view=workflows/);
    await expect(tab(page)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('lw-empty')).toHaveText('orders has no workflows yet. Start one from a library workflow below.');
    await expect(page.getByTestId('lw-library')).toHaveCount(4);
    const ld = page.locator('[data-testid="lw-library"][data-workflow="listDetail"]');
    await expect(ld).toContainText('listDetail has 2 pages for a feature to fill (list and detail) and 2 transitions. No feature uses it yet.');
    await ld.getByText('What it does').click();
    await expect(ld).toContainText('When the list page sends OPEN. Go to the detail page.');
    await expect(page.getByTestId('lw-not-machines')).toContainText('Workflows Cockpit cannot draw yet (2)');
    await expect(plan(page)).toBeVisible();
    const found = await runAxe(page, { include: '[data-testid="lf-detail"]' });
    expect(found.filter(isBlocking), format(found.filter(isBlocking))).toEqual([]);
  });

  test('Use listDetail adds one waiting step; Approve writes the feature workflow based on it, drawn as a state diagram', async ({ page }) => {
    await gotoCockpit(page, URL);
    await page.getByRole('button', { name: 'Use listDetail in orders' }).click({ timeout: 30_000 });
    await expect(page.getByTestId('lw-notice')).toHaveText('Waiting for your approval: Creates the workflow ordersListDetail in feature orders, based on the library workflow listDetail. Approve it in the Plan panel.');
    expect(fs.existsSync(path.join(base, FILE))).toBe(false);
    await approve(page);
    await expect(page.locator('[data-testid="lw-workflow"][data-workflow="ordersListDetail"]')).toContainText('0 of 2 pages chosen.');
    await expect(page.getByTestId('lw-summary')).toHaveText('ordersListDetail is based on the library workflow listDetail. 0 of 2 pages are chosen; still to choose: list and detail. orders adds no transitions of its own yet.');
    expect(fs.readFileSync(path.join(base, FILE), 'utf8').split('\n')[0]).toBe('// @line-base workflows/listDetail');
    await expect(page.getByTestId('lw-node')).toHaveCount(2);
    await expect(page.getByTestId('lw-edge')).toHaveCount(2);
    await expect(page.getByRole('img', { name: 'State diagram of ordersListDetail' })).toBeVisible();
    await expect(card(page, 'list|OPEN').getByTestId('lw-card-when')).toHaveText('the list page sends OPEN.');
    await expect(card(page, 'list|OPEN').getByTestId('lw-card-origin')).toHaveText('From the library');
    await expect(card(page, 'list|OPEN').getByRole('button', { name: /Remove/ })).toHaveCount(0);
  });

  test('choosing OrdersPage for the list role is one step; after Approve the diagram and cards name the page', async ({ page }) => {
    await gotoCockpit(page, URL);
    await page.getByLabel(/^list\s+The page that lists the items$/).selectOption('OrdersPage', { timeout: 30_000 });
    await expect(page.getByTestId('lw-notice')).toHaveText('Waiting for your approval: Chooses OrdersPage for the list page of the workflow ordersListDetail. Approve it in the Plan panel.');
    await approve(page);
    await expect(page.getByLabel(/^list\s+The page that lists the items$/)).toHaveValue('OrdersPage');
    await expect(page.locator('[data-testid="lw-node"][data-state="list"]')).toContainText('OrdersPage');
    await expect(card(page, 'list|OPEN').getByTestId('lw-card-when')).toHaveText('OrdersPage sends OPEN.');
    expect(fs.readFileSync(path.join(base, FILE), 'utf8')).toContain("list: 'OrdersPage',");
  });

  test('a When -> Do the feature adds: call a service, then go to a page; it is marked as the feature\'s own and passes validate', async ({ page }) => {
    await gotoCockpit(page, URL);
    const form = page.getByRole('form', { name: 'Add a When and Do' });
    await form.getByLabel('When this state').selectOption('detail', { timeout: 30_000 });
    await form.getByLabel('Event').fill('cancel');
    await form.getByLabel('Go to').selectOption('list');
    await form.getByLabel('Service to call').fill('cancelOrder');
    await form.getByRole('button', { name: 'Add to plan' }).click();
    await expect(page.getByTestId('lw-notice')).toHaveText('Waiting for your approval: Adds to ordersListDetail: when the detail page sends CANCEL, call the cancelOrder service, then go to OrdersPage. Approve it in the Plan panel.');
    await approve(page);
    const own = card(page, 'detail|CANCEL');
    await expect(own.getByTestId('lw-card-do')).toHaveText('Call the cancelOrder service, then go to OrdersPage.');
    await expect(own.getByTestId('lw-card-origin')).toHaveText('Added for orders');
    await expect(page.locator('[data-testid="lw-edge"][data-edge="detail|CANCEL"]')).toHaveClass(/lw-edge--own/);
    await expect(page.getByTestId('lw-summary')).toContainText('orders adds one transition of its own.');
    const out = spawnSync(process.execPath, [path.join(REPO, 'packages/cli/construct.mjs'), 'validate', '--dir', base, '--profile', 'line', '--format', 'json'], { encoding: 'utf8' }).stdout;
    const problems = JSON.parse(out).violations.filter((v) => v.severity === 'error').map((v) => v.rule).sort();
    expect(problems).toEqual(['LINE-BASE', 'LINE-DIR']);
  });

  test('a When -> Do the workflow already has is refused in one sentence, with the reason under Details, and joins no plan', async ({ page }) => {
    await gotoCockpit(page, URL);
    // The three steps approved so far (start, choose a page, add a When -> Do), once the plan has loaded.
    const before = 3;
    await expect(plan(page).getByTestId('plan-step')).toHaveCount(before, { timeout: 30_000 });
    const form = page.getByRole('form', { name: 'Add a When and Do' });
    await form.getByLabel('Event').fill('OPEN', { timeout: 30_000 });
    await form.getByRole('button', { name: 'Add to plan' }).click();
    const notice = page.getByTestId('lw-notice');
    await expect(notice.locator('p')).toHaveText('"list" already handles "OPEN"; retarget or remove that transition instead.');
    await notice.getByText('Details').click();
    await expect(notice.locator('code')).toContainText('BAD_TRANSITION');
    await expect(plan(page).getByTestId('plan-step')).toHaveCount(before);
  });

  test('the feature\'s own When -> Do can be removed (one step); the library\'s cannot', async ({ page }) => {
    await gotoCockpit(page, URL);
    await card(page, 'detail|CANCEL').getByRole('button', { name: 'Remove: When the detail page sends CANCEL.' }).click({ timeout: 30_000 });
    await expect(page.getByTestId('lw-notice')).toHaveText('Waiting for your approval: Removes from ordersListDetail: when the detail page sends CANCEL. Approve it in the Plan panel.');
    await approve(page);
    await expect(card(page, 'detail|CANCEL')).toHaveCount(0);
    expect(fs.readFileSync(path.join(base, FILE), 'utf8')).not.toContain('CANCEL');
  });

  test('Move to the library promotes the workflow: it leaves the feature and is offered from the library, with its roles', async ({ page }) => {
    await gotoCockpit(page, URL);
    await page.getByRole('button', { name: 'Move to the library' }).click({ timeout: 30_000 });
    await expect(page.getByTestId('lw-notice')).toContainText('Waiting for your approval: Moves ordersListDetail from feature orders into the library');
    await approve(page);
    await expect(page.getByTestId('lw-empty')).toBeVisible();
    const promoted = page.locator('[data-testid="lw-library"][data-workflow="ordersListDetail"]');
    await expect(promoted).toContainText('ordersListDetail has 2 pages for a feature to fill (list and detail) and 2 transitions.');
    expect(fs.existsSync(path.join(base, 'library/workflows/ordersListDetail.ts'))).toBe(true);
    expect(fs.existsSync(path.join(base, FILE))).toBe(false);
  });
});
