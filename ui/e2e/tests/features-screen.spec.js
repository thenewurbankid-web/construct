import { test, expect } from '@playwright/test';
import { gotoCockpit } from './support/cockpit.js';
import { makeBrowseProject, openProject, SUMMARY_PATH } from './support/browseProject.js';
import { runAxe, isBlocking, format } from './support/axe.js';

// #431 -- the Features screen: the Browser lists every feature of the open project; choosing one shows its details in
// the stage (summary, routes, layers and files, workflows, tests). The list is a keyboard-operable listbox with a filter,
// the selection lives in the URL (?feature=), and there is one pane at a time at 390px.
const API = process.env.E2E_API_BASE || 'http://localhost:4000';
const browser = (page) => page.getByRole('complementary', { name: 'Browser' });
const list = (page) => browser(page).getByRole('listbox', { name: 'Features' });
const options = (page) => list(page).getByRole('option');

test.describe.serial('Features screen: browse in the left pane, open in the stage (#431)', () => {
  let project;
  let restore;

  test.beforeAll(async () => {
    project = makeBrowseProject('og431-features-');
    restore = await openProject(API, project.repo);
  });
  test.afterAll(async () => {
    await restore?.();
    project?.remove();
  });

  test('the Browser lists every feature; nothing is open until one is chosen; the rail marks Features', async ({ page }) => {
    await gotoCockpit(page, '/');
    await expect(page.getByRole('navigation', { name: 'Screens', exact: true }).getByRole('link', { name: 'Features' })).toHaveAttribute('aria-current', 'page');
    await expect(browser(page).getByRole('tab', { name: 'Features' })).toHaveAttribute('aria-selected', 'true');
    await expect(options(page)).toHaveText([/^billing/, /^checkout/, /^reporting/, /^shared/]);
    await expect(page.getByTestId('features-list-count')).toHaveText('4');
    await expect(page.getByTestId('fc-details')).toHaveCount(0);
    await expect(options(page).first()).toHaveAttribute('aria-selected', 'false');
  });

  test('clicking a feature loads its details in the stage and puts it in the URL; a reload restores it', async ({ page }) => {
    await gotoCockpit(page, '/');
    await options(page).filter({ hasText: 'billing' }).click();
    await expect(page).toHaveURL(/\/\?feature=billing$/);
    const details = page.getByTestId('fc-details');
    await expect(details.getByTestId('fc-name')).toHaveText('billing');
    await expect(options(page).filter({ hasText: 'billing' })).toHaveAttribute('aria-selected', 'true');
    // Routes under it, layers and files (with links to the screens that can open them), workflows, tests.
    await expect(details.getByTestId('fc-routes')).toContainText('/billing');
    await expect(details.getByTestId('fc-routes')).toContainText('app/billing/page.tsx');
    const layers = details.getByTestId('fc-layer');
    await expect(layers.locator('h4')).toHaveText([/^page/, /^controller/, /^component/, /^hook/, /^workflow/, /^service/, /^domain/]);
    await expect(details.getByRole('link', { name: SUMMARY_PATH })).toHaveAttribute('href', new RegExp(`^/components\\?component=${encodeURIComponent(SUMMARY_PATH).replace(/\./g, '\\.')}$`));
    await expect(details.getByRole('link', { name: 'features/billing/pages/BillingPage.tsx' })).toHaveAttribute('href', '/pages?feature=billing&file=BillingPage.tsx');
    await expect(details.getByTestId('fc-workflows')).toContainText('signupFlow');
    await expect(details.getByTestId('fc-tests')).toContainText('1 test file');
    await expect(details.getByTestId('fc-open-tests')).toHaveAttribute('href', '/tests');
    await expect(details.getByTestId('fc-open-workflows')).toHaveAttribute('href', '/workflows');
    await expect(details.getByTestId('fc-rules')).toContainText('0 errors');

    await page.reload();
    await expect(page.getByTestId('fc-details').getByTestId('fc-name')).toHaveText('billing');
    await expect(options(page).filter({ hasText: 'billing' })).toHaveAttribute('aria-selected', 'true');
  });

  test('a feature without workflows or tests says so; the stage actions and the impact report are still there', async ({ page }) => {
    await gotoCockpit(page, '/?feature=checkout');
    const details = page.getByTestId('fc-details');
    await expect(details.getByTestId('fc-name')).toHaveText('checkout');
    await expect(details.getByTestId('fc-no-workflows')).toBeVisible();
    await expect(details.getByTestId('fc-tests')).toContainText('No tests yet');
    await expect(page.getByTestId('stage-actions')).toBeVisible();
  });

  test('a file link in the details opens that component on the Components screen', async ({ page }) => {
    await gotoCockpit(page, '/?feature=billing');
    await page.getByTestId('fc-details').getByRole('link', { name: SUMMARY_PATH }).click();
    await expect(page).toHaveURL(new RegExp(`/components\\?component=`));
    await expect(page.getByTestId('cd-name')).toHaveText('BillingSummary');
  });

  test('the filter narrows the list; no match says so with one next action, Clear the filter', async ({ page }) => {
    await gotoCockpit(page, '/');
    const filter = page.getByRole('searchbox', { name: 'Filter features' });
    await filter.fill('chec');
    await expect(options(page)).toHaveCount(1);
    await expect(page.getByTestId('features-list-count')).toHaveText('1 of 4');
    await filter.fill('zzz');
    await expect(page.getByTestId('state-empty')).toContainText('Nothing matches');
    await page.getByRole('button', { name: 'Clear the filter' }).click();
    await expect(options(page)).toHaveCount(4);
    await expect(filter).toBeFocused();
  });

  test('keyboard: one tab stop; Down from the filter, Up/Down/Home/End move, Enter selects', async ({ page }) => {
    await gotoCockpit(page, '/');
    await expect(list(page).locator('[tabindex="0"]')).toHaveCount(1);
    await page.getByRole('searchbox', { name: 'Filter features' }).focus();
    await page.keyboard.press('ArrowDown');
    await expect(options(page).nth(0)).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(options(page).nth(1)).toBeFocused();
    await page.keyboard.press('End');
    await expect(options(page).nth(3)).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(options(page).nth(3)).toBeFocused();
    await page.keyboard.press('Home');
    await expect(options(page).nth(0)).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(options(page).nth(0)).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\?feature=checkout$/);
    await expect(page.getByTestId('fc-name')).toHaveText('checkout');
    await expect(options(page).nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(options(page).nth(1)).toHaveAttribute('tabindex', '0');
  });

  test('a link to a feature that does not exist selects nothing and says so', async ({ page }) => {
    await gotoCockpit(page, '/?feature=nope');
    await expect(page.getByTestId('state-empty')).toContainText('“nope” is not a feature of this project');
    await expect(page.getByTestId('fc-details')).toHaveCount(0);
    await page.getByRole('button', { name: 'Choose another in the Browser' }).click();
    await expect(page).not.toHaveURL(/feature=/);
  });

  test('loading, error (Try again) and empty (Create a feature) states of the list', async ({ page }) => {
    let mode = 'slow';
    await page.route('**/api/features', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      if (mode === 'slow') {
        await new Promise((r) => setTimeout(r, 600));
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, features: [] }) });
      }
      if (mode === 'error') return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { message: 'Boom.' } }) });
      return route.continue();
    });
    await gotoCockpit(page, '/');
    await expect(browser(page).getByTestId('state-loading')).toBeVisible();
    await expect(browser(page).getByTestId('state-empty')).toContainText('This project has no features yet');
    await browser(page).getByRole('button', { name: 'Create a feature' }).click();
    await expect(page.getByTestId('stage-action-panel')).toBeVisible();

    mode = 'error';
    await page.reload();
    await expect(browser(page).getByTestId('state-error')).toContainText('Boom.');
    mode = 'real';
    await browser(page).getByRole('button', { name: 'Try again' }).click();
    await expect(options(page)).toHaveCount(4);
  });

  test('at 390px one pane shows at a time: choosing a feature in the Browser brings its details forward', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoCockpit(page, '/');
    const bar = page.getByRole('tablist', { name: 'Panes' });
    await bar.getByRole('tab', { name: 'Browser' }).click();
    await expect(list(page)).toBeVisible();
    await expect(page.getByRole('main')).toHaveCount(0);
    await options(page).filter({ hasText: 'billing' }).click();
    await expect(bar.getByRole('tab', { name: 'Stage' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('fc-name')).toHaveText('billing');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  for (const theme of ['dark', 'light']) {
    for (const [vp, size] of [['wide', { width: 1280, height: 800 }], ['narrow', { width: 390, height: 844 }]]) {
      test(`accessibility: ${theme} ${vp}, feature open and the list showing`, async ({ page }) => {
        await page.addInitScript((t) => localStorage.setItem('construct.theme', t), theme);
        await page.setViewportSize(size);
        await gotoCockpit(page, '/?feature=billing');
        await expect(page.getByTestId('fc-name')).toHaveText('billing');
        const stage = await runAxe(page);
        expect(stage.filter(isBlocking), format(stage.filter(isBlocking))).toEqual([]);
        if (vp === 'narrow') await page.getByRole('tablist', { name: 'Panes' }).getByRole('tab', { name: 'Browser' }).click();
        await expect(list(page)).toBeVisible();
        const browse = await runAxe(page);
        expect(browse.filter(isBlocking), format(browse.filter(isBlocking))).toEqual([]);
      });
    }
  }
});
