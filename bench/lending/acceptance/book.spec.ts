// Feature `book`: BK-1..BK-4 (SPEC.md).
import { test, expect } from '@playwright/test';
import { AVAILABLE, ON_LOAN, byId, fresh, addButton, expectCannotPick, esc } from './helpers';

test.beforeEach(async ({ page }) => { await fresh(page); });

test('BK-1: a book page shows its title, author, genre, year, page count and summary', async ({ page }) => {
  const b = byId('copper-roads');
  await page.goto(`/books/${b.id}`);
  await expect(page.getByRole('heading', { level: 1, name: new RegExp(`^\\s*${esc(b.title)}\\s*$`, 'i') })).toBeVisible();
  await expect(page.getByText(new RegExp(`by\\s+${esc(b.author)}`, 'i')).first()).toBeVisible();
  await expect(page.getByText(new RegExp(`\\b${b.genre}\\b`)).filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText(new RegExp(`\\b${b.year}\\b`)).filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText(new RegExp(`\\b${b.pages}\\s+pages\\b`, 'i')).first()).toBeVisible();
  await expect(page.getByText(b.summary).first()).toBeVisible();
});

test('BK-2: "Add to my picks" adds an available book and says "Added to your picks"', async ({ page }) => {
  const b = AVAILABLE[0];
  await page.goto(`/books/${b.id}`);
  await addButton(page).click();
  await expect(page.getByText(/added to your picks/i).first()).toBeVisible();
  await page.goto('/picks');
  await expect(page.getByText(b.title).first()).toBeVisible();
});

test('BK-3: a book on loan, or already picked, cannot be picked', async ({ page }) => {
  const loaned = ON_LOAN[0];
  await page.goto(`/books/${loaned.id}`);
  await expect(page.getByText(/\bon loan\b/i).filter({ visible: true }).first()).toBeVisible();
  await expectCannotPick(page);
  const b = AVAILABLE[1];
  await page.goto(`/books/${b.id}`);
  await addButton(page).click();
  await expect(page.getByText(/added to your picks/i).first()).toBeVisible();
  await page.reload();
  await expect(page.getByText(/already in your picks/i).first()).toBeVisible();
  await expectCannotPick(page);
});

test('BK-4: "Back to the catalogue" returns to /; an unknown id says "We could not find that book"', async ({ page }) => {
  await page.goto(`/books/${AVAILABLE[2].id}`);
  await page.getByRole('link', { name: /back to the catalogue/i }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto('/books/no-such-book');
  await expect(page.getByText(/we could not find that book/i).first()).toBeVisible();
  await page.getByRole('link', { name: /back to the catalogue/i }).click();
  await expect(page).toHaveURL(/\/$/);
});
