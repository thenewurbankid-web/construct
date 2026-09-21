import { test, expect } from '@playwright/test';
import { runAxe, isBlocking, format } from './support/axe.js';
import { gotoCockpit, setTheme } from './support/cockpit.js';

// #429 -- the five screens live in a left rail (IDE-style activity bar) instead of the top bar. Default config:
// the harness preloads a project, so the full shell is showing.
const nav = (page) => page.getByRole('navigation', { name: 'Screens', exact: true });

test.describe('screens rail (#429)', () => {
  test('lives on the left, not in the top bar, with icon + label per screen and the current one marked', async ({ page }) => {
    await gotoCockpit(page, '/pages');
    const rail = nav(page);
    await expect(rail).toBeVisible();
    await expect(page.getByRole('banner').getByRole('navigation', { name: 'Screens', exact: true })).toHaveCount(0);
    const [railBox, midBox] = [await rail.boundingBox(), await page.locator('#sh-mid').boundingBox()];
    expect(railBox.x).toBeLessThan(5);
    expect(railBox.x + railBox.width).toBeLessThanOrEqual(midBox.x + 1);
    await expect(rail.getByRole('link')).toHaveCount(5);
    for (const link of await rail.getByRole('link').all()) {
      await expect(link.locator('svg')).toHaveCount(1);
      await expect(link).toHaveAttribute('title', /.+/);
    }
    const current = rail.locator('[aria-current="page"]');
    await expect(current).toHaveCount(1);
    await expect(current).toHaveText(/^Pages/);
    // Not colour alone: the current entry is bold and has an edge bar.
    const style = await current.evaluate((el) => ({ w: getComputedStyle(el).fontWeight, b: getComputedStyle(el).borderLeftWidth }));
    expect(Number(style.w)).toBeGreaterThanOrEqual(600);
    expect(style.b).toBe('3px');
    // The top bar keeps its other parts.
    const banner = page.getByRole('banner');
    await expect(banner.getByTestId('project-switcher')).toBeVisible();
    await expect(banner.getByTestId('palette-trigger')).toBeVisible();
    await expect(banner.getByTestId('pill-processes')).toBeVisible();
    await expect(banner.getByTestId('user-menu-trigger')).toBeVisible();
  });

  test('clicking a screen navigates and moves the current marker', async ({ page }) => {
    await gotoCockpit(page, '/');
    for (const [label, url] of [['Pages', /\/pages$/], ['Components', /\/workflows$/], ['Git', /\/review$/], ['Tests', /\/tests$/], ['Features', /\/$/]]) {
      await nav(page).getByRole('link', { name: label }).click();
      await expect(page).toHaveURL(url);
      await expect(nav(page).getByRole('link', { name: label })).toHaveAttribute('aria-current', 'page');
      await expect(nav(page).locator('[aria-current="page"]')).toHaveCount(1);
    }
  });

  test('keyboard: one tab stop, Up/Down/Home/End move focus, Enter opens the screen', async ({ page }) => {
    await gotoCockpit(page, '/pages');
    const links = nav(page).getByRole('link');
    // Roving tab stop: only the current screen is in the tab order.
    await expect(nav(page).locator('a[tabindex="0"]')).toHaveCount(1);
    await expect(links.nth(1)).toHaveAttribute('tabindex', '0');
    await links.nth(1).focus();
    await page.keyboard.press('ArrowDown');
    await expect(links.nth(2)).toBeFocused();
    await page.keyboard.press('End');
    await expect(links.nth(4)).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(links.nth(0)).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(links.nth(4)).toBeFocused();
    await page.keyboard.press('Home');
    await expect(links.nth(0)).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/workflows$/);
  });

  test('collapses to icons only, keeps names for screen readers and tooltips, and remembers the choice', async ({ page }) => {
    await gotoCockpit(page, '/pages');
    const rail = nav(page);
    const toggle = page.getByTestId('rail-toggle');
    const wide = (await rail.boundingBox()).width;
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(rail.getByText('Components', { exact: true })).toBeVisible();

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(rail).toHaveAttribute('data-collapsed', 'true');
    expect((await rail.boundingBox()).width).toBeLessThan(wide / 2);
    // The name is still the accessible name and the tooltip; only the visible word is gone.
    await expect(rail.getByRole('link', { name: 'Components' })).toHaveAttribute('title', 'Components');
    const box = await rail.getByRole('link', { name: 'Components' }).boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => window.localStorage.getItem('construct.shell.rail'))).toBe('collapsed');

    // Survives a reload and moving between screens; a keyboard user can operate the collapsed rail.
    await page.reload();
    await expect(nav(page)).toHaveAttribute('data-collapsed', 'true');
    await nav(page).getByRole('link', { name: 'Tests' }).click();
    await expect(page).toHaveURL(/\/tests$/);
    await expect(nav(page)).toHaveAttribute('data-collapsed', 'true');

    await page.getByTestId('rail-toggle').click();
    await expect(nav(page)).toHaveAttribute('data-collapsed', 'false');
    await page.reload();
    await expect(nav(page)).toHaveAttribute('data-collapsed', 'false');
    expect(await page.evaluate(() => window.localStorage.getItem('construct.shell.rail'))).toBe('expanded');
  });

  test('at 390 px the rail becomes a bar above the pane tabs, with no sideways scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await gotoCockpit(page, '/tests');
    const rail = nav(page);
    await expect(rail.getByRole('link')).toHaveCount(5);
    await expect(page.getByTestId('rail-toggle')).toHaveCount(0);
    for (const link of await rail.getByRole('link').all()) {
      await expect(link).toBeVisible();
      const box = await link.boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    const [r, panes, top] = [await rail.boundingBox(), await page.getByRole('navigation', { name: 'Panes' }).boundingBox(), await page.getByRole('banner').boundingBox()];
    expect(r.y).toBeGreaterThan(top.y + top.height);
    expect(r.y + r.height).toBeLessThanOrEqual(panes.y + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(rail.getByRole('link', { name: 'Tests' })).toHaveAttribute('aria-current', 'page');
    await rail.getByRole('link', { name: 'Git' }).click();
    await expect(page).toHaveURL(/\/review$/);
  });

  for (const theme of ['dark', 'light']) {
    for (const [name, size] of [['wide', { width: 1280, height: 800 }], ['narrow', { width: 390, height: 800 }]]) {
      test(`axe: rail is clean, ${theme} theme, ${name}`, async ({ page }) => {
        await page.setViewportSize(size);
        await gotoCockpit(page, '/pages');
        await setTheme(page, theme);
        const found = await runAxe(page, { include: '[data-testid="screens-rail"]' });
        expect(found.filter(isBlocking), format(found)).toEqual([]);
        expect(found, format(found)).toEqual([]);
        if (name === 'wide') {
          await page.getByTestId('rail-toggle').click();
          const collapsed = await runAxe(page, { include: '[data-testid="screens-rail"]' });
          expect(collapsed, format(collapsed)).toEqual([]);
          await page.getByTestId('rail-toggle').click();
        }
      });
    }
  }
});
