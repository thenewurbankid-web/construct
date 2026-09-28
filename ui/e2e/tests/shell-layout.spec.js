import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gotoCockpit } from './support/cockpit.js';

// Design #245 — the Cockpit shell frame: Browser (left) | stage | Tools (right),
// bottom drawer, status bar. Panes resize by mouse and keyboard, collapse, and
// their layout is remembered per project (guarded localStorage).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(__dirname, '../screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const width = async (locator) => Math.round((await locator.boundingBox()).width);

test.describe('Cockpit shell layout (#245)', () => {
  test('first run: top bar, Browser pane open at nav width, Tools and drawer closed, landmarks present', async ({ page }) => {
    await page.goto('/help');
    await expect(page.getByRole('banner')).toBeVisible();
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Browser' })).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Tools' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Bottom panel: Run' })).toHaveCount(0);
    await expect(page.getByRole('contentinfo')).toBeVisible();
    expect(await width(page.locator('#sh-pane-left'))).toBe(200);
    // The page's own heading is still rendered in the stage.
    await expect(page.locator('h1')).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, 'shell-default-dark.png') });
  });

  test('keyboard: the Browser separator resizes with arrows, Shift and Home/End; Enter collapses', async ({ page }) => {
    await page.goto('/help');
    const sep = page.getByRole('separator', { name: 'Resize Browser pane' });
    await expect(sep).toHaveAttribute('aria-valuenow', '200');
    await expect(sep).toHaveAttribute('aria-orientation', 'vertical');
    await sep.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(sep).toHaveAttribute('aria-valuenow', '232');
    expect(await width(page.locator('#sh-pane-left'))).toBe(232);
    await page.keyboard.press('Shift+ArrowLeft');
    await expect(sep).toHaveAttribute('aria-valuenow', '168');
    await page.keyboard.press('Home');
    await expect(sep).toHaveAttribute('aria-valuenow', '160');
    await page.keyboard.press('End');
    await expect(sep).toHaveAttribute('aria-valuenow', '480');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('complementary', { name: 'Browser' })).toHaveCount(0);
    await expect(page.getByTestId('toggle-left')).toHaveAttribute('aria-expanded', 'false');
  });

  test('mouse: dragging the separator resizes the pane, clamped to its limits', async ({ page }) => {
    await page.goto('/help');
    const sep = page.getByRole('separator', { name: 'Resize Browser pane' });
    const box = await sep.boundingBox();
    const y = box.y + 200;
    await page.mouse.move(box.x + box.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 100, y, { steps: 5 });
    await page.mouse.up();
    await expect(sep).toHaveAttribute('aria-valuenow', '300');
    expect(await width(page.locator('#sh-pane-left'))).toBe(300);
    const box2 = await sep.boundingBox();
    await page.mouse.move(box2.x + box2.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(box2.x + 900, y, { steps: 5 });
    await page.mouse.up();
    await expect(sep).toHaveAttribute('aria-valuenow', '480');
  });

  test('Tools panel: toggle opens it on the right, it resizes against the pointer direction, Ctrl+Alt+B closes it', async ({ page }) => {
    await page.goto('/help');
    await page.getByTestId('toggle-right').click();
    const tools = page.getByRole('complementary', { name: 'Tools' });
    await expect(tools).toBeVisible();
    expect(await width(page.locator('#sh-pane-right'))).toBe(360);
    // Right pane sits to the right of the stage (browser LEFT, tools RIGHT).
    const toolsBox = await tools.boundingBox();
    const mainBox = await page.getByRole('main').boundingBox();
    expect(toolsBox.x).toBeGreaterThan(mainBox.x);
    const sep = page.getByRole('separator', { name: 'Resize Tools panel' });
    await sep.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(sep).toHaveAttribute('aria-valuenow', '376');
    await page.keyboard.press('Shift+ArrowRight');
    await expect(sep).toHaveAttribute('aria-valuenow', '312');
    await page.screenshot({ path: path.join(SHOTS, 'shell-tools-dark.png') });
    await page.keyboard.press('Control+Alt+b');
    await expect(tools).toHaveCount(0);
  });

  test('drawer: closed on first run; Ctrl+J and the status bar toggle it; horizontal separator resizes with Up/Down', async ({ page }) => {
    await page.goto('/help');
    await expect(page.getByRole('region', { name: 'Bottom panel: Run' })).toHaveCount(0);
    await page.keyboard.press('Control+j');
    const drawer = page.getByRole('region', { name: 'Bottom panel: Run' });
    await expect(drawer).toBeVisible();
    const sep = page.getByRole('separator', { name: 'Resize drawer' });
    await expect(sep).toHaveAttribute('aria-orientation', 'horizontal');
    await sep.focus();
    await page.keyboard.press('ArrowUp');
    await expect(sep).toHaveAttribute('aria-valuenow', '236');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(sep).toHaveAttribute('aria-valuenow', '204');
    await page.screenshot({ path: path.join(SHOTS, 'shell-drawer-dark.png') });
    await page.getByTestId('toggle-drawer').click();
    await expect(drawer).toHaveCount(0);
  });

  test('Ctrl+B collapses and restores the Browser pane; F6 moves focus between panes', async ({ page }) => {
    await gotoCockpit(page, '/help');
    await page.keyboard.press('Control+b');
    await expect(page.getByRole('complementary', { name: 'Browser' })).toHaveCount(0);
    await page.keyboard.press('Control+b');
    await expect(page.getByRole('complementary', { name: 'Browser' })).toBeVisible();
    // Focus starts outside any landmark (the body): the first F6 stop is the top bar
    // (design section 6's order: top bar, left, stage, right, bottom).
    await page.keyboard.press('F6');
    expect(await page.evaluate(() => document.activeElement?.getAttribute('data-pane'))).toBe('top');
    await page.keyboard.press('F6');
    expect(await page.evaluate(() => document.activeElement?.getAttribute('data-pane'))).toBe('left');
    await page.keyboard.press('F6');
    expect(await page.evaluate(() => document.activeElement?.getAttribute('data-pane'))).toBe('mid');
  });

  test('F6 / Shift+F6 cycle focus through the whole shell in visual order: top bar, left, stage, right, bottom (bottom only while open)', async ({ page }) => {
    await gotoCockpit(page, '/help');
    await page.keyboard.press('Control+Alt+b');
    await page.keyboard.press('Control+j');
    await expect(page.getByRole('complementary', { name: 'Tools' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Bottom panel: Run' })).toBeVisible();

    const paneAt = () => page.evaluate(() => document.activeElement?.getAttribute('data-pane'));
    const order = ['top', 'left', 'mid', 'right', 'drawer'];
    for (const expected of order) {
      await page.keyboard.press('F6');
      expect(await paneAt()).toBe(expected);
    }
    // Wraps back to the start.
    await page.keyboard.press('F6');
    expect(await paneAt()).toBe('top');

    for (const expected of [...order].reverse()) {
      await page.keyboard.press('Shift+F6');
      expect(await paneAt()).toBe(expected);
    }

    // Close the drawer: it drops out of the cycle instead of focusing a hidden landmark.
    await page.getByTestId('toggle-drawer').click();
    await expect(page.getByRole('region', { name: 'Bottom panel: Run' })).toHaveCount(0);
    await page.evaluate(() => (document.activeElement)?.blur());
    for (const expected of ['top', 'left', 'mid', 'right']) {
      await page.keyboard.press('F6');
      expect(await paneAt()).toBe(expected);
    }
    await page.keyboard.press('F6');
    expect(await paneAt()).toBe('top');
  });

  test('Alt 1-5 switches the primary screen from anywhere in the shell', async ({ page }) => {
    await gotoCockpit(page, '/help');
    const rail = page.getByRole('navigation', { name: 'Screens' });
    await page.keyboard.press('Alt+2');
    await expect(page).toHaveURL(/\/pages$/);
    await expect(rail.getByTestId('screen-pages')).toHaveAttribute('aria-current', 'page');
    await page.keyboard.press('Alt+4');
    await expect(page).toHaveURL(/\/review$/);
    await expect(rail.getByTestId('screen-git')).toHaveAttribute('aria-current', 'page');
    await page.keyboard.press('Alt+1');
    await expect(page).toHaveURL(/\/$/);
    await expect(rail.getByTestId('screen-features')).toHaveAttribute('aria-current', 'page');
    // Alt+6 and plain "1" (no modifier) are not shortcuts.
    await page.keyboard.press('Alt+6');
    await page.keyboard.press('1');
    await expect(page).toHaveURL(/\/$/);
  });

  test('layout is remembered per project across reloads; garbage in storage falls back to defaults', async ({ page, request }) => {
    const API = process.env.E2E_API_BASE || 'http://localhost:4000';
    const { projectDir } = await (await request.get(`${API}/api/settings`)).json();
    await page.goto('/help');
    const sep = page.getByRole('separator', { name: 'Resize Browser pane' });
    await sep.focus();
    await page.keyboard.press('Shift+ArrowRight');
    await page.getByTestId('toggle-right').click();
    await expect(sep).toHaveAttribute('aria-valuenow', '264');
    const stored = await page.evaluate((k) => localStorage.getItem(k), `construct.shell.layout:${projectDir}`);
    expect(JSON.parse(stored).left.size).toBe(264);

    await page.reload();
    await expect(page.getByRole('separator', { name: 'Resize Browser pane' })).toHaveAttribute('aria-valuenow', '264');
    await expect(page.getByRole('complementary', { name: 'Tools' })).toBeVisible();

    await page.evaluate((k) => localStorage.setItem(k, '{"left":{"size":"huge","open":7},"x":1}'), `construct.shell.layout:${projectDir}`);
    await page.reload();
    await expect(page.getByRole('separator', { name: 'Resize Browser pane' })).toHaveAttribute('aria-valuenow', '200');
    await expect(page.getByRole('complementary', { name: 'Tools' })).toHaveCount(0);
  });

  test('light theme: same frame, readable, screenshot', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('construct.theme', 'light'));
    await page.goto('/help');
    await page.getByTestId('toggle-right').click();
    await page.keyboard.press('Control+j');
    await expect(page.getByRole('region', { name: 'Bottom panel: Run' })).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, 'shell-full-light.png') });
  });
});
