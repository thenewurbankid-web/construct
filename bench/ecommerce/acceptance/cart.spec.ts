import { test, expect } from '@playwright/test';
import { byName, money, fresh, addToCart, cartLink, setQuantity, summaryRow, esc } from './helpers';

test.beforeEach(async ({ page }) => { await fresh(page); });

const qtyFor = (page: import('@playwright/test').Page, name: string) => page.getByLabel(new RegExp(`^\\s*quantity for ${esc(name)}\\s*$`, 'i'));

test('CART-1: every page shows "Cart (n)" linking to /cart', async ({ page }) => {
  await expect(cartLink(page)).toHaveAccessibleName(/\b0\b|^\s*cart\s*$/i);
  await addToCart(page, 'ceramic-mug', 2);
  await addToCart(page, 'desk-lamp', 1);
  for (const url of ['/', '/products/desk-lamp', '/cart']) {
    await page.goto(url);
    await expect(cartLink(page)).toHaveAccessibleName(/\b3\b/);
  }
  await cartLink(page).click();
  await expect(page).toHaveURL(/\/cart\/?$/);
});

test('CART-2: /cart lists name, unit price, a quantity field and the line total', async ({ page }) => {
  await addToCart(page, 'ceramic-mug', 2);
  await page.goto('/cart');
  await expect(page.getByRole('heading', { level: 1, name: /your cart/i })).toBeVisible();
  await expect(page.getByText('Ceramic Mug').first()).toBeVisible();
  await expect(page.getByText(money(16)).first()).toBeVisible();
  await expect(qtyFor(page, 'Ceramic Mug')).toHaveValue('2');
  await expect(page.getByText(money(32)).first()).toBeVisible();
});

test('CART-3: changing a quantity updates totals and count; 0 removes the line', async ({ page }) => {
  await addToCart(page, 'ceramic-mug', 1);
  await addToCart(page, 'desk-lamp', 1);
  await page.goto('/cart');
  await setQuantity(qtyFor(page, 'Ceramic Mug'), 4);
  await expect(page.getByText(money(64)).first()).toBeVisible();
  await expect(summaryRow(page, 'Subtotal')).toContainText(money(106));
  await expect(cartLink(page)).toHaveAccessibleName(/\b5\b/);
  await setQuantity(qtyFor(page, 'Ceramic Mug'), 0);
  await expect(qtyFor(page, 'Ceramic Mug')).toHaveCount(0);
  await expect(summaryRow(page, 'Subtotal')).toContainText(money(42));
});

test('CART-4: "Remove <name>" removes the line', async ({ page }) => {
  await addToCart(page, 'ceramic-mug', 1);
  await addToCart(page, 'desk-lamp', 1);
  await page.goto('/cart');
  await page.getByRole('button', { name: /remove ceramic mug/i }).click();
  await expect(qtyFor(page, 'Ceramic Mug')).toHaveCount(0);
  await expect(qtyFor(page, 'Desk Lamp')).toBeVisible();
});

test('CART-5: subtotal, shipping $5.00 under $100 and free from $100, total', async ({ page }) => {
  await addToCart(page, 'ceramic-mug', 2);
  await page.goto('/cart');
  await expect(summaryRow(page, 'Subtotal')).toContainText(money(32));
  await expect(summaryRow(page, 'Shipping')).toContainText(money(5));
  await expect(summaryRow(page, 'Total')).toContainText(money(37));
  await setQuantity(qtyFor(page, 'Ceramic Mug'), 7);
  await expect(summaryRow(page, 'Subtotal')).toContainText(money(112));
  await expect(summaryRow(page, 'Shipping')).toContainText(money(0));
  await expect(summaryRow(page, 'Total')).toContainText(money(112));
});

test('CART-6: an empty cart says so and offers no checkout', async ({ page }) => {
  await page.goto('/cart');
  await expect(page.getByText(/your cart is empty/i)).toBeVisible();
  await expect(page.getByRole('link', { name: /^\s*checkout\s*$/i }).or(page.getByRole('button', { name: /^\s*checkout\s*$/i }))).toHaveCount(0);
});

test('CART-7: the cart is kept after a reload', async ({ page }) => {
  await addToCart(page, byName('Desk Lamp').id, 2);
  await page.goto('/cart');
  await page.reload();
  await expect(qtyFor(page, 'Desk Lamp')).toHaveValue('2');
});

test('CART-8: Checkout opens /checkout', async ({ page }) => {
  await addToCart(page, 'desk-lamp', 1);
  await page.goto('/cart');
  await page.getByRole('link', { name: /^\s*checkout\s*$/i }).or(page.getByRole('button', { name: /^\s*checkout\s*$/i })).first().click();
  await expect(page).toHaveURL(/\/checkout\/?$/);
});
