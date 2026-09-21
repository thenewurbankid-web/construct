import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTheme } from './support/cockpit.js';

// Design #245 — top bar: project switcher (local projects only, reuses the
// settings project dir and the shared folder picker), the five screens (now in the left rail, #429; Features / Pages / Components / Git /
// Tests, #369; they replaced the Explore / Plan / Build / Review modes), real status pills, and the profile menu (#368).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(__dirname, '../screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const API = process.env.E2E_API_BASE || 'http://localhost:4000';

test.describe('Cockpit top bar (#245)', () => {
  test('the five screens route to existing routes and mark the current one (#369)', async ({ page }) => {
    const nav = page.getByRole('navigation', { name: 'Screens', exact: true });
    await page.goto('/settings');
    // Order is fixed; a badge may follow a name (Git), so match on the start of each link's text.
    await expect(nav.getByRole('link')).toHaveCount(5);
    for (const [i, label] of ['Features', 'Pages', 'Components', 'Git', 'Tests'].entries()) await expect(nav.getByRole('link').nth(i)).toHaveText(new RegExp(`^${label}`));
    // The old modes are gone, and on a utility page (Settings) no screen is current.
    await expect(page.getByRole('navigation', { name: 'Modes' })).toHaveCount(0);
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(0);

    const go = async (label, url) => {
      await nav.getByRole('link', { name: label }).click();
      await expect(page).toHaveURL(url);
      await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
      await expect(nav.getByRole('link', { name: label })).toHaveAttribute('aria-current', 'page');
    };
    await go('Pages', /\/pages$/);
    await go('Components', /\/workflows$/);
    await go('Git', /\/review$/);
    await go('Tests', /\/tests$/);
    await go('Features', /\/$/);

    // Every route the retired modes and the Dashboard covered belongs to Features.
    for (const route of ['/plan', '/dashboard', '/wizard']) {
      await page.goto(route);
      await expect(nav.getByRole('link', { name: 'Features' })).toHaveAttribute('aria-current', 'page');
    }
  });

  test('at 390 px the five screens are a bar above the pane tabs, all reachable, with no sideways scroll (#369, #429)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto('/pages');
    const nav = page.getByRole('navigation', { name: 'Screens', exact: true });
    await expect(nav.getByRole('link')).toHaveCount(5);
    for (const link of await nav.getByRole('link').all()) await expect(link).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    // The top bar is one row again; the screens sit just above the Browser / Stage / Tools tabs.
    const [navBox, panesBox] = [await nav.boundingBox(), await page.getByRole('navigation', { name: 'Panes' }).boundingBox()];
    expect(navBox.y).toBeLessThan(panesBox.y);
    await nav.getByRole('link', { name: 'Tests' }).click();
    await expect(page).toHaveURL(/\/tests$/);
  });

  test('every former Screens-tab target is still reachable: top bar, profile menu or palette (#370)', async ({ page }) => {
    await page.goto('/settings');
    // The Browser pane's Screens tab is gone; nothing in the pane lists screens any more.
    await expect(page.getByRole('navigation', { name: 'All screens' })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Screens' })).toHaveCount(0);

    // Dashboard, Import Wizard, Pages Editor, Workflows, Tests, Local Model, Settings, Help:
    // - the five primary screens are in the left rail (Dashboard became Features, Pages Editor Pages, Workflows Components);
    // - Settings, Local Model and Help are in the profile menu;
    // - the Import Wizard and everything else stay one palette command away.
    const nav = page.getByRole('navigation', { name: 'Screens', exact: true });
    await nav.getByRole('link', { name: 'Components' }).click();
    await expect(page).toHaveURL(/\/workflows$/);
    await page.getByTestId('user-menu-trigger').click();
    await page.getByTestId('profile-help').click();
    await expect(page.locator('h1')).toHaveText('Help');
    await page.getByTestId('user-menu-trigger').click();
    await page.getByTestId('profile-local-model').click();
    await expect(page).toHaveURL(/\/ollama$/);
    await page.getByTestId('user-menu-trigger').click();
    await page.getByTestId('profile-settings').click();
    await expect(page).toHaveURL(/\/settings$/);

    await page.keyboard.press('Control+k');
    const dialog = page.getByRole('dialog', { name: 'Command palette' });
    await dialog.getByRole('combobox').fill('go to import wizard');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/wizard$/);
    await expect(nav.getByRole('link', { name: 'Features' })).toHaveAttribute('aria-current', 'page');
  });

  test('model pill shows the real Ollama state (offline / ready)', async ({ page }) => {
    await page.route('**/api/ollama/status', (route) => route.fulfill({ json: { running: false } }));
    await page.goto('/help');
    await expect(page.getByTestId('pill-model')).toHaveText('Local model offline');
    await page.unroute('**/api/ollama/status');
    await page.route('**/api/ollama/status', (route) => route.fulfill({ json: { running: true, version: '0.3.12' } }));
    await page.goto('/help');
    await expect(page.getByTestId('pill-model')).toHaveText('Local model ready');
  });

  // #292 — was "Processes pill (0 until the Processes epic)": the count is now the real
  // number of running processes. With nothing running it is still 0 and the drawer says
  // so; with one running (served here as the API would) it reads 1. The full drawer is
  // driven against a real engine in processes-drawer.spec.js.
  test('Processes pill shows the real running count and opens the drawer on its Processes tab', async ({ page }) => {
    await page.goto('/help');
    await expect(page.getByTestId('pill-processes')).toHaveText('Processes: 0');
    await page.getByTestId('pill-processes').click();
    await expect(page.getByRole('region', { name: 'Drawer' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Processes' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('No processes running')).toBeVisible();
  });

  test('Processes pill counts running processes only (a paused one is not running)', async ({ page }) => {
    const summary = (id, state) => ({
      id, title: `Plan ${id}`, projectRoot: '/x', state, stateDetail: state, pendingControl: null, currentStepId: null,
      progress: { done: 0, failed: 0, total: 1 }, modelSteps: 0, plannedModelSteps: 0, artifacts: 0, pendingApproval: 0,
      createdAt: '2026-09-20T10:00:00.000Z', startedAt: null, finishedAt: null, terminal: false, controls: [], error: null,
    });
    await page.route('**/api/processes', (route) => route.fulfill({
      json: { ok: true, projectRoot: '/x', problems: [], processes: [summary('a', 'running'), summary('b', 'paused'), summary('c', 'running')] },
    }));
    await page.goto('/help');
    await expect(page.getByTestId('pill-processes')).toHaveText('Processes: 2');
  });

  // #279 — the UI is the Cockpit; Construct is the framework/CLI underneath
  // it. The brand drifted to 'Construct' and nothing asserted on it, so this
  // pins the name in both the banner and the document title.
  test('the brand names the Cockpit, not the framework', async ({ page }) => {
    await page.goto('/help');
    await expect(page.getByRole('banner').getByText('Cockpit', { exact: true })).toBeVisible();
    await expect(page).toHaveTitle(/Cockpit/);
  });

  test('the theme is chosen from the profile menu in the top bar (#368)', async ({ page }) => {
    await page.goto('/help');
    await expect(page.getByRole('banner').getByTestId('theme-toggle')).toHaveCount(0);
    await setTheme(page, 'light');
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('light');
    await page.screenshot({ path: path.join(SHOTS, 'shell-topbar-light.png'), clip: { x: 0, y: 0, width: 1280, height: 90 } });
  });

  test.describe.serial('project switcher', () => {
    let base;
    let root;
    let original;

    test.beforeAll(async ({ request }) => {
      original = (await (await request.get(`${API}/api/settings`)).json()).projectDir;
      base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'construct-switcher-')));
      root = path.join(base, 'projects');
      fs.mkdirSync(path.join(root, 'shop-app'), { recursive: true });
      fs.writeFileSync(path.join(root, 'shop-app', 'architecture.yml'), 'version: 1\n');
      fs.mkdirSync(path.join(root, 'notes'));
      const res = await request.post(`${API}/api/settings`, { data: { projectDir: root } });
      expect(res.ok()).toBeTruthy();
    });

    test.afterAll(async ({ request }) => {
      await request.post(`${API}/api/settings`, { data: { projectDir: original } });
      fs.rmSync(base, { recursive: true, force: true });
    });

    test('shows the current project, opens the folder picker, Esc closes, choosing a folder switches project', async ({ page, request }) => {
      await page.goto('/help');
      const switcher = page.getByTestId('project-switcher');
      await expect(switcher).toContainText('projects');
      await expect(switcher).toHaveAttribute('aria-expanded', 'false');

      await switcher.click();
      const dialog = page.getByRole('dialog', { name: 'Switch project' });
      await expect(dialog).toBeVisible();
      await expect(switcher).toHaveAttribute('aria-expanded', 'true');
      await expect(dialog.getByTestId('dir-picker-path')).toHaveText(root);
      await page.screenshot({ path: path.join(SHOTS, 'shell-project-switcher.png') });

      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);

      await switcher.click();
      await dialog.getByRole('button', { name: 'Select shop-app' }).click();
      // The page reloads onto the new project; the switcher now names it.
      await expect(page.getByTestId('project-switcher')).toContainText('shop-app');
      const settings = await (await request.get(`${API}/api/settings`)).json();
      expect(settings.projectDir).toBe(path.join(root, 'shop-app'));
    });
  });
});
