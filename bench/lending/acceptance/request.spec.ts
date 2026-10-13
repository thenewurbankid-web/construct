// Feature `request`: REQ-1..REQ-5 (SPEC.md).
import { test, expect } from '@playwright/test';
import { AVAILABLE, BRANCHES, fresh, pick, picksLink, fillRequest, borrow, choose, inDays, expectCannotPick } from './helpers';

const NAME = /^\s*name\s*$/i;
const CARD = /^\s*library card number\s*$/i;
const EMAIL = /^\s*email\s*$/i;
const send = (page: import('@playwright/test').Page) => page.getByRole('button', { name: /send request/i });

test.beforeEach(async ({ page }) => { await fresh(page); });

test('REQ-1: /request shows the picked titles, the return-by date and the form fields', async ({ page }) => {
  const [a, b] = AVAILABLE;
  await pick(page, a.id);
  await pick(page, b.id);
  await page.goto('/request');
  await expect(page.getByRole('heading', { level: 1, name: /^\s*request books\s*$/i })).toBeVisible();
  await expect(page.getByText(a.title).filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText(b.title).filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText(inDays(21)).first()).toBeVisible();
  await expect(page.getByLabel(NAME)).toBeVisible();
  await expect(page.getByLabel(CARD)).toBeVisible();
  await expect(page.getByLabel(EMAIL)).toBeVisible();
  // Every branch can be chosen.
  for (const branch of BRANCHES) await choose(page, /^\s*pickup branch\s*$/i, branch);
});

test('REQ-2: a missing or wrong value sends nothing and says what is wrong, field by field', async ({ page }) => {
  await pick(page, AVAILABLE[0].id);
  await page.goto('/request');
  await send(page).click();
  await expect(page).toHaveURL(/\/request\/?$/);
  await expect(page.getByText(/enter your name/i).first()).toBeVisible();
  await expect(page.getByText(/a card number is 2 letters and 6 digits/i).first()).toBeVisible();
  await expect(page.getByText(/enter a valid email/i).first()).toBeVisible();
  await expect(page.getByText(/choose a pickup branch/i).first()).toBeVisible();
  for (const f of [NAME, CARD, EMAIL]) await expect(page.getByLabel(f)).toHaveAttribute('aria-invalid', 'true');
  // Wrong values: a short card number and an email without a domain; the name is fine now.
  await page.getByLabel(NAME).fill('Grace Hopper');
  await page.getByLabel(CARD).fill('12345');
  await page.getByLabel(EMAIL).fill('grace@');
  await choose(page, /^\s*pickup branch\s*$/i, 'Riverside');
  await send(page).click();
  await expect(page).toHaveURL(/\/request\/?$/);
  await expect(page.getByText(/a card number is 2 letters and 6 digits/i).first()).toBeVisible();
  await expect(page.getByText(/enter a valid email/i).first()).toBeVisible();
  await expect(page.getByText(/enter your name/i)).toHaveCount(0);
  await expect(page.getByLabel(NAME)).not.toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByLabel(CARD)).toHaveAttribute('aria-invalid', 'true');
});

test('REQ-3: a valid request empties the picks, marks the books on loan and opens /request/done', async ({ page }) => {
  const b = AVAILABLE[0];
  await pick(page, b.id);
  await page.goto('/request');
  await fillRequest(page);
  await send(page).click();
  await expect(page).toHaveURL(/\/request\/done\/?$/);
  await expect(picksLink(page)).toContainText('(0)');
  await page.goto(`/books/${b.id}`);
  await expect(page.getByText(/\bon loan\b/i).filter({ visible: true }).first()).toBeVisible();
  await expectCannotPick(page);
});

test('REQ-4: /request/done shows the loan number, the titles, the branch and the return-by date, and links to My loans', async ({ page }) => {
  const [a, b, c] = AVAILABLE;
  const number = await borrow(page, [a.id, b.id, c.id], 'Hillview');
  await expect(page.getByRole('heading', { level: 1, name: /^\s*request received\s*$/i })).toBeVisible();
  expect(number.length).toBeGreaterThan(0);
  for (const x of [a, b, c]) await expect(page.getByText(x.title).filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText(/hillview/i).filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText(inDays(14)).first()).toBeVisible();
  await page.getByRole('link', { name: /see my loans/i }).click();
  await expect(page).toHaveURL(/\/loans\/?$/);
});

test('REQ-5: /request with no picks says so and links back to the catalogue, with no form', async ({ page }) => {
  await page.goto('/request');
  await expect(page.getByText(/you have not picked any books yet/i).first()).toBeVisible();
  await expect(send(page)).toHaveCount(0);
  await page.getByRole('link', { name: /catalogue/i }).first().click();
  await expect(page).toHaveURL(/\/$/);
});
