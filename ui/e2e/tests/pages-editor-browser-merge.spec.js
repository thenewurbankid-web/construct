import { test, expect } from '@playwright/test';
import { gotoCockpit } from './support/cockpit.js';
import { makeBrowseProject, openProject } from './support/browseProject.js';

const API = process.env.E2E_API_BASE || 'http://localhost:4000';

// #537 (design: #536, docs/design/browser-panel-merge.md) — the Browser pane's Files-view content
// (PagesBrowser + TreePanel/ListBrowser) is now one GlassPanel (`.pe-browser-group`) with two
// native <details>/<summary> sections, the same idiom PalettePanel.tsx's `.pal-group` (#527)
// already ships. `.pages-browser`/`.tree-panel` keep their exact pre-existing class names and
// testids (`pages-all`, `pages-list`/`pages-list-count`) — every other pages-editor spec locates
// the two panels by them, now on <details> elements instead of their own GlassPanel card.
const browser = (page) => page.getByRole('complementary', { name: 'Browser' });
const filesDetails = (page) => browser(page).locator('.pages-browser');
const filesSummary = (page) => filesDetails(page).locator('> summary');
const treeDetails = (page) => browser(page).locator('.tree-panel');
const treeSummary = (page) => treeDetails(page).locator('> summary');

test.describe.serial('Pages editor Browser pane: merged group, independent collapse, keyboard, states (#537)', () => {
  let project;
  let restore;

  test.beforeAll(async () => {
    project = makeBrowseProject('og537-browser-merge-');
    restore = await openProject(API, project.repo);
  });
  test.afterAll(async () => {
    await restore?.();
    project?.remove();
  });

  test('one shared GlassPanel holds both sections, each its own open <details>', async ({ page }) => {
    await gotoCockpit(page, '/pages');
    // One outer glass card wraps both <details> — not two separate floating panels.
    const group = page.locator('.pe-browser-group');
    await expect(group).toBeVisible();
    await expect(group).toHaveClass(/glass-panel/);
    await expect(group.locator('.pages-browser')).toHaveCount(1);
    await expect(group.locator('.tree-panel')).toHaveCount(1);
    // Both default open, same as .pal-group's shipped default.
    await expect(filesDetails(page)).toHaveJSProperty('open', true);
    await expect(treeDetails(page)).toHaveJSProperty('open', true);
    await expect(filesSummary(page)).toContainText('Files');
  });

  test('state 1: no feature chosen — second section is "All pages" (the all-pages ListBrowser)', async ({ page }) => {
    await gotoCockpit(page, '/pages');
    await expect(treeSummary(page)).toHaveText('All pages 3');
    const list = treeDetails(page).getByTestId('pages-list');
    await expect(list).toBeVisible();
    await expect(treeDetails(page).getByTestId('pages-list-count')).toHaveText('3');
    await expect(list.getByRole('option')).toHaveCount(3);
  });

  test('state 2: feature chosen, no page open yet — the new empty state ("Open a page above...")', async ({ page }) => {
    await gotoCockpit(page, '/pages');
    await filesDetails(page).locator('select').selectOption('billing');
    await expect(treeSummary(page)).toHaveText('JSX tree');
    await expect(treeDetails(page)).toContainText('Open a page above to see its structure.');
    await expect(treeDetails(page).getByTestId('pages-list')).toHaveCount(0);
  });

  test('state 3: page open — second section is the real JSX tree; "All pages" moved inside Files', async ({ page }) => {
    await gotoCockpit(page, '/pages');
    await filesDetails(page).locator('select').selectOption('billing');
    await filesDetails(page).getByRole('button', { name: 'BillingPage.tsx' }).click();
    await expect(treeSummary(page)).toHaveText('JSX tree');
    await expect(treeDetails(page).locator('.tree-node').first()).toBeVisible();
    // "All pages" now lives inside the Files <details>, right after the file list.
    const allPagesBtn = filesDetails(page).getByTestId('pages-all');
    await expect(allPagesBtn).toBeVisible();
    await allPagesBtn.click();
    await expect(treeSummary(page)).toHaveText('All pages 3');
  });

  test('independent collapse: closing one section leaves the other\'s open state untouched', async ({ page }) => {
    await gotoCockpit(page, '/pages');
    await filesDetails(page).locator('select').selectOption('billing');
    await filesDetails(page).getByRole('button', { name: 'BillingPage.tsx' }).click();
    await expect(treeDetails(page).locator('.tree-node').first()).toBeVisible();

    // Collapse Files only — the tree section (already open) is untouched.
    await filesSummary(page).click();
    await expect(filesDetails(page)).toHaveJSProperty('open', false);
    await expect(treeDetails(page)).toHaveJSProperty('open', true);
    await expect(treeDetails(page).locator('.tree-node').first()).toBeVisible();
    await expect(filesDetails(page).locator('select')).toBeHidden();

    // Now collapse the tree section too — both closed independently.
    await treeSummary(page).click();
    await expect(treeDetails(page)).toHaveJSProperty('open', false);
    await expect(filesDetails(page)).toHaveJSProperty('open', false);

    // Reopen Files only — the tree section stays exactly as it was left (closed).
    await filesSummary(page).click();
    await expect(filesDetails(page)).toHaveJSProperty('open', true);
    await expect(treeDetails(page)).toHaveJSProperty('open', false);
    await expect(filesDetails(page).locator('select')).toBeVisible();
  });

  test('keyboard: Tab reaches each <summary>, Enter/Space toggles it, the Feature select and "All pages" stay reachable', async ({ page }) => {
    await gotoCockpit(page, '/pages');
    await filesDetails(page).locator('select').selectOption('billing');
    await filesDetails(page).getByRole('button', { name: 'BillingPage.tsx' }).click();
    await expect(treeDetails(page).locator('.tree-node').first()).toBeVisible();

    // Tab order: the Files|Flow switch, then this group's two <summary> elements (real, native
    // tab stops — no bespoke JS needed).
    await browser(page).getByRole('radio', { name: 'Flow' }).focus();
    await page.keyboard.press('Tab');
    await expect(filesSummary(page)).toBeFocused();

    // Enter toggles the focused <summary>'s section closed.
    await page.keyboard.press('Enter');
    await expect(filesDetails(page)).toHaveJSProperty('open', false);

    // With Files now collapsed (its content out of the tab order), the very next Tab stop is the
    // tree section's own <summary> — still reachable.
    await page.keyboard.press('Tab');
    await expect(treeSummary(page)).toBeFocused();

    // Space toggles it closed too.
    await page.keyboard.press(' ');
    await expect(treeDetails(page)).toHaveJSProperty('open', false);

    // Reopen Files via the keyboard and confirm the Feature select and "All pages" are still
    // real, reachable tab stops inside it.
    await filesSummary(page).focus();
    await page.keyboard.press('Enter');
    await expect(filesDetails(page)).toHaveJSProperty('open', true);
    await page.keyboard.press('Tab');
    await expect(filesDetails(page).locator('select')).toBeFocused();
  });
});
