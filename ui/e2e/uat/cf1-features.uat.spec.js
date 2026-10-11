import { test, expect, freshSample, openSampleFromPicker, goToScreen, expectAxeClean, expectLayoutFits } from './support/uat.js';

// UAT cf1 (docs/line/review.md, fresh sample):
// 1. Features (`/`) -> "Your features": billing "Needs attention", orders "All fine".
// 2. Click orders -> items with "Based on ...", the Auto summary, "1 of 2 acceptance points are covered."
// 3. Click billing -> open Details on InvoicesPage's problem (LINE-DIR, `InvoicesPage.tsx:4`); click a page name ->
//    Pages opens on it.
const cards = (page) => page.getByRole('list', { name: 'Features' }).getByTestId('ln-pick');
const item = (page, name) => page.locator(`[data-testid="lf-item"][data-item="${name}"]`);

test.beforeAll(() => freshSample());

test('cf1: a feature with everything it owns, its summary and spec coverage', async ({ page }, testInfo) => {
  await openSampleFromPicker(page);
  await goToScreen(page, 'Features');
  // cd1: Features opens as a full-screen chat; its first message lists the features with their status.
  await expect(page.getByTestId('lf-chat-entry')).toBeVisible({ timeout: 30_000 });
  await expect(cards(page).filter({ hasText: 'billing' })).toContainText('Needs attention');
  await expect(cards(page).filter({ hasText: 'orders' })).toContainText('All fine');
  await expectLayoutFits(page, '[data-testid="line-features"]', testInfo, 'features');

  await cards(page).filter({ hasText: 'orders' }).click();
  await expect(item(page, 'OrdersPage').getByTestId('lf-item-base')).toHaveText('Based on ListPage');
  await expect(page.getByTestId('lf-summary')).toContainText('Everything in orders passes the checks.');
  await expect(page.getByTestId('lf-coverage')).toHaveText('1 of 2 acceptance points are covered.');
  await expectAxeClean(page, '[data-testid="line-features"]');
  await expectLayoutFits(page, '[data-testid="line-features"]', testInfo, 'feature-orders');

  // cd1: the open feature's chat offers "All features" to go back to the list.
  await page.locator('[data-option-id="feature.back"]').click();
  await cards(page).filter({ hasText: 'billing' }).click();
  const finding = item(page, 'InvoicesPage').getByTestId('lf-finding');
  await finding.getByText('Details').click();
  await expect(finding.getByTestId('lf-finding-rule')).toHaveText('LINE-DIR');
  await expect(finding.getByTestId('lf-finding-where')).toHaveText('features/billing/pages/InvoicesPage.tsx:4');
  await item(page, 'InvoicesPage').getByRole('link', { name: 'Open InvoicesPage in Pages' }).click();
  await expect(page).toHaveURL(/\/pages\?feature=billing&page=billing%2Fpages%2FInvoicesPage/);
  await expect(page.getByRole('heading', { name: 'Parts of InvoicesPage' })).toBeVisible({ timeout: 30_000 });
});
