// Feature `browse`: BRW-1..BRW-5 (SPEC.md).
import { test, expect } from '@playwright/test';
import { BOOKS, PER_PAGE, byTitle, newestFirst, oldestFirst, titles, fresh, bookLink, expectTitles, choose } from './helpers';

const SORT = /^\s*sort by\s*$/i;
const GENRE = /^\s*genre\s*$/i;
const FIND = /^\s*find a book\s*$/i;
const next = (page: import('@playwright/test').Page) => page.getByRole('button', { name: /^\s*next page\s*$/i });
const prev = (page: import('@playwright/test').Page) => page.getByRole('button', { name: /^\s*previous page\s*$/i });

test.beforeEach(async ({ page }) => { await fresh(page); await page.goto('/'); });

test('BRW-1: the catalogue shows six books a page with author, genre, year and availability, titles link to the book', async ({ page }) => {
  await expect(page.getByRole('heading', { level: 1, name: /^\s*library catalogue\s*$/i })).toBeVisible();
  const first = byTitle().slice(0, PER_PAGE);
  await expectTitles(page, titles(first));
  for (const b of first) {
    await expect(page.getByText(b.author).filter({ visible: true }).first(), `${b.title}'s author`).toBeVisible();
    await expect(page.getByText(new RegExp(`\\b${b.year}\\b`)).filter({ visible: true }).first(), `${b.title}'s year`).toBeVisible();
    await expect(page.getByText(new RegExp(`\\b${b.genre}\\b`)).filter({ visible: true }).first(), `${b.title}'s genre`).toBeVisible();
  }
  // Every book on the first page is available by the fixture; the last page holds one on loan.
  const shown = (re: RegExp) => page.getByText(re).filter({ visible: true }).count();
  await expect.poll(() => shown(/\bavailable\b/i), { message: 'each book on page 1 says Available' }).toBeGreaterThanOrEqual(PER_PAGE);
  await expect.poll(() => shown(/\bon loan\b/i), { message: 'no book on page 1 is on loan' }).toBe(0);
  await next(page).click();
  await next(page).click();
  const onLoan = byTitle().slice(2 * PER_PAGE).filter((b) => !b.available);
  expect(onLoan.length).toBeGreaterThan(0);
  await expect.poll(() => shown(/\bon loan\b/i), { message: 'the books on loan say so' }).toBeGreaterThanOrEqual(onLoan.length);
  await prev(page).click();
  await prev(page).click();
  await bookLink(page, first[0].title).first().click();
  await expect(page).toHaveURL(new RegExp(`/books/${first[0].id}/?$`));
});

test('BRW-2: "Page n of 3" with Previous page and Next page buttons, disabled at the ends', async ({ page }) => {
  const sorted = byTitle();
  const pages = Math.ceil(BOOKS.length / PER_PAGE);
  await expect(page.getByText(new RegExp(`page\\s+1\\s+of\\s+${pages}`, 'i')).first()).toBeVisible();
  await expect(prev(page)).toBeDisabled();
  await expect(next(page)).toBeEnabled();
  await next(page).click();
  await expect(page.getByText(new RegExp(`page\\s+2\\s+of\\s+${pages}`, 'i')).first()).toBeVisible();
  await expectTitles(page, titles(sorted.slice(PER_PAGE, 2 * PER_PAGE)));
  await expect(prev(page)).toBeEnabled();
  await next(page).click();
  await expect(page.getByText(new RegExp(`page\\s+3\\s+of\\s+${pages}`, 'i')).first()).toBeVisible();
  await expectTitles(page, titles(sorted.slice(2 * PER_PAGE)));
  await expect(next(page)).toBeDisabled();
  await prev(page).click();
  await expect(page.getByText(new RegExp(`page\\s+2\\s+of\\s+${pages}`, 'i')).first()).toBeVisible();
});

test('BRW-3: Sort by orders the books by title (default), newest first or oldest first', async ({ page }) => {
  await expectTitles(page, titles(byTitle().slice(0, PER_PAGE)));
  await choose(page, SORT, 'Newest first');
  await expectTitles(page, titles(newestFirst().slice(0, PER_PAGE)));
  await choose(page, SORT, 'Oldest first');
  await expectTitles(page, titles(oldestFirst().slice(0, PER_PAGE)));
  await next(page).click();
  await expectTitles(page, titles(oldestFirst().slice(PER_PAGE, 2 * PER_PAGE)));
  await choose(page, SORT, 'Title A-Z');
  await expectTitles(page, titles(byTitle().slice(0, PER_PAGE)));
});

test('BRW-4: the Genre choice keeps one genre and goes back to the first page; All genres shows every book', async ({ page }) => {
  await next(page).click();
  await expect(page.getByText(/page\s+2\s+of/i).first()).toBeVisible();
  await choose(page, GENRE, 'History');
  await expectTitles(page, titles(byTitle(BOOKS.filter((b) => b.genre === 'History'))));
  await expect(page.getByText(/page\s+2\s+of/i)).toHaveCount(0);
  await choose(page, GENRE, 'Science');
  await expectTitles(page, titles(byTitle(BOOKS.filter((b) => b.genre === 'Science'))));
  await choose(page, GENRE, 'All genres');
  await expectTitles(page, titles(byTitle().slice(0, PER_PAGE)));
  await expect(page.getByText(new RegExp(`page\\s+1\\s+of\\s+${Math.ceil(BOOKS.length / PER_PAGE)}`, 'i')).first()).toBeVisible();
});

test('BRW-5: Find a book matches title or author, ignoring case, with the genre; nothing left says so', async ({ page }) => {
  const box = page.getByLabel(FIND);
  // By author, in two genres: Mara Quill wrote Glass Harbour (Fiction) and Copper Roads (History).
  await box.fill('QUILL');
  const quill = byTitle(BOOKS.filter((b) => /quill/i.test(b.author)));
  expect(quill.length).toBe(2);
  await expectTitles(page, titles(quill));
  await choose(page, GENRE, 'History');
  await expectTitles(page, titles(quill.filter((b) => b.genre === 'History')));
  await choose(page, GENRE, 'All genres');
  // By title.
  await box.fill('harbour');
  await expectTitles(page, ['Glass Harbour']);
  await box.fill('zzzz');
  await expect(page.getByText(/no books match your search/i).first()).toBeVisible();
  await expectTitles(page, []);
  await box.fill('');
  await expectTitles(page, titles(byTitle().slice(0, PER_PAGE)));
});
