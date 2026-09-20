import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Design #245 — top bar: project switcher (local projects only, reuses the
// settings project dir and the shared folder picker), Explore / Research /
// Build modes routing to existing screens, real status pills, and the theme
// switch. The old sidebar links live on in the Browser pane's "Screens" tab.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(__dirname, '../screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const API = process.env.E2E_API_BASE || 'http://localhost:4000';

test.describe('Cockpit top bar (#245)', () => {
  test('modes route to existing screens and mark the current one', async ({ page }) => {
    const modes = page.getByRole('navigation', { name: 'Modes' });
    await page.goto('/settings');
    await expect(modes.getByRole('link', { name: 'Explore' })).not.toHaveAttribute('aria-current', 'page');
    await expect(modes.getByRole('link')).toHaveText(['Explore', 'Research', 'Build']);

    await modes.getByRole('link', { name: 'Explore' }).click();
    await expect(page).toHaveURL(/\/pages$/);
    await expect(modes.getByRole('link', { name: 'Explore' })).toHaveAttribute('aria-current', 'page');
    await expect(modes.getByRole('link', { name: 'Research' })).not.toHaveAttribute('aria-current', 'page');

    await modes.getByRole('link', { name: 'Research' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(modes.getByRole('link', { name: 'Research' })).toHaveAttribute('aria-current', 'page');

    await modes.getByRole('link', { name: 'Build' }).click();
    await expect(page).toHaveURL(/\/wizard$/);
    await expect(modes.getByRole('link', { name: 'Build' })).toHaveAttribute('aria-current', 'page');
  });

  test('every old sidebar screen is still one click away in the Browser pane', async ({ page }) => {
    await page.goto('/dashboard');
    const screens = page.getByRole('navigation', { name: 'Screens' });
    await expect(screens.getByRole('link')).toHaveText([
      'Dashboard',
      'Import Wizard',
      'Pages Editor',
      'Workflows',
      'Local Model',
      'Settings',
      'Help',
    ]);
    await expect(screens.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
    await screens.getByRole('link', { name: 'Workflows' }).click();
    await expect(page).toHaveURL(/\/workflows$/);
    // #248: a screen with its own Browser tab shows it first; Screens is the sibling tab.
    await page.getByRole('tab', { name: 'Screens' }).click();
    await expect(screens.getByRole('link', { name: 'Workflows' })).toHaveAttribute('aria-current', 'page');
    await screens.getByRole('link', { name: 'Help' }).click();
    await expect(page.locator('h1')).toHaveText('Help');
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

  test('theme switch lives in the top bar', async ({ page }) => {
    await page.goto('/help');
    await page.getByRole('banner').getByTestId('theme-toggle').click();
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
      const res = await request.post(`${API}/api/settings`, { data: { browseRoots: [root], projectDir: root } });
      expect(res.ok()).toBeTruthy();
    });

    test.afterAll(async ({ request }) => {
      await request.post(`${API}/api/settings`, { data: { browseRoots: [], projectDir: original } });
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
