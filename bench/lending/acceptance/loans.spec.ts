// Feature `loans`: LN-1..LN-4 (SPEC.md).
import { test, expect, type Page } from '@playwright/test';
import { AVAILABLE, fresh, borrow, choose, inDays, addButton } from './helpers';

const button = (page: Page, name: RegExp) => page.getByRole('button', { name });

test.beforeEach(async ({ page }) => { await fresh(page); });

test('LN-1: /loans shows each loan with its number, titles, branch, return-by date and "Ready for pickup", kept after a reload', async ({ page }) => {
  await page.goto('/loans');
  await expect(page.getByRole('heading', { level: 1, name: /^\s*my loans\s*$/i })).toBeVisible();
  await expect(page.getByText(/you have no loans/i).first()).toBeVisible();
  const b = AVAILABLE[0];
  const number = await borrow(page, [b.id], 'Riverside');
  await page.goto('/loans');
  await page.reload();
  await expect(page.getByText(new RegExp(`#\\s*${number}\\b`)).first()).toBeVisible();
  await expect(page.getByText(b.title).filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText(/riverside/i).filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText(inDays(21)).first()).toBeVisible();
  await expect(page.getByText(/ready for pickup/i).first()).toBeVisible();
  await expect(page.getByText(/you have no loans/i)).toHaveCount(0);
});

test('LN-2: Renew moves the return-by date 14 days later, once', async ({ page }) => {
  await borrow(page, [AVAILABLE[1].id]);
  await page.goto('/loans');
  await expect(page.getByText(inDays(21)).first()).toBeVisible();
  await button(page, /^\s*renew\b/i).first().click();
  await expect(page.getByText(inDays(35)).first()).toBeVisible();
  await expect(page.getByText(inDays(21))).toHaveCount(0);
  await expect(page.getByText(/\brenewed\b/i).first()).toBeVisible();
  const again = button(page, /^\s*renew\b/i);
  if (await again.count()) await expect(again.first()).toBeDisabled();
  await page.reload();
  await expect(page.getByText(inDays(35)).first()).toBeVisible();
});

test('LN-3: Change branch lets the member pick another branch and Save it', async ({ page }) => {
  await borrow(page, [AVAILABLE[2].id], 'Central');
  await page.goto('/loans');
  await expect(page.getByText(/\bcentral\b/i).filter({ visible: true }).first()).toBeVisible();
  await button(page, /change branch/i).first().click();
  const dialog = page.getByRole('dialog');
  const scope = (await dialog.count()) ? dialog.first() : page;
  await choose(page, /^\s*pickup branch\s*$/i, 'Hillview', scope);
  await scope.getByRole('button', { name: /^\s*save\b/i }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText(/\bhillview\b/i).filter({ visible: true }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByText(/\bhillview\b/i).filter({ visible: true }).first()).toBeVisible();
});

test('LN-4: Cancel loan asks first; Keep it changes nothing, Yes, cancel removes the loan and frees its books', async ({ page }) => {
  const b = AVAILABLE[3];
  const number = await borrow(page, [b.id]);
  await page.goto('/loans');
  await button(page, /cancel loan/i).first().click();
  await expect(page.getByText(/cancel this loan\?/i).first()).toBeVisible();
  await button(page, /^\s*keep it\s*$/i).click();
  await expect(page.getByText(new RegExp(`#\\s*${number}\\b`)).first()).toBeVisible();
  await button(page, /cancel loan/i).first().click();
  await button(page, /^\s*yes,?\s*cancel\s*$/i).click();
  await expect(page.getByText(new RegExp(`#\\s*${number}\\b`))).toHaveCount(0);
  await expect(page.getByText(/you have no loans/i).first()).toBeVisible();
  await page.goto(`/books/${b.id}`);
  await expect(addButton(page)).toBeEnabled();
});
