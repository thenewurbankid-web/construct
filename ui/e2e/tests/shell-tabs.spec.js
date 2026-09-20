import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gotoCockpit } from './support/cockpit.js';

// Design #245 — the tab host: every region (Browser / Tools / Drawer) renders
// its registered tabs (id, title, badge, render) as an ARIA tablist with
// roving keyboard focus.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(__dirname, '../screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

test.describe('Right-panel / drawer tab host (#245)', () => {
  test('Tools panel: default Project tab is a real tab with a labelled panel showing project info and shortcuts', async ({ page }) => {
    await page.goto('/help');
    await page.getByTestId('toggle-right').click();
    const tools = page.getByRole('complementary', { name: 'Tools' });
    const tablist = tools.getByRole('tablist', { name: 'Tools' });
    await expect(tablist.getByRole('tab')).toHaveText(['Project']);
    await expect(tablist.getByRole('tab', { name: 'Project' })).toHaveAttribute('aria-selected', 'true');
    const panel = tools.getByRole('tabpanel', { name: 'Project' });
    await expect(panel).toBeVisible();
    await expect(panel.getByTestId('info-project-dir')).not.toHaveText('');
    await expect(panel.getByText('Ctrl Alt B')).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, 'shell-tools-tab.png') });
  });

  test('Drawer: arrow keys / Home / End move between tabs (roving tabindex) and change the panel', async ({ page }) => {
    await gotoCockpit(page, '/help');
    await page.keyboard.press('Control+j');
    const drawer = page.getByRole('region', { name: 'Drawer' });
    const tabs = drawer.getByRole('tab');
    await expect(tabs).toHaveText([/^Diagnostics/, 'Logs', 'Processes']) // #249: Diagnostics carries a count badge once validate has run;
    const diagnostics = drawer.getByRole('tab', { name: 'Diagnostics' });
    const logs = drawer.getByRole('tab', { name: 'Logs' });
    const processes = drawer.getByRole('tab', { name: 'Processes' });

    // Only the selected tab is in the tab order.
    await expect(diagnostics).toHaveAttribute('tabindex', '0');
    await expect(logs).toHaveAttribute('tabindex', '-1');

    await diagnostics.focus();
    await page.keyboard.press('ArrowRight');
    await expect(logs).toBeFocused();
    await expect(logs).toHaveAttribute('aria-selected', 'true');
    await expect(drawer.getByRole('tabpanel', { name: 'Logs' })).toContainText('Clear view') // #249: real Logs tab (lines may exist from the validate run);
    await page.keyboard.press('End');
    await expect(processes).toBeFocused();
    await expect(drawer.getByRole('tabpanel')).toContainText('No processes running');
    await page.keyboard.press('ArrowRight');
    await expect(diagnostics).toBeFocused(); // wraps
    await page.keyboard.press('ArrowLeft');
    await expect(processes).toBeFocused(); // wraps back
    await page.keyboard.press('Home');
    await expect(diagnostics).toBeFocused();
    await expect(drawer.getByRole('tabpanel')).toContainText('Run validate') // #249: real Diagnostics tab;
    await page.screenshot({ path: path.join(SHOTS, 'shell-drawer-tabs.png') });
  });

  test('Browser pane: a screen with no tab of its own shows a designed empty state, not an empty tablist (#370)', async ({ page }) => {
    // /settings registers no Browser tab, and the shell no longer supplies a "Screens" tab: the top bar and the
    // profile menu are the navigation.
    await page.goto('/settings');
    const browser = page.getByRole('complementary', { name: 'Browser' });
    await expect(browser.getByRole('tablist')).toHaveCount(0);
    await expect(browser).toContainText('Nothing to browse on this screen');
    await expect(browser.getByRole('link')).toHaveCount(0);
  });

  test('a clicked tab becomes selected; focus ring is visible on keyboard focus', async ({ page }) => {
    await gotoCockpit(page, '/help');
    await page.keyboard.press('Control+j');
    const drawer = page.getByRole('region', { name: 'Drawer' });
    await drawer.getByRole('tab', { name: 'Logs' }).click();
    await expect(drawer.getByRole('tab', { name: 'Logs' })).toHaveAttribute('aria-selected', 'true');
    await expect(drawer.getByRole('tab', { name: 'Diagnostics' })).toHaveAttribute('aria-selected', 'false');
    await page.keyboard.press('Tab'); // into the tabpanel (focusable)
    await page.keyboard.press('Shift+Tab');
    const outline = await drawer.getByRole('tab', { name: 'Logs' }).evaluate((el) => getComputedStyle(el).outlineStyle + ' ' + getComputedStyle(el).outlineWidth);
    expect(outline).toBe('solid 2px');
  });
});
