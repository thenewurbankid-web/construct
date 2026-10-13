// Shared helpers for the lending-library acceptance specs: roles, labels and visible text only, never test ids, so any
// reasonable build passes.
import { expect, type Locator, type Page } from '@playwright/test';
import books from '../fixtures/books.json';

export type Book = { id: string; title: string; author: string; genre: string; year: number; pages: number; summary: string; available: boolean };
export const BOOKS = books as Book[];
export const GENRES = ['Fiction', 'History', 'Science'];
export const PER_PAGE = 6;
export const BRANCHES = ['Central', 'Riverside', 'Hillview'];
export const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const byId = (id: string) => BOOKS.find((b) => b.id === id) as Book;
export const whole = (s: string) => new RegExp(`^\\s*${esc(s)}\\s*$`, 'i');

/** The books in a given order. */
export const byTitle = (list = BOOKS) => [...list].sort((a, b) => a.title.localeCompare(b.title));
export const newestFirst = (list = BOOKS) => [...list].sort((a, b) => b.year - a.year);
export const oldestFirst = (list = BOOKS) => [...list].sort((a, b) => a.year - b.year);
export const titles = (list: Book[]) => list.map((b) => b.title);
/** Available books (by the fixture), in title order: the ones a test can pick. */
export const AVAILABLE = byTitle(BOOKS.filter((b) => b.available));
export const ON_LOAN = BOOKS.filter((b) => !b.available);

/** A date `days` from today in local time, as YYYY-MM-DD. */
export function inDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Start every test with no picks and no loans (the app keeps them in the browser). */
export async function fresh(page: Page) {
  await page.goto('/');
  await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* ignore */ } });
}

/** The link to a book (its title). */
export function bookLink(page: Page, title: string): Locator {
  return page.getByRole('link', { name: whole(title) });
}

/** The titles linked on the page right now, in page order. */
export async function listedTitles(page: Page): Promise<string[]> {
  const all = new Set(BOOKS.map((b) => b.title.toLowerCase()));
  const names = await page.getByRole('link').allInnerTexts();
  return names.map((n) => n.trim()).filter((n) => all.has(n.toLowerCase()));
}

/** Expect exactly these titles, in this order, on the current page of the catalogue. */
export async function expectTitles(page: Page, expected: string[]) {
  await expect.poll(() => listedTitles(page), { message: `listed: ${expected.join(', ')}` }).toEqual(expected);
}

/** Pick an option in a labelled choice (native select, Radix select, radio group, tabs or buttons). */
export async function choose(page: Page, label: RegExp, option: string, scope: Page | Locator = page) {
  const ctl = scope.getByLabel(label).first();
  if (await ctl.count()) {
    const tag = await ctl.evaluate((e) => e.tagName.toLowerCase());
    const role = await ctl.getAttribute('role');
    if (tag === 'select') { await ctl.selectOption({ label: option }); return; }
    if (role === 'combobox' || tag === 'button') {
      await ctl.click();
      await page.getByRole('option', { name: option, exact: true }).click();
      return;
    }
    const inGroup = ctl.getByRole('radio', { name: option, exact: true }).or(ctl.getByRole('tab', { name: option, exact: true })).or(ctl.getByRole('button', { name: option, exact: true }));
    if (await inGroup.count()) { await inGroup.first().click(); return; }
  }
  const group = scope.getByRole('group', { name: label }).or(scope.getByRole('radiogroup', { name: label })).or(scope.getByRole('tablist', { name: label }));
  const where = (await group.count()) ? group.first() : scope;
  await where.getByRole('radio', { name: option, exact: true }).or(where.getByRole('tab', { name: option, exact: true })).or(where.getByRole('button', { name: option, exact: true })).first().click();
}

/** The "Add to my picks" button on a book page. */
export function addButton(page: Page): Locator {
  return page.getByRole('button', { name: /add to my picks/i });
}

/** Expect a book page to offer no way to pick the book (no button, or a disabled one). */
export async function expectCannotPick(page: Page) {
  const b = addButton(page);
  if (await b.count()) await expect(b.first()).toBeDisabled();
}

/** Pick a book through its page. */
export async function pick(page: Page, id: string) {
  await page.goto(`/books/${id}`);
  await addButton(page).click();
  await expect(page.getByText(/added to your picks/i).first()).toBeVisible();
}

/** The "My picks (n)" link in the app shell. */
export function picksLink(page: Page): Locator {
  return page.getByRole('link', { name: /^\s*my picks\b/i }).first();
}

/** The text block around a label like "Loan length", e.g. "Loan length 21 days". */
export function labelled(page: Page, label: string): Locator {
  return page.getByText(new RegExp(`^\\s*${esc(label)}\\b`, 'i')).first().locator('xpath=..');
}

/** Fill the request form with valid values. */
export async function fillRequest(page: Page, branch = 'Central') {
  await page.getByLabel(/^\s*name\s*$/i).fill('Grace Hopper');
  await page.getByLabel(/^\s*library card number\s*$/i).fill('LC204816');
  await page.getByLabel(/^\s*email\s*$/i).fill('grace@example.com');
  await choose(page, /^\s*pickup branch\s*$/i, branch);
}

/** Pick these books, send a valid request and return the loan number shown on /request/done. */
export async function borrow(page: Page, ids: string[], branch = 'Central'): Promise<string> {
  for (const id of ids) await pick(page, id);
  await page.goto('/request');
  await fillRequest(page, branch);
  await page.getByRole('button', { name: /send request/i }).click();
  await expect(page).toHaveURL(/\/request\/done\/?$/);
  const text = await page.getByText(/Loan #\s*[A-Za-z0-9-]+/).first().innerText();
  return (/Loan #\s*([A-Za-z0-9-]+)/.exec(text) as RegExpExecArray)[1];
}
