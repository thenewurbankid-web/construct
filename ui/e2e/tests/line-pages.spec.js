import { test, expect } from '@playwright/test';
import { gotoCockpit } from './support/cockpit.js';
import { runAxe, isBlocking, format } from './support/axe.js';

// Line Cockpit T6 -- the Pages screen of a Line project, run on the contract's mock (packages/engine/line/mock.mjs)
// through ?line=mock, because the real /api/line routes are being built in parallel. The mock project has two
// features: orders (OrdersPage, based on ListPage, fine) and billing (InvoicesPage, based on ListPage, with a planted
// cross-feature import, LINE-DIR). Any save to InvoicesPage is refused by the checked writer for that reason.
const MOCK = '/pages?line=mock';
const features = (page) => page.getByRole('list', { name: 'Features' }).getByRole('button');
const pageRow = (page, name) => page.locator(`[data-testid="lp-page"][data-page="${name}"]`);
const titleProp = (page) => page.locator('[data-testid="lp-part"][data-part="ListPage"] [data-testid="lp-prop"][data-prop="title"]');

test.describe.serial('Line Pages screen on the contract mock', () => {
  test('/pages asks which feature first, then lists that feature\'s pages with their library base', async ({ page }) => {
    await gotoCockpit(page, MOCK);
    await expect(page.getByTestId('line-pages')).toBeVisible();
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
    await gotoCockpit(page, `${MOCK}&feature=billing`);
    const row = pageRow(page, 'InvoicesPage');
    await expect(row.getByTestId('lp-page-base')).toHaveText('Based on ListPage');
    await expect(row.getByTestId('lp-page-status')).toHaveText('Needs attention');
    const finding = row.getByTestId('lp-finding');
    await expect(finding).toHaveCount(1);
    await expect(finding).toContainText('Feature "billing" imports from feature "orders"; a feature may use only the library');
    await expect(finding.getByTestId('lp-finding-rule')).toBeHidden();
    await finding.getByText('Details').click();
    await expect(finding.getByTestId('lp-finding-rule')).toHaveText('LINE-DIR');
    await expect(finding.getByTestId('lp-finding-where')).toHaveText('features/billing/pages/InvoicesPage.tsx:3');
  });

  test('picking a page shows its parts; changing the title and saving shows "Saved. ..." and the new value', async ({ page }) => {
    await gotoCockpit(page, `${MOCK}&feature=orders`);
    await pageRow(page, 'OrdersPage').getByRole('button', { name: 'OrdersPage' }).click();
    await expect(page).toHaveURL(/[?&]page=orders%2Fpages%2FOrdersPage/);
    await expect(page.getByRole('heading', { name: 'Parts of OrdersPage' })).toBeVisible();
    const prop = titleProp(page);
    await expect(prop.getByTestId('lp-prop-now')).toHaveText('Now: Orders');
    const save = prop.getByRole('button', { name: 'Save' });
    await expect(save).toBeDisabled();
    await prop.getByLabel('title').fill('All orders');
    await save.click();
    await expect(page.getByTestId('lp-outcome')).toHaveText('Saved. Sets title to "All orders" on the page OrdersPage.');
    await expect(titleProp(page).getByTestId('lp-prop-now')).toHaveText('Now: All orders');
    await expect(titleProp(page).getByLabel('title')).toHaveValue('All orders');
    await expect(pageRow(page, 'OrdersPage').getByTestId('lp-page-status')).toHaveText('Fine');
  });

  test('a refused save says "Nothing was saved: ..." with why, and the page is unchanged', async ({ page }) => {
    await gotoCockpit(page, `${MOCK}&feature=billing&page=billing%2Fpages%2FInvoicesPage`);
    const prop = titleProp(page);
    await expect(prop.getByTestId('lp-prop-now')).toHaveText('Now: Invoices');
    await prop.getByLabel('title').fill('Bills');
    await prop.getByRole('button', { name: 'Save' }).click();
    const outcome = page.getByTestId('lp-outcome');
    await expect(outcome.locator('p')).toHaveText(/^Nothing was saved: feature "billing" imports from feature "orders"/);
    await expect(outcome.getByTestId('lp-finding-rule')).toHaveText('LINE-DIR', { useInnerText: false });
    await expect(titleProp(page).getByTestId('lp-prop-now')).toHaveText('Now: Invoices');
    await expect(titleProp(page).getByLabel('title')).toHaveValue('Invoices');
  });

  test('no blocking accessibility violations on the feature picker, the page list and the parts', async ({ page }) => {
    await gotoCockpit(page, `${MOCK}&feature=billing&page=billing%2Fpages%2FInvoicesPage`);
    await expect(titleProp(page)).toBeVisible();
    await pageRow(page, 'InvoicesPage').getByText('Details').click();
    const found = await runAxe(page, { include: '[data-testid="line-pages"]' });
    expect(found.filter(isBlocking), format(found.filter(isBlocking))).toEqual([]);
  });
});
