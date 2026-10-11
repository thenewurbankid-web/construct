import { test, expect, freshSample, openSampleFromPicker, goToScreen, expectAxeClean, expectLayoutFits } from './support/uat.js';

// UAT Hours 5 and 6 (docs/line/review.md, fresh sample):
// 1. Pages -> pick orders -> OrdersPage "Based on ListPage", "Fine".
// 2. Open OrdersPage, set the title to "All orders", Save: "Saved. ..." and the new value.
// 3. Pick billing -> InvoicesPage shows "Needs attention" with its sentence; change its title and Save: it saves,
//    and still shows the old problem.
const pageRow = (page, name) => page.locator(`[data-testid="lp-page"][data-page="${name}"]`);
const pickFeature = (page, name) => page.getByRole('list', { name: 'Features' }).getByRole('button').filter({ hasText: name }).click();
const titleProp = (page) => page.locator('[data-testid="lp-part"][data-part="ListPage"] [data-testid="lp-prop"][data-prop="title"]');
let sample;
test.beforeAll(() => { sample = freshSample(); });

test('Hours 5-6: pages inside a feature, and setting one prop', async ({ page }, testInfo) => {
  await openSampleFromPicker(page);
  await goToScreen(page, 'Pages');
  await expect(page.getByRole('heading', { name: 'Which feature?' })).toBeVisible({ timeout: 30_000 });
  await pickFeature(page, 'orders');
  const orders = pageRow(page, 'OrdersPage');
  await expect(orders.getByTestId('lp-page-base')).toHaveText('Based on ListPage');
  await expect(orders.getByTestId('lp-page-status')).toHaveText('Fine');
  await expectLayoutFits(page, '[data-testid="line-pages"]', testInfo, 'pages-orders');

  await orders.getByRole('button', { name: 'OrdersPage' }).click();
  await titleProp(page).getByLabel('title').fill('All orders');
  await titleProp(page).getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('lp-outcome')).toHaveText(/^Saved\. /);
  await expect(titleProp(page).getByTestId('lp-prop-now')).toHaveText('Now: All orders');
  expect(sample.read('features/orders/pages/OrdersPage.tsx')).toContain('title="All orders"');
  await expectAxeClean(page, '[data-testid="line-pages"]');
  await expectLayoutFits(page, '[data-testid="line-pages"]', testInfo, 'pages-props');

  await pickFeature(page, 'billing');
  const invoices = pageRow(page, 'InvoicesPage');
  await expect(invoices.getByTestId('lp-page-status')).toHaveText('Needs attention', { timeout: 30_000 });
  await expect(invoices.getByTestId('lp-finding')).toContainText('imports');
  await invoices.getByRole('button', { name: 'InvoicesPage' }).click();
  await titleProp(page).getByLabel('title').fill('Bills');
  await titleProp(page).getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('lp-outcome')).toHaveText(/^Saved\. /);
  await expect(pageRow(page, 'InvoicesPage').getByTestId('lp-page-status')).toHaveText('Needs attention');
});
