import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gotoCockpit } from './support/cockpit.js';
import { openProject } from './support/browseProject.js';
import { runAxe, isBlocking, format } from './support/axe.js';
import { failOnConsoleErrors } from './support/consoleGuard.js';

// Line cf1 -- the Features screen of a Line project (`/`), on the real /api/line routes over a copy of
// examples/line-sample. orders: OrdersPage, OrderButton, OrderCard, orderCheckout, all based on library items, and a
// spec with one story and two acceptance points (one names OrdersPage, so it is covered; one is not). billing: the
// two planted problems (InvoicesPage imports orders' OrderButton, LINE-DIR; InvoiceCard has no base, LINE-BASE).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = path.resolve(__dirname, '../../../examples/line-sample');
const API = process.env.E2E_API_BASE || 'http://localhost:4000';

const cards = (page) => page.getByRole('list', { name: 'Features', exact: true }).getByTestId('ln-pick');
const item = (page, name) => page.locator(`[data-testid="lf-item"][data-item="${name}"]`);
const point = (page, id) => page.locator(`[data-testid="lf-point"][data-point="${id}"]`);

test.describe.serial('Line Features screen (Line sample project, real server)', () => {
  failOnConsoleErrors(test);
  let base;
  let restore;

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

  test('Features lists every feature with "All fine" or "Needs attention", in place of the old feature list', async ({ page }) => {
    await gotoCockpit(page, '/');
    await expect(page.getByTestId('line-features')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('navigation', { name: 'Screens', exact: true }).getByRole('link', { name: 'Features' })).toHaveAttribute('aria-current', 'page');
    await expect(cards(page)).toHaveText([/^billing\s*Needs attention\s*2 items, 2 need attention\.$/, /^orders\s*All fine\s*4 items, all fine\.$/]);
    await expect(page.getByTestId('features-list')).toHaveCount(0);
    await expect(page.getByTestId('lf-detail')).toHaveCount(0);
  });

  test('picking orders shows its items by kind with their bases, the Auto summary and the spec coverage', async ({ page }) => {
    await gotoCockpit(page, '/');
    await cards(page).filter({ hasText: 'orders' }).click({ timeout: 30_000 });
    await expect(page).toHaveURL(/[?&]feature=orders/);
    await expect(page.getByText('Feature: orders')).toBeVisible();
    await expect(page.getByTestId('lf-group')).toHaveText([/^Pages/, /^Components/, /^Workflows/]);
    await expect(item(page, 'OrdersPage').getByTestId('lf-item-base')).toHaveText('Based on ListPage');
    await expect(item(page, 'OrderButton').getByTestId('lf-item-base')).toHaveText('Based on Button');
    await expect(item(page, 'OrderCard').getByTestId('lf-item-base')).toHaveText('Based on Card');
    await expect(item(page, 'orderCheckout').getByTestId('lf-item-base')).toHaveText('Based on checkout');
    await expect(page.getByTestId('lf-item-status')).toHaveText(['Fine', 'Fine', 'Fine', 'Fine']);
    await expect(page.getByTestId('lf-summary').locator('.lf-summary-text')).toHaveText(
      'orders has 1 page, 2 components and 1 workflow. OrdersPage is based on ListPage. OrderButton is based on Button. OrderCard is based on Card. orderCheckout is based on checkout. Everything in orders passes the checks.',
    );
    await expect(page.getByTestId('lf-coverage')).toHaveText('1 of 2 acceptance points are covered.');
    await expect(page.getByTestId('lf-story')).toContainText('As a shopper, I want to see my orders and place a new one');
    await expect(point(page, 's1.p1').getByTestId('lf-point-status')).toHaveText('Covered');
    await expect(point(page, 's1.p2').getByTestId('lf-point-status')).toHaveText('Not covered yet');
    await point(page, 's1.p1').getByText('Details').click();
    await expect(point(page, 's1.p1').getByTestId('lf-point-by')).toHaveText('OrdersPage');

    const found = await runAxe(page, { include: '[data-testid="line-features"]' });
    expect(found.filter(isBlocking), format(found.filter(isBlocking))).toEqual([]);
  });

  test('billing shows its planted problems as sentences, with the rule and file:line in a collapsed Details', async ({ page }) => {
    await gotoCockpit(page, '/?feature=billing');
    const invoices = item(page, 'InvoicesPage');
    await expect(invoices.getByTestId('lf-item-status')).toHaveText('Needs attention', { timeout: 30_000 });
    const finding = invoices.getByTestId('lf-finding');
    await expect(finding).toContainText('Feature "billing" imports "../../orders/components/OrderButton" from feature "orders"; a feature may use only the library');
    await expect(finding.getByTestId('lf-finding-rule')).toBeHidden();
    await finding.getByText('Details').click();
    await expect(finding.getByTestId('lf-finding-rule')).toHaveText('LINE-DIR');
    await expect(finding.getByTestId('lf-finding-where')).toHaveText('features/billing/pages/InvoicesPage.tsx:4');
    await expect(item(page, 'InvoiceCard').getByTestId('lf-item-base')).toHaveText('It has no library base yet, so pick the library item it is based on.');
    await expect(page.getByTestId('lf-summary')).toContainText('InvoicesPage uses OrderButton from feature orders, which a feature may not do.');
    await expect(page.getByTestId('lf-coverage')).toHaveText('0 of 1 acceptance point is covered.');

    const found = await runAxe(page, { include: '[data-testid="line-features"]' });
    expect(found.filter(isBlocking), format(found.filter(isBlocking))).toEqual([]);
  });

  test('a page item opens Pages inside its feature; a component item opens Components', async ({ page }) => {
    await gotoCockpit(page, '/?feature=orders');
    await item(page, 'OrdersPage').getByRole('link', { name: 'Open OrdersPage in Pages' }).click({ timeout: 30_000 });
    await expect(page).toHaveURL(/\/pages\?feature=orders&page=orders%2Fpages%2FOrdersPage/);
    await expect(page.getByRole('heading', { name: 'Parts of OrdersPage' })).toBeVisible({ timeout: 30_000 });

    await gotoCockpit(page, '/?feature=orders');
    await item(page, 'OrderButton').getByRole('link', { name: 'Open OrderButton in Components' }).click({ timeout: 30_000 });
    await expect(page).toHaveURL(/\/components$/);
  });

  test('the route refuses an unknown feature with one sentence', async ({ request }) => {
    const res = await request.get(`${API}/api/line/feature?name=nope`);
    expect(res.status()).toBe(400);
    expect(await res.json()).toEqual({ ok: false, code: 'UNKNOWN_ITEM', sentence: 'There is no feature "nope"; pick one from the list.' });
  });

  // The Features stage sits behind the project gate, so the mock check runs while the sample is open.
  test('Line Features on the contract mock (?line=mock) still lists features and one feature\'s detail', async ({ page }) => {
    await gotoCockpit(page, '/?line=mock&feature=orders');
    await expect(page.getByTestId('lf-coverage')).toHaveText('1 of 2 acceptance points are covered.', { timeout: 30_000 });
    // cd1: with a feature open the chat is a side panel; "All features" brings the list back.
    await page.locator('[data-option-id="feature.back"]').click();
    await expect(cards(page)).toHaveText([/^billing/, /^orders/]);
  });
});
