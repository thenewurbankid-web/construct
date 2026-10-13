// Feature `picks`: PCK-1..PCK-6 (SPEC.md).
import { test, expect } from '@playwright/test';
import { AVAILABLE, fresh, pick, picksLink, addButton, labelled, inDays, esc } from './helpers';

test.beforeEach(async ({ page }) => { await fresh(page); });

test('PCK-1: every page shows "My picks (n)", which opens /picks', async ({ page }) => {
  await page.goto('/');
  await expect(picksLink(page)).toContainText('(0)');
  await pick(page, AVAILABLE[0].id);
  await pick(page, AVAILABLE[1].id);
  for (const url of ['/', `/books/${AVAILABLE[2].id}`, '/picks', '/loans']) {
    await page.goto(url);
    await expect(picksLink(page), `on ${url}`).toContainText('(2)');
  }
  await page.goto('/');
  await picksLink(page).click();
  await expect(page).toHaveURL(/\/picks\/?$/);
});

test('PCK-2: /picks lists each picked book with its author and a "Remove <title>" button', async ({ page }) => {
  const [a, b] = AVAILABLE;
  await pick(page, a.id);
  await pick(page, b.id);
  await page.goto('/picks');
  await expect(page.getByRole('heading', { level: 1, name: /^\s*my picks\s*$/i })).toBeVisible();
  for (const x of [a, b]) {
    await expect(page.getByText(x.title).filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByText(x.author).filter({ visible: true }).first()).toBeVisible();
  }
  await page.getByRole('button', { name: new RegExp(`^\\s*remove\\s+${esc(a.title)}\\s*$`, 'i') }).click();
  await expect(page.getByRole('button', { name: new RegExp(`remove\\s+${esc(a.title)}`, 'i') })).toHaveCount(0);
  await expect(page.getByRole('button', { name: new RegExp(`remove\\s+${esc(b.title)}`, 'i') })).toBeVisible();
});

test('PCK-3: with 4 picked, another pick says "You can pick up to 4 books" and adds nothing', async ({ page }) => {
  for (const b of AVAILABLE.slice(0, 4)) await pick(page, b.id);
  const fifth = AVAILABLE[4];
  await page.goto(`/books/${fifth.id}`);
  await addButton(page).click();
  await expect(page.getByText(/you can pick up to 4 books/i).first()).toBeVisible();
  await page.goto('/picks');
  await expect(page.getByRole('button', { name: /^\s*remove\b/i })).toHaveCount(4);
  await expect(page.getByRole('button', { name: new RegExp(`remove\\s+${esc(fifth.title)}`, 'i') })).toHaveCount(0);
});

test('PCK-4: loan length is 21 days for 1-2 books and 14 days for 3-4; return by is today plus that', async ({ page }) => {
  await pick(page, AVAILABLE[0].id);
  await page.goto('/picks');
  await expect(labelled(page, 'Loan length')).toContainText(/21\s+days/i);
  await expect(labelled(page, 'Return by')).toContainText(inDays(21));
  await pick(page, AVAILABLE[1].id);
  await page.goto('/picks');
  await expect(labelled(page, 'Loan length')).toContainText(/21\s+days/i);
  await pick(page, AVAILABLE[2].id);
  await page.goto('/picks');
  await expect(labelled(page, 'Loan length')).toContainText(/14\s+days/i);
  await expect(labelled(page, 'Return by')).toContainText(inDays(14));
  // Removing a book brings the longer loan back.
  await page.getByRole('button', { name: /^\s*remove\b/i }).first().click();
  await expect(labelled(page, 'Loan length')).toContainText(/21\s+days/i);
  await expect(labelled(page, 'Return by')).toContainText(inDays(21));
});

test('PCK-5: no picks says "You have not picked any books yet" and offers no request', async ({ page }) => {
  await page.goto('/picks');
  await expect(page.getByText(/you have not picked any books yet/i).first()).toBeVisible();
  await expect(page.getByRole('link', { name: /request these books/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /request these books/i })).toHaveCount(0);
});

test('PCK-6: picks are kept after a reload, and "Request these books" opens /request', async ({ page }) => {
  const b = AVAILABLE[3];
  await pick(page, b.id);
  await page.goto('/picks');
  await page.reload();
  await expect(page.getByText(b.title).filter({ visible: true }).first()).toBeVisible();
  await page.getByRole('link', { name: /request these books/i }).click();
  await expect(page).toHaveURL(/\/request\/?$/);
});
