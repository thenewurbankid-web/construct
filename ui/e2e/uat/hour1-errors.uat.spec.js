import { test, expect, freshSample, openSampleFromPicker, expectAxeClean, expectLayoutFits } from './support/uat.js';

// UAT Hour 1 (docs/line/review.md): open line-sample from the picker; the status bar says "validate: 2 problems";
// clicking it shows two sentences in Diagnostics; Details under each shows the rule and file:line.
const PLANTED = [
  { says: /billing.*imports.*from feature "orders".*promote that item to library/, rule: 'LINE-DIR', where: 'features/billing/pages/InvoicesPage.tsx:4' },
  { says: /InvoiceCard.*has no library base/, rule: 'LINE-BASE', where: 'features/billing/components/InvoiceCard.tsx:1' },
];

test.beforeAll(() => freshSample());

test('Hour 1: the two planted problems show as sentences, rule and file:line under Details', async ({ page }, testInfo) => {
  await openSampleFromPicker(page);
  const status = page.getByTestId('status-validate');
  await expect(status).toHaveText(/validate: 2 problems/, { timeout: 30_000 });
  await status.click();
  const drawer = page.getByRole('region', { name: 'Bottom panel: Run' });
  const items = drawer.getByTestId('diagnostic-item');
  await expect(items).toHaveCount(2);
  for (const p of PLANTED) {
    const item = items.filter({ hasText: p.says });
    await expect(item).toHaveCount(1);
    await expect(item.getByTestId('diagnostic-row')).not.toContainText(p.rule);
    await item.getByTestId('diagnostic-details').getByText('Details', { exact: true }).click();
    await expect(item.getByTestId('diagnostic-details')).toContainText(p.rule);
    await expect(item.getByTestId('diagnostic-details')).toContainText(p.where);
  }
  await expectAxeClean(page, '[aria-label="Problems"]');
  // The owner can read which project is open, at desktop and phone width (it used to read "line-sa… / Whole pr…").
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 800 });
    const name = page.getByTestId('project-switcher').locator('.sh-project-name');
    await expect(name).toHaveText('line-sample');
    // scrollWidth rounds; the text's own box is exact (an ellipsis shows as soon as it is a fraction wider).
    await expect.poll(() => name.evaluate((n) => {
      const r = document.createRange();
      r.selectNodeContents(n);
      return r.getBoundingClientRect().width <= n.getBoundingClientRect().width + 0.01;
    }), { message: `the whole name shows at ${width}px` }).toBe(true);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await expectLayoutFits(page, '[aria-label="Problems"]', testInfo, 'diagnostics');
});
