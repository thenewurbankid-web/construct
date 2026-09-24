import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAxe, isBlocking, format } from './support/axe.js';
import { setTheme } from './support/cockpit.js';

// #429 -- with NO project open the whole UI is blocked behind the full-screen "Open a project" gate: minimal top
// bar (brand + profile menu), no rail, panes, drawer, status bar or palette, on every route. Settings, Local model
// and Help stay reachable from the profile menu. Runs under playwright.workspace.config.js (no project preloaded).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API = process.env.E2E_API_BASE || 'http://localhost:4000';
const BIN = path.resolve(__dirname, '../../../packages/cli/construct.mjs');
const WS = process.env.E2E_WORKSPACE_ROOT;
const ROUTES = ['/', '/plan', '/dashboard', '/wizard', '/pages', '/workflows', '/review', '/tests', '/states'];

const closeProject = (request) => request.post(`${API}/api/settings`, { data: { closeProject: true } });
const makeShop = () => {
  fs.mkdirSync(path.join(WS, 'shop'), { recursive: true });
  execFileSync(process.execPath, [BIN, 'init', path.join(WS, 'shop')], { stdio: 'ignore' });
};
const clearWorkspace = () => {
  for (const name of fs.readdirSync(WS)) fs.rmSync(path.join(WS, name), { recursive: true, force: true });
};

async function expectOnlyTheGate(page, route) {
  await expect(page.getByRole('heading', { name: 'Open a project' }), route).toBeVisible();
  await expect(page.getByTestId('shell-gate'), route).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Screens', exact: true }), route).toHaveCount(0);
  await expect(page.getByTestId('screens-rail'), route).toHaveCount(0);
  for (const pane of ['left', 'right', 'drawer']) await expect(page.locator(`[data-pane="${pane}"]`), route).toHaveCount(0);
  await expect(page.getByRole('contentinfo'), route).toHaveCount(0);
  for (const id of ['project-switcher', 'palette-trigger', 'pill-processes', 'toggle-left', 'toggle-right', 'toggle-drawer', 'status-validate']) {
    await expect(page.getByTestId(id), `${route} ${id}`).toHaveCount(0);
  }
  const banner = page.getByRole('banner');
  await expect(banner.getByText('Cockpit', { exact: true })).toBeVisible();
  await expect(banner.getByTestId('user-menu-trigger')).toBeVisible();
  // Nothing else in the bar: no links, and the only button is the profile menu.
  await expect(banner.getByRole('link')).toHaveCount(0);
  await expect(banner.getByRole('button')).toHaveCount(1);
}

test.describe.serial('no project: the gate (#429)', () => {
  test.beforeEach(async ({ request }) => {
    clearWorkspace();
    const res = await closeProject(request);
    expect(res.ok()).toBeTruthy();
  });
  test.afterAll(async ({ request }) => {
    await closeProject(request);
    clearWorkspace();
  });

  test('every route shows only the gate: minimal top bar, no rail, panes, drawer, status bar or palette', async ({ page }) => {
    for (const route of ROUTES) {
      await page.goto(route);
      await expectOnlyTheGate(page, route);
    }
    // The command palette is not reachable either.
    await page.keyboard.press('Control+k');
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toHaveCount(0);
    await page.keyboard.press('Control+b');
    await expect(page.locator('[data-pane]')).toHaveCount(0);
  });

  test('the gate is the same on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    for (const route of ['/', '/pages', '/review']) {
      await page.goto(route);
      await expectOnlyTheGate(page, route);
      await expect(page.getByRole('navigation', { name: 'Panes' })).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
  });

  test('Settings, Local model and Help stay reachable from the profile menu as full pages', async ({ page }) => {
    await page.goto('/');
    await expectOnlyTheGate(page, '/');
    for (const [testId, url, heading] of [
      ['profile-settings', /\/settings$/, 'Settings'],
      ['profile-local-model', /\/ollama$/, /Local model/],
      ['profile-help', /\/help$/, 'Help'],
    ]) {
      await page.getByTestId('user-menu-trigger').click();
      await page.getByTestId(testId).click();
      await expect(page).toHaveURL(url);
      await expect(page.locator('h1').first()).toHaveText(heading);
      // A full page: the minimal bar only, no rail and no panes, and not the gate.
      await expect(page.getByTestId('shell-gate')).toBeVisible();
      await expect(page.getByTestId('screens-rail')).toHaveCount(0);
      await expect(page.locator('[data-pane="right"]')).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'Open a project' })).toHaveCount(0);
    }
    // And back to the gate from the brand-less route.
    await page.goto('/pages');
    await expectOnlyTheGate(page, '/pages');
  });

  test('a `shop` folder in the workspace gives a one-click "Try the sample shop" that opens it the normal way', async ({ page, request }) => {
    makeShop();
    fs.mkdirSync(path.join(WS, 'notes'));
    await page.goto('/');
    const open = page.getByTestId('open-sample-shop');
    await expect(open).toHaveText('Try the sample shop');
    await open.click();
    // The full shell appears, on the sample project.
    await expect(page.getByRole('heading', { name: 'Features', level: 1 })).toBeVisible();
    await expect(page.getByTestId('project-switcher')).toContainText('shop');
    await expect(page.getByRole('navigation', { name: 'Screens', exact: true })).toBeVisible();
    await expect(page.getByTestId('shell-gate')).toHaveCount(0);
    const settings = await (await request.get(`${API}/api/settings`)).json();
    expect(settings.projectDir).toBe(path.join(WS, 'shop'));

    // Closing the project returns to the gate, and every route is gated again.
    await page.getByTestId('project-switcher').click();
    await page.getByTestId('close-project').click();
    await expectOnlyTheGate(page, '/');
    await page.goto('/tests');
    await expectOnlyTheGate(page, '/tests');
  });

  // #391 item 1: an empty state ends with one primary action and no secondary paragraph, so with no `shop` folder the
  // gate offers no sample button and no "how to get one" text (this test used to assert that hint).
  test('without a `shop` folder the gate offers no sample and no extra explanation', async ({ page }) => {
    fs.mkdirSync(path.join(WS, 'notes'));
    await page.goto('/');
    await expect(page.getByTestId('open-sample-shop')).toHaveCount(0);
    await expect(page.getByTestId('sample-hint')).toHaveCount(0);
    await expect(page.getByTestId('no-project')).not.toContainText('Want something to try');
  });

  test('the sample is only ever a workspace folder: a `shop` symlink out of it is not offered', async ({ page }) => {
    const outside = path.join(path.dirname(WS), 'outside-shop');
    fs.mkdirSync(outside, { recursive: true });
    fs.symlinkSync(outside, path.join(WS, 'shop'));
    try {
      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'Open a project' })).toBeVisible();
      await expect(page.getByTestId('open-sample-shop')).toHaveCount(0);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  for (const theme of ['dark', 'light']) {
    for (const [name, size] of [['wide', { width: 1280, height: 800 }], ['narrow', { width: 390, height: 800 }]]) {
      test(`axe: the gate is clean, ${theme} theme, ${name}`, async ({ page }) => {
        makeShop();
        await page.setViewportSize(size);
        await page.goto('/');
        await expect(page.getByTestId('open-sample-shop')).toBeVisible();
        await setTheme(page, theme);
        expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe(theme);
        const found = await runAxe(page);
        expect(found.filter(isBlocking), format(found)).toEqual([]);
      });
    }
  }
});
