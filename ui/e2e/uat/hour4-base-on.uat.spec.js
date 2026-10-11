import { test, expect, freshSample, openSampleFromPicker, goToScreen, expectAxeClean } from './support/uat.js';

// UAT Hour 4 (docs/line/review.md): Components -> Badge card -> Base on this -> Feature "orders", Name "StatusBadge"
// -> Create: the green sentence, "Used by 1 feature component" on Badge, StatusBadge "Based on Badge" under orders.
// Then Button with orders / OrderButton: one refusal sentence, nothing changes.
const card = (page, name) => page.getByTestId('ll-card').filter({ has: page.getByText(name, { exact: true }) });
const featureRow = (page, name) => page.getByTestId('ll-feature-row').filter({ has: page.getByText(name, { exact: true }) });
let sample;
test.beforeAll(() => { sample = freshSample(); });

test('Hour 4: Base on this creates StatusBadge in orders; a taken name is refused in one sentence', async ({ page }) => {
  await openSampleFromPicker(page);
  await goToScreen(page, 'Components');
  const badge = card(page, 'Badge');
  await expect(badge.getByTestId('ll-used-by')).toHaveText('Not used by any feature yet', { timeout: 30_000 });
  await badge.getByRole('button', { name: /^Base on this/ }).click();
  const form = badge.getByRole('form');
  await form.getByLabel('Feature').selectOption('orders');
  await form.getByLabel('Name').fill('StatusBadge');
  await expectAxeClean(page, '[data-testid="line-library"]');
  await form.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByTestId('ll-notice')).toContainText('Saved. Creates StatusBadge in feature orders, based on the library Badge.');
  await expect(badge.getByTestId('ll-used-by')).toHaveText('Used by 1 feature component');
  await expect(featureRow(page, 'StatusBadge').getByTestId('ll-base')).toHaveText('Based on Badge');
  expect(sample.read('features/orders/components/StatusBadge.tsx').split('\n')[0]).toBe('// @line-base components/Badge');

  const button = card(page, 'Button');
  const before = sample.read('features/orders/components/OrderButton.tsx');
  await button.getByRole('button', { name: /^Base on this/ }).click();
  const second = button.getByRole('form');
  await second.getByLabel('Feature').selectOption('orders');
  await second.getByLabel('Name').fill('OrderButton');
  page.allowHttp(400, '/api/line/');
  await second.getByRole('button', { name: 'Create' }).click();
  await expect(second.getByRole('alert')).toHaveText(/already has a component named OrderButton; pick another name\.$/);
  await expect(button.getByTestId('ll-used-by')).toHaveText('Used by 1 feature component');
  expect(sample.read('features/orders/components/OrderButton.tsx')).toBe(before);
  await second.getByRole('button', { name: 'Cancel' }).click();
  await expect(second).toHaveCount(0);
});
