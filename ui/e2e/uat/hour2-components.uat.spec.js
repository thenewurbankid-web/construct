import { test, expect, freshSample, openSampleFromPicker, goToScreen, expectAxeClean, expectLayoutFits } from './support/uat.js';

// UAT Hour 2 (docs/line/review.md): Components shows "Your component library": Atoms (Badge not used yet, Button used
// by 1), Molecules (Card used by 1), Organisms (DataTable not used yet); under Feature components, billing's
// InvoiceCard says "No library base yet" with its sentence (LINE-BASE under Details), orders shows OrderButton
// "Based on Button" and OrderCard "Based on Card".
const card = (page, name) => page.getByTestId('ll-card').filter({ has: page.getByText(name, { exact: true }) });
const featureRow = (page, name) => page.getByTestId('ll-feature-row').filter({ has: page.getByText(name, { exact: true }) });

test.beforeAll(() => freshSample());

test('Hour 2: the library as cards by level, feature components with their base', async ({ page }, testInfo) => {
  await openSampleFromPicker(page);
  await goToScreen(page, 'Components');
  await expect(page.getByRole('heading', { level: 1, name: 'Your component library' })).toBeVisible({ timeout: 30_000 });
  for (const [name, level, used] of [
    ['Badge', 'Atom', 'Not used by any feature yet'],
    ['Button', 'Atom', 'Used by 1 feature component'],
    ['Card', 'Molecule', 'Used by 1 feature component'],
    ['DataTable', 'Organism', 'Not used by any feature yet'],
  ]) {
    await expect(card(page, name)).toContainText(level);
    await expect(card(page, name).getByTestId('ll-used-by')).toHaveText(used);
  }
  const invoice = featureRow(page, 'InvoiceCard');
  await expect(invoice.getByTestId('ll-base')).toHaveText('No library base yet');
  await expect(invoice).toContainText('has no library base');
  await expect(invoice.getByText('LINE-BASE', { exact: true })).toBeHidden();
  await invoice.getByText('Details', { exact: true }).click();
  await expect(invoice.getByText('LINE-BASE', { exact: true })).toBeVisible();
  await expect(featureRow(page, 'OrderButton').getByTestId('ll-base')).toHaveText('Based on Button');
  await expect(featureRow(page, 'OrderCard').getByTestId('ll-base')).toHaveText('Based on Card');
  await expectAxeClean(page, '[data-testid="line-library"]');
  await expectLayoutFits(page, '[data-testid="line-library"]', testInfo, 'components');
});
