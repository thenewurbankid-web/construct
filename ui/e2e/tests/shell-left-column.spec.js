import { test, expect } from '@playwright/test';
import { gotoCockpit } from './support/cockpit.js';
import { makeBrowseProject, openProject } from './support/browseProject.js';

const API = process.env.E2E_API_BASE || 'http://localhost:4000';

// #539 (owner: "i still see two menus on left ... it should [go] under the main nav") — the wide
// layout's screens rail (ActivityBar, `nav[aria-label="Screens"]`) and the Browser pane
// (`aside#sh-pane-left`) now share ONE left column (`.sh-left-col`), rail on top, Browser pane
// content below, instead of sitting beside each other as two separate columns. This is shell-wide
// (ShellLayout.tsx/ActivityBar.tsx render for every screen), so the Pages screen alone stands in
// for all of them here, the same way #429/#245's own shell-rail/shell-layout specs already do.
//
// Both halves keep their own, already-shipped, independent collapse mechanism (no second,
// competing one was added): the rail's `sh-rail-toggle` (icons-only) and the Browser pane's
// existing open/close (Ctrl+B / the top-bar toggle). `useRailKeys`' roving-tabindex model inside
// the rail is unchanged.
const nav = (page) => page.getByRole('navigation', { name: 'Screens', exact: true });
const browser = (page) => page.getByRole('complementary', { name: 'Browser' });

test.describe.serial('Shell: rail stacks above the Browser pane in one column (#539)', () => {
  let project;
  let restore;

  test.beforeAll(async () => {
    project = makeBrowseProject('og539-left-column-');
    restore = await openProject(API, project.repo);
  });
  test.afterAll(async () => {
    await restore?.();
    project?.remove();
  });

  test('one shared column: the rail sits above the Browser pane, same width, one right-hand edge', async ({ page }) => {
    await gotoCockpit(page, '/pages');
    const rail = nav(page);
    const pane = browser(page);
    await expect(rail).toBeVisible();
    await expect(pane).toBeVisible();

    // Both landmarks are inside the same `.sh-left-col` wrapper (not two sibling columns).
    const col = page.locator('.sh-left-col');
    await expect(col).toHaveCount(1);
    await expect(col.getByRole('navigation', { name: 'Screens', exact: true })).toHaveCount(1);
    await expect(col.getByRole('complementary', { name: 'Browser' })).toHaveCount(1);

    const [railBox, paneBox, midBox] = [await rail.boundingBox(), await pane.boundingBox(), await page.locator('#sh-mid').boundingBox()];
    // Rail directly above the Browser pane: same left edge, rail's bottom meets the pane's top.
    expect(Math.abs(railBox.x - paneBox.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(railBox.y + railBox.height - paneBox.y)).toBeLessThanOrEqual(1);
    // Same width -- reads as one column, not a narrower menu perched over a wider pane.
    expect(Math.abs(railBox.width - paneBox.width)).toBeLessThanOrEqual(1);
    // The shared column still sits left of the stage, as the old two-column layout did.
    expect(railBox.x).toBeLessThan(5);
    expect(railBox.x + railBox.width).toBeLessThanOrEqual(midBox.x + 1);
  });

  test('independent collapse: the rail\'s own icons-only toggle does not touch the Browser pane, and closing the Browser pane leaves the rail alone', async ({ page }) => {
    await gotoCockpit(page, '/pages');
    const rail = nav(page);
    const pane = browser(page);
    const wideRail = (await rail.boundingBox()).width;

    // Collapsing the rail (its existing toggle, unchanged) does not close or resize the Browser pane.
    await page.getByTestId('rail-toggle').click();
    await expect(rail).toHaveAttribute('data-collapsed', 'true');
    await expect(pane).toBeVisible();
    const paneWidthAfterRailCollapse = (await pane.boundingBox()).width;
    await expect(page.getByTestId('pages-list')).toBeVisible();

    // Re-expand the rail; collapse the Browser pane instead (Ctrl+B) -- the rail is unaffected.
    await page.getByTestId('rail-toggle').click();
    await expect(rail).toHaveAttribute('data-collapsed', 'false');
    await page.keyboard.press('Control+b');
    await expect(pane).toHaveCount(0);
    await expect(rail).toBeVisible();
    await expect(rail.getByRole('link')).toHaveCount(5);
    expect((await rail.boundingBox()).width).toBeGreaterThan(0);

    // Reopen the Browser pane -- both are back, independently, at their prior sizes.
    await page.keyboard.press('Control+b');
    await expect(pane).toBeVisible();
    expect((await pane.boundingBox()).width).toBe(paneWidthAfterRailCollapse);
    expect((await rail.boundingBox()).width).toBe(wideRail);
  });

  test('keyboard: Tab reaches the rail, arrow keys still rove between rail items, Tab continues into the Browser pane', async ({ page }) => {
    await gotoCockpit(page, '/pages');
    const rail = nav(page);
    const links = rail.getByRole('link');

    // Focus the rail's one roving tab stop directly (as shell-rail.spec.js does), confirm arrow-key
    // roving inside the rail still works exactly as before this change.
    await links.nth(1).focus();
    await expect(links.nth(1)).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(links.nth(2)).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(links.nth(1)).toBeFocused();

    // Tab out of the focused rail link: focus lands next inside the Browser pane below it (its
    // own TabHost tab, then its tabpanel, then the pane's own content) -- proving the two are
    // adjacent in one column/tab sequence, not disjoint side-by-side regions.
    await page.keyboard.press('Tab');
    await expect(browser(page).locator(':focus')).toHaveCount(1); // the pane's own "Pages" tab
    await page.keyboard.press('Tab');
    await expect(browser(page).locator(':focus')).toHaveCount(1); // its tabpanel
    await page.keyboard.press('Tab');
    await expect(browser(page).getByRole('radio', { name: 'Files' })).toBeFocused(); // the Files | Flow switcher
  });
});
