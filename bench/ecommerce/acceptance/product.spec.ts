import { test, expect } from '@playwright/test';
import { byName, money, fresh, setQuantity, cartLink } from './helpers';

test.beforeEach(async ({ page }) => { await fresh(page); });

test('PROD-1: /products/<id> shows name, category, description and price', async ({ page }) => {
  const p = byName('Ceramic Mug');
  await page.goto(`/products/${p.id}`);
  await expect(page.getByRole('heading', { level: 1, name: p.name })).toBeVisible();
  await expect(page.getByText(p.category, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(p.description)).toBeVisible();
  await expect(page.getByText(money(p.price)).first()).toBeVisible();
});

test('PROD-2: Quantity (default 1) and Add to cart add that many, with "Added to cart"', async ({ page }) => {
  await page.goto('/products/wool-beanie');
  const qty = page.getByLabel(/^\s*quantity\s*$/i);
  await expect(qty).toHaveValue('1');
  await setQuantity(qty, 3);
  await page.getByRole('button', { name: /add to cart/i }).click();
  await expect(page.getByText(/added to cart/i).first()).toBeVisible();
  await expect(cartLink(page)).toHaveAccessibleName(/\b3\b/);
});

test('PROD-3: an unknown id says "Product not found" with a link back', async ({ page }) => {
  await page.goto('/products/no-such-thing');
  await expect(page.getByText(/product not found/i).first()).toBeVisible();
  await page.getByRole('link', { name: /products/i }).filter({ hasNotText: /cart/i }).first().click();
  await expect(page).toHaveURL(/\/$/);
});

test('PROD-4: "Back to products" returns to /', async ({ page }) => {
  await page.goto('/products/desk-lamp');
  await page.getByRole('link', { name: /back to products/i }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { level: 1, name: /^\s*products\s*$/i })).toBeVisible();
});
