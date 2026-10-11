import { test, expect, freshSample, openSampleFromPicker, expectAxeClean, expectLayoutFits } from './support/uat.js';

// UAT Hour 3 (docs/line/review.md): open /components/preview?file=library/components/Button.tsx; a button reading
// "Label" with a `label` row under it; type "Buy now" and the button changes within a moment.
// UAT Hour 3b: Components -> Button card -> "Preview Button" -> change label to "Buy now"; the picture updates.
const card = (page, name) => page.getByTestId('ll-card').filter({ has: page.getByText(name, { exact: true }) });

test.beforeAll(() => freshSample());

test('Hour 3: the preview page draws Button and redraws it with a new label', async ({ page }, testInfo) => {
  await openSampleFromPicker(page);
  await page.goto('/components/preview?file=library/components/Button.tsx');
  const panel = page.getByTestId('line-component-preview');
  const inside = page.frameLocator('[data-testid="lr-frame"]');
  await expect(inside.getByRole('button', { name: 'Label' })).toBeVisible({ timeout: 60_000 });
  const label = panel.locator('[data-prop="label"]');
  await expect(label).toContainText('label');
  // The menu says where the person is: Components (it used to mark no screen here, or Pages at phone width).
  await expect(page.getByRole('navigation', { name: 'Screens', exact: true }).getByRole('link', { name: 'Components', exact: true })).toHaveAttribute('aria-current', 'page');
  const started = Date.now();
  await label.getByLabel('label').fill('Buy now');
  await expect(inside.getByRole('button', { name: 'Buy now' })).toBeVisible({ timeout: 5_000 });
  expect(Date.now() - started, 'redraws "within a moment"').toBeLessThan(5_000);
  await expectAxeClean(page, '[data-testid="line-preview-page"]', ['[data-testid="lr-frame"]']);
  await expectLayoutFits(page, '[data-testid="line-preview-page"]', testInfo, 'preview');
});

test('Hour 3b: Preview inside the Button card, then a new label redraws it', async ({ page }, testInfo) => {
  await openSampleFromPicker(page);
  await page.getByRole('navigation', { name: 'Screens', exact: true }).getByRole('link', { name: 'Components', exact: true }).click();
  const button = card(page, 'Button');
  await expect(button).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('line-component-preview')).toHaveCount(0);
  await button.getByText('Preview Button', { exact: true }).click();
  const inside = page.frameLocator('[data-testid="ll-card"] [data-testid="lr-frame"]');
  await expect(inside.getByRole('button', { name: 'Label' })).toBeVisible({ timeout: 60_000 });
  await button.getByLabel('label').fill('Buy now');
  await expect(inside.getByRole('button', { name: 'Buy now' })).toBeVisible({ timeout: 5_000 });
  await expectAxeClean(page, '[data-testid="line-library"]', ['[data-testid="lr-frame"]']);
  await button.getByText('Preview Button', { exact: true }).click();
  await expect(page.getByTestId('line-component-preview')).toHaveCount(0);
  // Last: a width change remounts the screen, which closes an open preview (merge-batch run 11 Oct).
  await expectLayoutFits(page, '[data-testid="line-library"]', testInfo, 'card-preview');
});
