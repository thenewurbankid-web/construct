// Shared helpers for the acceptance specs: roles and labels only, never test ids, so any reasonable build passes.
import { expect, type Locator, type Page } from '@playwright/test';
import products from '../fixtures/products.json';

export type Product = { id: string; name: string; category: string; price: number; description: string };
export const PRODUCTS = products as Product[];
export const CATEGORIES = ['Clothing', 'Home', 'Electronics'];
export const money = (n: number) => `$${n.toFixed(2)}`;
export const byName = (name: string) => PRODUCTS.find((p) => p.name === name) as Product;
export const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Start every test with an empty cart (the app keeps it in the browser). */
export async function fresh(page: Page) {
  await page.goto('/');
  await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* ignore */ } });
}

/** The product links on the catalog page (a product's name is a link to its page). */
export function productLink(page: Page, name: string): Locator {
  return page.getByRole('link', { name: new RegExp(`^\\s*${esc(name)}\\s*$`, 'i') });
}

/** Choose a category in the "Category" filter, whatever control the build used for it. */
export async function chooseCategory(page: Page, name: string) {
  const ctl = page.getByLabel(/^\s*category\s*$/i).first();
  if (await ctl.count()) {
    const tag = await ctl.evaluate((e) => e.tagName.toLowerCase());
    const role = await ctl.getAttribute('role');
    if (tag === 'select') { await ctl.selectOption({ label: name }); return; }
    if (role === 'combobox' || tag === 'button') {
      await ctl.click();
      await page.getByRole('option', { name, exact: true }).click();
      return;
    }
    const inGroup = ctl.getByRole('radio', { name, exact: true }).or(ctl.getByRole('tab', { name, exact: true })).or(ctl.getByRole('button', { name, exact: true }));
    if (await inGroup.count()) { await inGroup.first().click(); return; }
  }
  const group = page.getByRole('group', { name: /category/i }).or(page.getByRole('radiogroup', { name: /category/i })).or(page.getByRole('tablist', { name: /category/i }));
  const scope = (await group.count()) ? group.first() : page;
  await scope.getByRole('radio', { name, exact: true }).or(scope.getByRole('tab', { name, exact: true })).or(scope.getByRole('button', { name, exact: true })).first().click();
}

/** Expect exactly these products to be listed (by their links). */
export async function expectListed(page: Page, names: string[]) {
  for (const p of PRODUCTS) {
    if (names.includes(p.name)) await expect(productLink(page, p.name).first(), `${p.name} is listed`).toBeVisible();
    else await expect(productLink(page, p.name), `${p.name} is not listed`).toHaveCount(0);
  }
}

/** Set a quantity field, whatever input the build used. */
export async function setQuantity(field: Locator, n: number) {
  await field.fill(String(n));
  await field.press('Tab');
}

/** Put `qty` of a product in the cart through its page. */
export async function addToCart(page: Page, id: string, qty = 1) {
  await page.goto(`/products/${id}`);
  if (qty !== 1) await setQuantity(page.getByLabel(/^\s*quantity\s*$/i), qty);
  await page.getByRole('button', { name: /add to cart/i }).click();
  await expect(page.getByText(/added to cart/i).first()).toBeVisible();
}

/** The cart link in the header ("Cart (3)"). */
export function cartLink(page: Page): Locator {
  return page.getByRole('link', { name: /^\s*cart\b/i }).first();
}

/** The text of the row (or block) holding a cart summary label like "Subtotal", e.g. "Subtotal $96.00". */
export function summaryRow(page: Page, label: string): Locator {
  return page.getByText(new RegExp(`^\\s*${label}\\b`, 'i')).first().locator('xpath=..');
}

/** Fill the checkout form with valid values. */
export async function fillCheckout(page: Page) {
  await page.getByLabel(/^\s*full name\s*$/i).fill('Ada Lovelace');
  await page.getByLabel(/^\s*email\s*$/i).fill('ada@example.com');
  await page.getByLabel(/^\s*address\s*$/i).fill('12 Analytical Way');
  await page.getByLabel(/^\s*city\s*$/i).fill('London');
  await page.getByLabel(/^\s*postal code\s*$/i).fill('12345');
  await page.getByRole('checkbox', { name: /i accept the terms/i }).check();
}
