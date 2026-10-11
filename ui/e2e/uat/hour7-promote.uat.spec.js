import { test, expect, freshSample, openSampleFromPicker, goToScreen, expectAxeClean } from './support/uat.js';

// UAT Hour 7 (docs/line/review.md, fresh sample): Components -> under orders, OrderButton -> Promote to library ->
// read the sentence -> Promote: the green sentence, an OrderButton card under Molecules, and the status bar at
// "1 problem" with only the InvoiceCard sentence left.
const featureRow = (page, name) => page.getByTestId('ll-feature-row').filter({ has: page.getByText(name, { exact: true }) });
let sample;
test.beforeAll(() => { sample = freshSample(); });

test('Hour 7: Promote OrderButton to the library clears the cross-feature problem', async ({ page }) => {
  await openSampleFromPicker(page);
  await goToScreen(page, 'Components');
  const status = page.getByTestId('status-validate');
  await expect(status).toContainText('2 problems', { timeout: 30_000 });
  const row = featureRow(page, 'OrderButton');
  await row.getByRole('button', { name: /^Promote to library/ }).click();
  const confirm = row.getByRole('group', { name: 'Promote OrderButton to the library' });
  await expect(confirm).toContainText('This moves OrderButton into library/');
  await expectAxeClean(page, '[data-testid="line-library"]');
  await confirm.getByRole('button', { name: 'Promote', exact: true }).click();
  await expect(page.getByTestId('ll-notice')).toContainText('Saved. Moves OrderButton from feature orders into the library');
  await expect(page.getByTestId('ll-group-molecule').getByTestId('ll-card').filter({ has: page.getByText('OrderButton', { exact: true }) })).toBeVisible();
  await expect(featureRow(page, 'OrderButton')).toHaveCount(0);
  expect(sample.exists('library/components/OrderButton.tsx')).toBe(true);
  expect(sample.exists('features/orders/components/OrderButton.tsx')).toBe(false);
  await expect(status).toContainText('1 problem', { timeout: 30_000 });
  await status.click();
  const items = page.getByRole('region', { name: 'Bottom panel: Run' }).getByTestId('diagnostic-item');
  await expect(items).toHaveCount(1);
  await expect(items.first()).toContainText('InvoiceCard');
});
