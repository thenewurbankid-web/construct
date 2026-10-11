import fs from 'node:fs';
import path from 'node:path';
import { test, expect, freshSample, openSampleFromPicker, goToScreen, expectAxeClean, expectLayoutFits } from './support/uat.js';

// UAT cu6 (docs/line/review.md, fresh sample):
// 1. Project switcher -> "Change workspace folder" -> features/ -> Use on orders. Header shows "/ features/orders";
//    Badge and InvoiceCard show "Read-only".
// 2. Badge -> Base on this -> orders -> Create: saves.
// 3. Same with billing: "Nothing was saved: ... it stays read-only." and no new file under features/billing.
const card = (page, name) => page.getByTestId('ll-card').filter({ has: page.getByText(name, { exact: true }) });
const featureRow = (page, name) => page.getByTestId('ll-feature-row').filter({ has: page.getByText(name, { exact: true }) });
let sample;
test.beforeAll(() => { sample = freshSample(); });

test('cu6: one workspace folder; outside it stays read-only', async ({ page }, testInfo) => {
  await openSampleFromPicker(page);
  await goToScreen(page, 'Components');
  await expect(page.getByTestId('line-library')).toBeVisible({ timeout: 30_000 });

  await page.getByTestId('project-switcher').click();
  const popover = page.getByRole('dialog', { name: 'Switch project' });
  await popover.getByRole('button', { name: 'Change workspace folder' }).click();
  const picker = popover.getByRole('region', { name: 'Pick the workspace folder' });
  await picker.getByRole('button', { name: 'features/', exact: true }).click();
  await expectAxeClean(page, '#sh-project-popover');
  await expectLayoutFits(page, '#sh-project-popover', testInfo, 'workspace-picker');
  await picker.getByRole('button', { name: 'Use features/orders' }).click();
  await expect(page.getByTestId('project-workspace')).toHaveText('features/orders', { timeout: 30_000 });

  const badge = card(page, 'Badge');
  await expect(badge.getByTestId('line-read-only')).toHaveText('Read-only', { timeout: 30_000 });
  await expect(featureRow(page, 'InvoiceCard').getByTestId('line-read-only')).toHaveText('Read-only');
  await expect(featureRow(page, 'OrderCard').getByTestId('line-read-only')).toHaveCount(0);

  await badge.getByRole('button', { name: /^Base on this/ }).click();
  let form = badge.getByRole('form');
  await form.getByLabel('Feature').selectOption('orders');
  await form.getByLabel('Name').fill('StatusBadge');
  await form.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByTestId('ll-notice')).toContainText('Saved.');
  expect(sample.exists('features/orders/components/StatusBadge.tsx')).toBe(true);

  // Step 3: billing is outside the folder, so Base on does not even offer it; a change that would write there anyway
  // (Promote billing's InvoiceCard) is refused in one sentence and writes nothing.
  await badge.getByRole('button', { name: /^Base on this/ }).click();
  form = badge.getByRole('form');
  await expect(form.getByLabel('Feature').locator('option')).toHaveText(['orders']);
  await form.getByRole('button', { name: 'Cancel' }).click();

  const billingBefore = fs.readdirSync(path.join(sample.dir, 'features/billing/components')).sort();
  const invoice = featureRow(page, 'InvoiceCard');
  await invoice.getByRole('button', { name: /^Promote to library/ }).click();
  const confirm = invoice.getByRole('group', { name: 'Promote InvoiceCard to the library' });
  page.allowHttp(400, '/api/line/');
  await confirm.getByRole('button', { name: 'Promote', exact: true }).click();
  const refusal = confirm.getByRole('alert');
  await expect(refusal).toHaveText(/^Nothing was saved: .* is outside your workspace folder features\/orders; it stays read-only\.$/);
  // The sentence wraps inside its box (a long file path used to run out of it).
  expect(await refusal.evaluate((n) => n.scrollWidth <= n.clientWidth)).toBe(true);
  expect(fs.readdirSync(path.join(sample.dir, 'features/billing/components')).sort()).toEqual(billingBefore);
  expect(sample.exists('library/components/InvoiceCard.tsx')).toBe(false);
  await expectLayoutFits(page, '[data-testid="line-library"]', testInfo, 'components-read-only');
});
