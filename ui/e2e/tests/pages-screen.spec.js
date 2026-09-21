import { test, expect } from '@playwright/test';
import { gotoCockpit } from './support/cockpit.js';
import { makeBrowseProject, openProject } from './support/browseProject.js';
import { runAxe, isBlocking, format } from './support/axe.js';

// #431 -- the Pages screen: the Browser lists every page of the open project (all features), choosing one loads it
// in the stage (the Pages editor's own preview) and the Browser then shows that page's node tree, whose nodes are
// selectable. Keyboard, filter, states, ?feature=&file= in the URL, and one pane at a time at 390px.
const API = process.env.E2E_API_BASE || 'http://localhost:4000';
const browser = (page) => page.getByRole('complementary', { name: 'Browser' });
const list = (page) => browser(page).getByRole('listbox', { name: 'Pages' });
const options = (page) => list(page).getByRole('option');
const treeNodes = (page) => browser(page).locator('.tree-node');

test.describe.serial('Pages screen: browse in the left pane, open in the stage (#431)', () => {
  let project;
  let restore;

  test.beforeAll(async ({ request }) => {
    project = makeBrowseProject('og431-pages-');
    restore = await openProject(request, API, project.repo);
  });
  test.afterAll(async () => {
    await restore?.();
    project?.remove();
  });

  test('the Browser lists every page of every feature, and the rail marks Pages', async ({ page }) => {
    await gotoCockpit(page, '/pages');
    await expect(page.getByRole('navigation', { name: 'Screens', exact: true }).getByRole('link', { name: 'Pages' })).toHaveAttribute('aria-current', 'page');
    await expect(options(page)).toHaveText([/^BillingPage\.tsx\s*billing/, /^CheckoutPage\.tsx\s*checkout/, /^ReportingPage\.tsx\s*reporting/]);
    await expect(page.getByTestId('pages-list-count')).toHaveText('3');
    await expect(page.getByText('Nothing open yet.')).toBeVisible();
  });

  test('choosing a page loads it in the stage, puts it in the URL, and the Browser shows its node tree with selectable nodes', async ({ page }) => {
    await gotoCockpit(page, '/pages');
    await options(page).filter({ hasText: 'BillingPage' }).click();
    await expect(page).toHaveURL(/\/pages\?feature=billing&file=BillingPage\.tsx$/);
    // The stage: the page's structural preview (the Pages editor's own) replaces "Nothing open yet".
    await expect(page.getByText('Nothing open yet.')).toHaveCount(0);
    await expect(page.locator('.pe-stage')).toContainText('BillingView');
    // The Browser now shows the tree instead of the list, with a way back.
    await expect(list(page)).toHaveCount(0);
    await expect(treeNodes(page).first()).toBeVisible();
    await expect(browser(page).getByTestId('pages-all')).toBeVisible();
    await treeNodes(page).first().click();
    await expect(treeNodes(page).first()).toHaveClass(/selected/);
    // The Inspector (Tools) follows the selection.
    await expect(page.getByRole('complementary', { name: 'Tools' }).getByRole('tab', { name: 'Inspector' })).toBeVisible();
  });

  test('a reload restores the page and its tree; All pages goes back to the list and clears the URL', async ({ page }) => {
    await gotoCockpit(page, '/pages?feature=checkout&file=CheckoutPage.tsx');
    await expect(treeNodes(page).first()).toBeVisible();
    await expect(page.locator('.pe-stage')).toContainText('CheckoutView');
    await page.reload();
    await expect(treeNodes(page).first()).toBeVisible();
    await expect(page).toHaveURL(/feature=checkout&file=CheckoutPage\.tsx/);
    await browser(page).getByTestId('pages-all').click();
    await expect(options(page)).toHaveCount(3);
    await expect(page).not.toHaveURL(/feature=|file=/);
  });

  test('a link to a page that does not exist shows the error in the stage, not a blank screen', async ({ page }) => {
    await gotoCockpit(page, '/pages?feature=billing&file=Nope.tsx');
    await expect(page.locator('.pe-stage .status-error')).toBeVisible();
  });

  test('the filter narrows the list; no match offers Clear the filter', async ({ page }) => {
    await gotoCockpit(page, '/pages');
    const filter = page.getByRole('searchbox', { name: 'Filter pages' });
    await filter.fill('report');
    await expect(options(page)).toHaveCount(1);
    await expect(page.getByTestId('pages-list-count')).toHaveText('1 of 3');
    await filter.fill('billing');
    await expect(options(page)).toHaveCount(1);
    await filter.fill('zzz');
    await expect(browser(page).getByTestId('state-empty')).toContainText('Nothing matches');
    await page.getByRole('button', { name: 'Clear the filter' }).click();
    await expect(options(page)).toHaveCount(3);
  });

  test('keyboard: Down from the filter, Up/Down/Home/End move, Enter opens the page', async ({ page }) => {
    await gotoCockpit(page, '/pages');
    await expect(list(page).locator('[tabindex="0"]')).toHaveCount(1);
    await page.getByRole('searchbox', { name: 'Filter pages' }).focus();
    await page.keyboard.press('ArrowDown');
    await expect(options(page).nth(0)).toBeFocused();
    await page.keyboard.press('End');
    await expect(options(page).nth(2)).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(options(page).nth(1)).toBeFocused();
    await page.keyboard.press('Home');
    await expect(options(page).nth(0)).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/feature=checkout&file=CheckoutPage\.tsx/);
    await expect(treeNodes(page).first()).toBeVisible();
  });

  test('choosing a feature in the select still narrows to that feature\'s own list (unchanged)', async ({ page }) => {
    await gotoCockpit(page, '/pages');
    await page.locator('.pages-browser select').selectOption('reporting');
    await expect(page.locator('.pages-browser')).toContainText('pages/ in "reporting"');
    await page.getByRole('button', { name: 'ReportingPage.tsx' }).click();
    await expect(page).toHaveURL(/feature=reporting&file=ReportingPage\.tsx/);
    await expect(treeNodes(page).first()).toBeVisible();
  });

  test('loading, error (Try again) and empty states of the list', async ({ page }) => {
    let mode = 'slow';
    await page.route('**/api/pages/all', async (route) => {
      if (mode === 'slow') {
        await new Promise((r) => setTimeout(r, 600));
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, count: 0, pages: [] }) });
      }
      if (mode === 'error') return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Boom.' }) });
      return route.continue();
    });
    await gotoCockpit(page, '/pages');
    await expect(browser(page).getByTestId('state-loading')).toBeVisible();
    await expect(browser(page).getByTestId('state-empty')).toContainText('This project has no pages yet');
    mode = 'error';
    await page.reload();
    await expect(browser(page).getByTestId('state-error')).toContainText('Boom.');
    mode = 'real';
    await browser(page).getByRole('button', { name: 'Try again' }).click();
    await expect(options(page)).toHaveCount(3);
  });

  test('at 390px one pane shows at a time: choosing a page brings the stage forward; the tree is in the Browser', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoCockpit(page, '/pages');
    const bar = page.getByRole('tablist', { name: 'Panes' });
    await bar.getByRole('tab', { name: 'Browser' }).click();
    await options(page).filter({ hasText: 'BillingPage' }).click();
    await expect(bar.getByRole('tab', { name: 'Stage' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.pe-stage')).toContainText('BillingView');
    await bar.getByRole('tab', { name: 'Browser' }).click();
    await expect(treeNodes(page).first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  for (const theme of ['dark', 'light']) {
    for (const [vp, size] of [['wide', { width: 1280, height: 800 }], ['narrow', { width: 390, height: 844 }]]) {
      test(`accessibility: ${theme} ${vp}, the list and then the loaded page with its tree`, async ({ page }) => {
        await page.addInitScript((t) => localStorage.setItem('construct.theme', t), theme);
        await page.setViewportSize(size);
        await gotoCockpit(page, '/pages');
        if (vp === 'narrow') await page.getByRole('tablist', { name: 'Panes' }).getByRole('tab', { name: 'Browser' }).click();
        await expect(list(page)).toBeVisible();
        const first = await runAxe(page);
        expect(first.filter(isBlocking), format(first.filter(isBlocking))).toEqual([]);
        await options(page).filter({ hasText: 'BillingPage' }).click();
        if (vp === 'narrow') await page.getByRole('tablist', { name: 'Panes' }).getByRole('tab', { name: 'Browser' }).click();
        await expect(treeNodes(page).first()).toBeVisible();
        const tree = await runAxe(page);
        expect(tree.filter(isBlocking), format(tree.filter(isBlocking))).toEqual([]);
        if (vp === 'narrow') await page.getByRole('tablist', { name: 'Panes' }).getByRole('tab', { name: 'Stage' }).click();
        const stage = await runAxe(page);
        expect(stage.filter(isBlocking), format(stage.filter(isBlocking))).toEqual([]);
      });
    }
  }
});
