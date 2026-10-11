import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gotoCockpit } from './support/cockpit.js';
import { openProject } from './support/browseProject.js';
import { runAxe, isBlocking, format } from './support/axe.js';

// Line hours 5+6 -- the Pages screen of a Line project, on the real /api/line routes over a copy of examples/line-sample.
// The sample has two features: orders (OrdersPage, based on ListPage, fine) and billing (InvoicesPage, based on ListPage,
// with a planted cross-feature import of orders' OrderButton, LINE-DIR). The checked writer blocks only NEW problems, so a
// plain title edit on InvoicesPage lands, while a change that would add a cross-feature import is refused.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = path.resolve(__dirname, '../../../examples/line-sample');
const API = process.env.E2E_API_BASE || 'http://localhost:4000';
const ORDERS = 'features/orders/pages/OrdersPage.tsx';
const INVOICES = 'features/billing/pages/InvoicesPage.tsx';

const features = (page) => page.getByRole('list', { name: 'Features' }).getByRole('button');
const pageRow = (page, name) => page.locator(`[data-testid="lp-page"][data-page="${name}"]`);
const titleProp = (page) => page.locator('[data-testid="lp-part"][data-part="ListPage"] [data-testid="lp-prop"][data-prop="title"]');

test.describe.serial('Line Pages screen (Line sample project, real server)', () => {
  let base;
  let restore;
  const read = (rel) => fs.readFileSync(path.join(base, rel), 'utf8');

  test.beforeAll(async () => {
    // The server only opens projects inside its workspace (the OS temp dir under this config), so open a copy.
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'line-sample-')));
    fs.cpSync(SAMPLE, base, { recursive: true });
    restore = await openProject(API, base);
  });
  test.afterAll(async () => {
    await restore?.();
    if (base) fs.rmSync(base, { recursive: true, force: true });
  });

  test('/pages asks which feature first, then lists that feature\'s pages with their library base and status', async ({ page }) => {
    await gotoCockpit(page, '/pages');
    await expect(page.getByTestId('line-pages')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('navigation', { name: 'Screens', exact: true }).getByRole('link', { name: 'Pages' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { name: 'Which feature?' })).toBeVisible();
    await expect(features(page)).toHaveText([/^billing\s*One page, one needs attention\.$/, /^orders\s*One page, all fine\.$/]);
    await expect(page.getByTestId('lp-page')).toHaveCount(0);

    await features(page).filter({ hasText: 'orders' }).click();
    await expect(page).toHaveURL(/[?&]feature=orders/);
    await expect(page.getByText('Feature: orders')).toBeVisible();
    await expect(page.getByTestId('lp-page')).toHaveCount(1);
    await expect(pageRow(page, 'OrdersPage').getByTestId('lp-page-base')).toHaveText('Based on ListPage');
    await expect(pageRow(page, 'OrdersPage').getByTestId('lp-page-status')).toHaveText('Fine');
  });

  test('the planted problem shows as a sentence first, with the rule and file:line in a collapsed Details', async ({ page }) => {
    await gotoCockpit(page, '/pages?feature=billing');
    const row = pageRow(page, 'InvoicesPage');
    await expect(row.getByTestId('lp-page-base')).toHaveText('Based on ListPage', { timeout: 30_000 });
    await expect(row.getByTestId('lp-page-status')).toHaveText('Needs attention');
    const finding = row.getByTestId('lp-finding');
    await expect(finding).toHaveCount(1);
    await expect(finding).toContainText('Feature "billing" imports "../../orders/components/OrderButton" from feature "orders"; a feature may use only the library');
    await expect(finding.getByTestId('lp-finding-rule')).toBeHidden();
    await finding.getByText('Details').click();
    await expect(finding.getByTestId('lp-finding-rule')).toHaveText('LINE-DIR');
    await expect(finding.getByTestId('lp-finding-where')).toHaveText(`${INVOICES}:4`);

    const found = await runAxe(page, { include: '[data-testid="line-pages"]' });
    expect(found.filter(isBlocking), format(found.filter(isBlocking))).toEqual([]);
  });

  test('changing OrdersPage\'s title and saving shows "Saved. ..." and changes only that attribute on disk', async ({ page }) => {
    const before = read(ORDERS);
    await gotoCockpit(page, '/pages?feature=orders');
    await pageRow(page, 'OrdersPage').getByRole('button', { name: 'OrdersPage' }).click({ timeout: 30_000 });
    await expect(page).toHaveURL(/[?&]page=orders%2Fpages%2FOrdersPage/);
    await expect(page.getByRole('heading', { name: 'Parts of OrdersPage' })).toBeVisible();
    const prop = titleProp(page);
    await expect(prop.getByTestId('lp-prop-now')).toHaveText('Now: Orders');
    const save = prop.getByRole('button', { name: 'Save' });
    await expect(save).toBeDisabled();
    await prop.getByLabel('title').fill('All orders');
    await save.click();
    // cp1: Save adds a plan step; nothing is written until the person approves it in the Plan panel.
    await expect(page.getByTestId('lp-outcome')).toHaveText('Waiting for your approval: Sets title to "All orders" on ListPage in the page OrdersPage.');
    expect(read(ORDERS)).toBe(before);
    await page.getByTestId('line-plan').getByRole('button', { name: /^Approve step/ }).first().click();
    await expect(page.getByTestId('lp-outcome')).toHaveText('Saved. Sets title to "All orders" on ListPage in the page OrdersPage.');
    await expect(titleProp(page).getByTestId('lp-prop-now')).toHaveText('Now: All orders');
    await expect(titleProp(page).getByLabel('title')).toHaveValue('All orders');
    await expect(pageRow(page, 'OrdersPage').getByTestId('lp-page-status')).toHaveText('Fine');
    expect(read(ORDERS)).toBe(before.replace('title="Orders"', 'title="All orders"'));
  });

  test('a plain title edit on InvoicesPage lands although it has an old problem: only new problems block a save', async ({ page }) => {
    await gotoCockpit(page, '/pages?feature=billing&page=billing%2Fpages%2FInvoicesPage');
    const prop = titleProp(page);
    await expect(prop.getByTestId('lp-prop-now')).toHaveText('Now: Invoices', { timeout: 30_000 });
    await prop.getByLabel('title').fill('Bills');
    await prop.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByTestId('lp-outcome')).toHaveText(/^Waiting for your approval: Sets title to "Bills"/);
    await page.getByTestId('line-plan').getByRole('button', { name: /^Approve step/ }).first().click();
    await expect(page.getByTestId('lp-outcome')).toHaveText('Saved. Sets title to "Bills" on ListPage in the page InvoicesPage.');
    await expect(titleProp(page).getByTestId('lp-prop-now')).toHaveText('Now: Bills');
    expect(read(INVOICES)).toContain('<ListPage title="Bills" />');
    // The old problem is still there, still said in plain English.
    await expect(pageRow(page, 'InvoicesPage').getByTestId('lp-page-status')).toHaveText('Needs attention');
  });

  test('a save that would add a cross-feature import is refused with the reason, and nothing is written', async ({ request }) => {
    // The Pages screen offers only text, number and on/off values, so it cannot add an import; the same route it saves
    // through takes an expression, and a dynamic import() of another feature is exactly a new LINE-DIR problem.
    const before = read(ORDERS);
    const tree = await (await request.get(`${API}/api/line/page-tree?file=${encodeURIComponent(ORDERS)}`)).json();
    const listPage = tree.roots.flatMap(function all(n) { return [n, ...n.children.flatMap(all)]; }).find((n) => n.tag === 'ListPage');
    const res = await request.post(`${API}/api/line/page-prop`, {
      data: { file: ORDERS, nodeId: listPage.id, prop: 'title', kind: 'expression', value: "String(import('../../billing/pages/InvoicesPage'))" },
    });
    // cu3: the route only adds a plan step (a project write never lands without approval); approving and running it
    // is where Construct's writer refuses it.
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.sentence).toMatch(/^Waiting for your approval: /);
    expect(body.files).toEqual([]);
    expect(read(ORDERS)).toBe(before);
    const stepId = body.planned.stepId;
    await request.post(`${API}/api/line/plan/approve`, { data: { stepId } });
    const ran = await (await request.post(`${API}/api/line/plan/run`, { data: { stepId } })).json();
    const step = ran.steps.find((s) => s.id === stepId);
    expect(step.state).toBe('needs-fix');
    expect(step.result.apply.sentence).toMatch(/^Nothing was saved: feature "orders" imports "\.\.\/\.\.\/billing\/pages\/InvoicesPage" from feature "billing"/);
    expect(step.result.apply.findings.map((f) => `${f.rule} ${f.file}`)).toContain(`LINE-DIR ${ORDERS}`);
    expect(read(ORDERS)).toBe(before);
    // Leave it as it is, so the plan is not left blocked.
    const left = await (await request.post(`${API}/api/line/plan/step`, { data: { tool: 'line.leaveAsIs', args: { stepId } } })).json();
    await request.post(`${API}/api/line/plan/approve`, { data: { stepId: left.stepId } });
    await request.post(`${API}/api/line/plan/run`, { data: { stepId: left.stepId } });
  });
});

// The contract's mock stays usable for building the screen with no server (?line=mock); one check that it still runs.
test('Line Pages screen on the contract mock (?line=mock) still lists features and pages', async ({ page }) => {
  await gotoCockpit(page, '/pages?line=mock&feature=orders');
  await expect(pageRow(page, 'OrdersPage').getByTestId('lp-page-base')).toHaveText('Based on ListPage', { timeout: 30_000 });
  await expect(features(page)).toHaveText([/^billing/, /^orders/]);
});
