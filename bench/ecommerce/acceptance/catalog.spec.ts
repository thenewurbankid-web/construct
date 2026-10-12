import { test, expect } from '@playwright/test';
import { PRODUCTS, CATEGORIES, money, fresh, productLink, chooseCategory, expectListed } from './helpers';

test.beforeEach(async ({ page }) => { await fresh(page); });

test('CAT-1: / lists all 12 products with name, category and price', async ({ page }) => {
  await expect(page.getByRole('heading', { level: 1, name: /^\s*products\s*$/i })).toBeVisible();
  await expectListed(page, PRODUCTS.map((p) => p.name));
  for (const c of CATEGORIES) await expect(page.getByText(c, { exact: true }).first()).toBeVisible();
  for (const p of PRODUCTS) await expect(page.getByText(money(p.price)).first()).toBeVisible();
});

test('CAT-2: the Category filter shows one category, All shows every product again', async ({ page }) => {
  for (const c of CATEGORIES) {
    await chooseCategory(page, c);
    await expectListed(page, PRODUCTS.filter((p) => p.category === c).map((p) => p.name));
  }
  await chooseCategory(page, 'All');
  await expectListed(page, PRODUCTS.map((p) => p.name));
});

test('CAT-3: Search filters by name ignoring case and combines with the category', async ({ page }) => {
  const search = page.getByRole('searchbox', { name: /search/i }).or(page.getByLabel(/^\s*search\s*$/i)).first();
  await search.fill('mug');
  await expectListed(page, ['Ceramic Mug']);
  await search.fill('LINEN');
  await expectListed(page, ['Linen Shirt', 'Linen Throw']);
  await chooseCategory(page, 'Home');
  await expectListed(page, ['Linen Throw']);
});

test('CAT-4: no match says "No products found"', async ({ page }) => {
  await page.getByRole('searchbox', { name: /search/i }).or(page.getByLabel(/^\s*search\s*$/i)).first().fill('zzzz-nothing');
  await expect(page.getByText(/no products found/i)).toBeVisible();
  await expectListed(page, []);
});

test('CAT-5: a product name links to its page', async ({ page }) => {
  await productLink(page, 'Desk Lamp').first().click();
  await expect(page).toHaveURL(/\/products\/desk-lamp\/?$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Desk Lamp' })).toBeVisible();
});
