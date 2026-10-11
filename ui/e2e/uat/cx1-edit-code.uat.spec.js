import { test, expect, freshSample, openSampleFromPicker, goToScreen, expectAxeClean, expectLayoutFits } from './support/uat.js';

// UAT cx1 (docs/line/review.md, fresh sample):
// 1. Pages -> orders -> OrdersPage -> on ListPage click "Edit code": only "What happens when Orders asks for more"
//    with `() => console.log('Show more orders')`.
// 2. Change the text to 'All orders' -> Save: "Saved. Changes the code for ..."; only that handler changed.
// 3. Edit again and type `() => {` -> Save: "This code is not a single valid expression, so nothing was saved." with
//    Details.
const LABEL = 'What happens when Orders asks for more';
const OLD = "() => console.log('Show more orders')";
const NEW = "() => console.log('All orders')";
const ORDERS = 'features/orders/pages/OrdersPage.tsx';
const pageRow = (page, name) => page.locator(`[data-testid="lp-page"][data-page="${name}"]`);
const pickFeature = (page, name) => page.getByRole('list', { name: 'Features' }).getByRole('button').filter({ hasText: name }).click();
let sample;
test.beforeAll(() => { sample = freshSample(); });

async function openEditCode(page) {
  const part = page.locator('[data-testid="lp-part"][data-part="ListPage"]');
  await part.getByRole('button', { name: 'Edit code' }).click();
  return part.locator('[data-testid="lp-fragment"][data-kind="handler"]');
}

test('cx1: edit one handler in place; bad code is refused in one sentence', async ({ page }, testInfo) => {
  await openSampleFromPicker(page);
  await goToScreen(page, 'Pages');
  await pickFeature(page, 'orders');
  await pageRow(page, 'OrdersPage').getByRole('button', { name: 'OrdersPage' }).click({ timeout: 30_000 });
  const before = sample.read(ORDERS);

  let form = await openEditCode(page);
  await expect(form.getByLabel(LABEL)).toHaveValue(OLD);
  await expect(page.getByTestId('line-pages')).not.toContainText('export function OrdersPage');
  await expectAxeClean(page, '[data-testid="line-pages"]');
  await expectLayoutFits(page, '[data-testid="line-pages"]', testInfo, 'edit-code');
  // The width change swaps the shell's layout, which closes the code box; open it again.
  if (!(await form.getByLabel(LABEL).isVisible())) form = await openEditCode(page);
  await form.getByLabel(LABEL).fill(NEW);
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('lp-outcome')).toHaveText(`Saved. Changes the code for "${LABEL}" in OrdersPage.`);
  expect(sample.read(ORDERS)).toBe(before.replace(OLD, NEW));

  form = await openEditCode(page);
  await form.getByLabel(LABEL).fill('() => {');
  page.allowHttp(400, '/api/line/');
  await form.getByRole('button', { name: 'Save' }).click();
  const refusal = form.getByTestId('lp-fragment-refusal');
  await expect(refusal.locator('p')).toHaveText('This code is not a single valid expression, so nothing was saved.');
  await refusal.getByText('Details').click();
  await expect(refusal.getByTestId('lp-fragment-detail')).not.toBeEmpty();
  expect(sample.read(ORDERS)).toBe(before.replace(OLD, NEW));
});
