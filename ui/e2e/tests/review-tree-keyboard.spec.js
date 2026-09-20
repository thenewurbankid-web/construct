import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gotoCockpit } from './support/cockpit.js';
import { makeReviewRepo } from './support/reviewRepo.js';
import { runAxe, isBlocking, format } from './support/axe.js';

// #351 -- the changed-units tree of Review mode is a real ARIA tree, driven by the keyboard ALONE:
// one tab stop, Up/Down, Left/Right (fold and unfold, parent and first child), Home/End, Enter selects.
// The change under review is a real branch of a real git repository, analysed by the real engine.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(__dirname, '../screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const API = process.env.E2E_API_BASE || 'http://localhost:4000';

test.describe.serial('Review: the changed-units tree by keyboard (#351)', () => {
  let ctx;
  let originalDir;

  test.beforeAll(async ({ request }) => {
    originalDir = (await (await request.get(`${API}/api/settings`)).json()).projectDir;
    ctx = makeReviewRepo('og351-tree-');
    await request.post(`${API}/api/settings`, { data: { projectDir: ctx.repo } });
  });

  test.afterAll(async ({ request }) => {
    if (originalDir) await request.post(`${API}/api/settings`, { data: { projectDir: originalDir } });
    fs.rmSync(ctx.repo, { recursive: true, force: true });
  });

  const focused = (page) => page.evaluate(() => {
    const e = document.activeElement;
    return e ? { id: e.getAttribute('data-node-id'), role: e.getAttribute('role'), text: (e.querySelector('.rv-node-row') ?? e).textContent.trim() } : null;
  });
  const items = (page) => page.getByRole('tree').getByRole('treeitem');

  test('the tree is a tree: roles, levels, expanded and selected state, and exactly one tab stop', async ({ page }) => {
    await gotoCockpit(page, '/review?base=main&head=feat%2Fbilling-totals');
    await expect(page.getByTestId('review-headline')).toBeVisible({ timeout: 90_000 });
    const tree = page.getByRole('tree', { name: 'Changed units by feature' });
    await expect(tree).toBeVisible();
    // Features are level 1 and open, layers level 2, files level 3.
    const billing = tree.locator('[data-testid="review-feature"][data-feature="billing"]');
    await expect(billing).toHaveAttribute('role', 'treeitem');
    await expect(billing).toHaveAttribute('aria-level', '1');
    await expect(billing).toHaveAttribute('aria-expanded', 'true');
    await expect(billing.locator('[data-testid="review-layer"]').first()).toHaveAttribute('aria-level', '2');
    await expect(billing.locator('[data-testid="review-file"]').first()).toHaveAttribute('aria-level', '3');
    await expect(billing.locator('[data-testid="review-file"]').first()).toHaveAttribute('aria-selected', 'false');
    await expect(tree.locator('[role="group"]').first()).toBeAttached();
    // ONE tab stop for the whole tree: a roving tabindex.
    await expect(tree.locator('[role="treeitem"][tabindex="0"]')).toHaveCount(1);
    expect(await tree.locator('[role="treeitem"][tabindex="-1"]').count()).toBeGreaterThan(3);
  });

  test('keyboard only: Tab into the tree, Up/Down, Right/Left, Home/End, Enter, then Tab out', async ({ page }) => {
    const before = ctx.snapshot();
    await gotoCockpit(page, '/review?base=main&head=feat%2Fbilling-totals');
    await expect(page.getByTestId('review-headline')).toBeVisible({ timeout: 90_000 });
    const tree = page.getByRole('tree', { name: 'Changed units by feature' });

    // Tab from the grouping buttons lands on the tree's single tab stop, with a visible focus ring.
    await page.getByTestId('review-group-files').focus(); // the last control before the tree
    await page.keyboard.press('Tab');
    const first = tree.locator('[role="treeitem"]').first();
    await expect(first).toBeFocused();
    expect((await focused(page)).text).toMatch(/billing/);
    const ring = await first.locator(':scope > .rv-node-row').evaluate((el) => { const s = getComputedStyle(el); return { style: s.outlineStyle, width: s.outlineWidth }; });
    expect(ring.style).toBe('solid');
    expect(ring.width).toBe('2px');
    await page.screenshot({ path: path.join(SHOTS, '351-tree-focus.png') });

    // Right on an OPEN parent moves to its first child; Right again (child is a parent) moves on down.
    await page.keyboard.press('ArrowRight');
    expect((await focused(page)).text).toMatch(/Domain|domain/);
    await page.keyboard.press('ArrowRight');
    await expect(page.locator(':focus')).toHaveAttribute('data-testid', 'review-file');
    const firstFile = (await focused(page)).text;
    // Down / Up move between rows.
    await page.keyboard.press('ArrowDown');
    expect((await focused(page)).text).not.toBe(firstFile);
    await page.keyboard.press('ArrowUp');
    expect((await focused(page)).text).toBe(firstFile);
    // Left on a file goes to its parent layer; Left on the open layer folds it; Left again goes to the feature.
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator(':focus')).toHaveAttribute('data-testid', 'review-layer');
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator(':focus')).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator(':focus').locator('[data-testid="review-file"]')).toHaveCount(0);
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator(':focus')).toHaveAttribute('data-testid', 'review-feature');
    // Left on an open feature folds the whole feature; Right unfolds it again.
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator(':focus')).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator(':focus').locator('[role="treeitem"]')).toHaveCount(0);
    await page.screenshot({ path: path.join(SHOTS, '351-tree-folded.png') });
    await page.keyboard.press('ArrowRight');
    await expect(page.locator(':focus')).toHaveAttribute('aria-expanded', 'true');

    // Home and End reach the first and last VISIBLE rows.
    await page.keyboard.press('End');
    const last = await focused(page);
    expect(last.text).toMatch(/README|Outside|\.md|\.ts/);
    await page.keyboard.press('Home');
    expect((await focused(page)).text).toMatch(/billing/);
    const rows = await items(page).count();
    expect(rows).toBeGreaterThan(5);

    // Down to a file and Enter selects it: aria-selected, and the unit list on the stage follows.
    await page.keyboard.press('ArrowDown'); // the layer folded earlier
    await expect(page.locator(':focus')).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('ArrowRight'); // unfold it
    await page.keyboard.press('ArrowDown'); // its first file
    await expect(page.locator(':focus')).toHaveAttribute('data-testid', 'review-file');
    const name = (await focused(page)).text;
    await page.keyboard.press('Enter');
    await expect(page.locator(':focus')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('review-unit').filter({ hasText: name.replace(/\s.*$/, '') }).first()).toHaveAttribute('aria-current', 'true');
    await expect(tree.locator('[aria-selected="true"]')).toHaveCount(1);
    await page.screenshot({ path: path.join(SHOTS, '351-tree-selected.png') });

    // One tab stop: Tab leaves the tree (it never walks every row), Shift+Tab comes back to the SAME row.
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('[role="tree"]'))).toBe(false);
    await page.keyboard.press('Shift+Tab');
    expect((await focused(page)).text).toBe(name);
    expect(ctx.snapshot(), 'navigating the tree never touches the repository').toEqual(before);
  });

  test('the other groupings are trees too, and the tree passes axe (both states)', async ({ page }) => {
    await gotoCockpit(page, '/review?base=main&head=feat%2Fbilling-totals');
    await expect(page.getByTestId('review-headline')).toBeVisible({ timeout: 90_000 });
    let found = await runAxe(page);
    expect(found.filter(isBlocking), format(found.filter(isBlocking))).toEqual([]);
    await page.getByTestId('review-group-layer').click();
    const byLayer = page.getByRole('tree', { name: 'Changed units by layer' });
    await expect(byLayer.getByRole('treeitem').first()).toHaveAttribute('aria-expanded', 'true');
    await byLayer.getByRole('treeitem').first().focus();
    await page.keyboard.press('ArrowLeft');
    await expect(byLayer.getByRole('treeitem').first()).toHaveAttribute('aria-expanded', 'false');
    found = await runAxe(page);
    expect(found.filter(isBlocking), format(found.filter(isBlocking))).toEqual([]);
    await page.getByTestId('review-group-files').click();
    const flat = page.getByRole('tree', { name: 'Changed files' });
    await expect(flat.getByRole('treeitem')).toHaveCount(5);
    await flat.getByRole('treeitem').first().focus();
    await page.keyboard.press('End');
    await expect(flat.getByRole('treeitem').last()).toBeFocused();
    await page.keyboard.press('ArrowLeft'); // a flat list has no parents: nothing to do, focus stays
    await expect(flat.getByRole('treeitem').last()).toBeFocused();
    found = await runAxe(page);
    expect(found.filter(isBlocking), format(found.filter(isBlocking))).toEqual([]);
  });

  test('the branch list keeps its arrow keys and Home/End', async ({ page }) => {
    await gotoCockpit(page, '/review');
    await expect(page.getByTestId('review-analysing')).toHaveCount(0, { timeout: 90_000 });
    const rows = page.getByTestId('review-row');
    await expect(rows).toHaveCount(2);
    await rows.first().focus();
    await page.keyboard.press('ArrowDown');
    await expect(rows.nth(1)).toBeFocused();
    await page.keyboard.press('Home');
    await expect(rows.first()).toBeFocused();
    await page.keyboard.press('End');
    await expect(rows.nth(1)).toBeFocused();
  });
});
