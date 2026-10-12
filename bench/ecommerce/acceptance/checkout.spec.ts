import { test, expect } from '@playwright/test';
import { money, fresh, addToCart, fillCheckout, cartLink } from './helpers';

test.beforeEach(async ({ page }) => { await fresh(page); });

test('CHK-1: /checkout has the heading, the five fields and the terms checkbox', async ({ page }) => {
  await addToCart(page, 'desk-lamp', 1);
  await page.goto('/checkout');
  await expect(page.getByRole('heading', { level: 1, name: /^\s*checkout\s*$/i })).toBeVisible();
  for (const l of [/^\s*full name\s*$/i, /^\s*email\s*$/i, /^\s*address\s*$/i, /^\s*city\s*$/i, /^\s*postal code\s*$/i]) await expect(page.getByLabel(l)).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /i accept the terms/i })).toBeVisible();
});

test('CHK-2: invalid fields show their messages, are marked invalid, and no order is placed', async ({ page }) => {
  await addToCart(page, 'desk-lamp', 1);
  await page.goto('/checkout');
  await page.getByLabel(/^\s*email\s*$/i).fill('not-an-email');
  await page.getByLabel(/^\s*postal code\s*$/i).fill('12');
  await page.getByRole('button', { name: /place order/i }).click();
  for (const m of [/full name is required/i, /enter a valid email/i, /postal code must be 5 digits/i, /accept the terms to continue/i]) await expect(page.getByText(m).first()).toBeVisible();
  await expect(page.getByLabel(/^\s*full name\s*$/i)).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByLabel(/^\s*email\s*$/i)).toHaveAttribute('aria-invalid', 'true');
  await expect(page).toHaveURL(/\/checkout\/?$/);
  await expect(cartLink(page)).toHaveAccessibleName(/\b1\b/);
});

test('CHK-3: the order summary shows products, quantities and the total', async ({ page }) => {
  await addToCart(page, 'ceramic-mug', 2);
  await page.goto('/checkout');
  await expect(page.getByText('Ceramic Mug').first()).toBeVisible();
  await expect(page.getByText(/\b2\b/).first()).toBeVisible();
  await expect(page.getByText(money(37)).first()).toBeVisible();
});

test('CHK-4 and CHK-5: a valid order is placed, the cart empties, the confirmation shows it', async ({ page }) => {
  await addToCart(page, 'ceramic-mug', 2);
  await page.goto('/checkout');
  const external: string[] = [];
  page.on('request', (r) => { const u = new URL(r.url()); if (!['localhost', '127.0.0.1'].includes(u.hostname)) external.push(r.url()); });
  await fillCheckout(page);
  await page.getByRole('button', { name: /place order/i }).click();
  await expect(page).toHaveURL(/\/order\/confirmation\/?/);
  await expect(page.getByRole('heading', { level: 1, name: /thank you for your order/i })).toBeVisible();
  await expect(page.getByText(/order #\s*\S+/i).first()).toBeVisible();
  await expect(page.getByText('Ceramic Mug').first()).toBeVisible();
  await expect(page.getByText(money(37)).first()).toBeVisible();
  expect(external, 'no network calls outside the app').toEqual([]);
  await expect(cartLink(page)).toHaveAccessibleName(/\b0\b|^\s*cart\s*$/i);
  await page.getByRole('link', { name: /continue shopping/i }).click();
  await expect(page).toHaveURL(/\/$/);
});

test('CHK-6: /checkout with an empty cart says so and links to the products', async ({ page }) => {
  await page.goto('/checkout');
  await expect(page.getByText(/your cart is empty/i)).toBeVisible();
  await expect(page.getByLabel(/^\s*full name\s*$/i)).toHaveCount(0);
  await page.getByRole('link', { name: /products|shop|continue shopping/i }).filter({ hasNotText: /cart/i }).first().click();
  await expect(page).toHaveURL(/\/$/);
});
