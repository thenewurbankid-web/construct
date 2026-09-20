import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gotoCockpit, setTheme } from './support/cockpit.js';

// Design #249 -- bottom drawer (real Diagnostics from `construct validate`,
// Logs, Processes placeholder) and the Ctrl K command palette.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(__dirname, '../screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const API = process.env.E2E_API_BASE || 'http://localhost:4000';

test.describe('Cockpit drawer and command palette (#249)', () => {
  let base;
  let original;

  test.beforeAll(async ({ request }) => {
    original = (await (await request.get(`${API}/api/settings`)).json()).projectDir;
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'construct-drawer-')));
    const write = (rel, text) => {
      fs.mkdirSync(path.dirname(path.join(base, rel)), { recursive: true });
      fs.writeFileSync(path.join(base, rel), text);
    };
    write('architecture.yml', fs.readFileSync(path.resolve(__dirname, '../../client/architecture.yml'), 'utf8'));
    write('features/demo/hooks/useThing.tsx', "export function useThing() { return 1; }\n");
    write('features/demo/pages/DemoPage.tsx', "import { useThing } from '../hooks/useThing';\n\nexport function DemoPage() {\n  useThing();\n  return <main><h1>Demo</h1></main>;\n}\n");
    const res = await request.post(`${API}/api/settings`, { data: { projectDir: base } });
    expect(res.ok()).toBeTruthy();
  });

  test.afterAll(async ({ request }) => {
    await request.post(`${API}/api/settings`, { data: { projectDir: original } });
    fs.rmSync(base, { recursive: true, force: true });
  });

  test('Diagnostics lists real validate results in plain language with a count badge; a page row opens the Pages editor', async ({ page }) => {
    await gotoCockpit(page, '/help');
    await page.keyboard.press('Control+j');
    const drawer = page.getByRole('region', { name: 'Drawer' });
    const tab = drawer.getByRole('tab', { name: /Diagnostics/ });
    await expect(tab.getByLabel(/Diagnostics$/)).toBeVisible({ timeout: 20_000 }); // badge appears once the run finishes
    const rows = drawer.getByTestId('diagnostic-row');
    await expect(rows.first()).toBeVisible();
    const pageRow = rows.filter({ hasText: 'PAGE-006' });
    await expect(pageRow).toContainText('features/demo/pages/DemoPage.tsx:1');
    await expect(drawer.getByText(/\d+ errors?/).first()).toBeVisible();
    // A non-page row expands to say why and how to fix it.
    await rows.filter({ hasText: 'SLICE-001' }).click();
    await expect(drawer.getByText('Why:')).toBeVisible();
    await rows.filter({ hasText: 'SLICE-001' }).click();
    await expect(page.getByTestId('status-validate')).toContainText(/problem/);
    await page.screenshot({ path: path.join(SHOTS, 'shell-diagnostics-dark.png') });

    await setTheme(page, 'light');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.screenshot({ path: path.join(SHOTS, 'shell-diagnostics-light.png') });
    await setTheme(page, 'dark');

    await pageRow.click();
    await expect(page).toHaveURL(/\/pages\?feature=demo&file=DemoPage\.tsx/);
    await expect(page.getByText('DemoPage.tsx').first()).toBeVisible({ timeout: 15_000 });
  });

  test('Logs shows recent output (the validate run) and Processes stays the designed empty state', async ({ page }) => {
    await gotoCockpit(page, '/help');
    await page.keyboard.press('Control+j');
    const drawer = page.getByRole('region', { name: 'Drawer' });
    await drawer.getByRole('tab', { name: 'Logs' }).click();
    await expect(drawer.getByTestId('logs-list')).toContainText('validate:', { timeout: 20_000 });
    await drawer.getByRole('button', { name: 'Clear view' }).click();
    await expect(drawer.getByTestId('logs-empty')).toBeVisible();
    await drawer.getByRole('tab', { name: 'Processes' }).click();
    await expect(drawer.getByRole('tabpanel')).toContainText('No processes running');
  });

  test('Ctrl K opens an accessible palette: combobox focus, filtering, trapped Tab, Esc restores focus', async ({ page }) => {
    await gotoCockpit(page, '/help');
    const trigger = page.getByTestId('palette-trigger');
    await trigger.focus();
    await page.keyboard.press('Control+k');
    const dialog = page.getByRole('dialog', { name: 'Command palette' });
    await expect(dialog).toBeVisible();
    const input = dialog.getByRole('combobox', { name: 'Search commands' });
    await expect(input).toBeFocused();
    await expect(dialog.getByRole('option').first()).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, 'shell-palette-dark.png') });

    await input.fill('logs');
    await expect(dialog.getByRole('option', { name: /Show Logs/ })).toBeVisible();
    await expect(dialog.getByRole('option', { name: /Go to Settings/ })).toHaveCount(0);
    await expect(input).toHaveAttribute('aria-activedescendant', /cp-option-0/);

    await page.keyboard.press('Tab');
    await expect(input).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(input).toBeFocused();

    await input.fill('zzzzqq');
    await expect(dialog.getByRole('status')).toContainText('No commands match');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test('palette commands: go to a screen, run validate, toggle theme and drawer, switch mode, open project switcher', async ({ page }) => {
    await page.goto('/help');
    const dialog = page.getByRole('dialog', { name: 'Command palette' });
    const run = async (query) => {
      await page.getByTestId('palette-trigger').click();
      await dialog.getByRole('combobox').fill(query);
      await page.keyboard.press('Enter');
      await expect(dialog).toHaveCount(0);
    };

    await run('go to settings');
    await expect(page).toHaveURL(/\/settings$/);

    await run('explore');
    await expect(page).toHaveURL(/\/pages/);

    await run('toggle dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.getByTestId('user-menu-trigger').click();
    await expect(page.getByTestId('theme-light')).toBeChecked(); // the profile menu's Theme choice stays in sync with the palette
    await page.keyboard.press('Escape');
    await page.getByTestId('palette-trigger').click();
    await page.screenshot({ path: path.join(SHOTS, 'shell-palette-light.png') });
    await page.keyboard.press('Escape');
    await run('toggle dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await run('show or hide the drawer');
    const drawer = page.getByRole('region', { name: 'Drawer' });
    await expect(drawer).toBeVisible();
    await run('show or hide the drawer');
    await expect(drawer).toHaveCount(0);

    await run('run validate');
    await expect(drawer.getByRole('tab', { name: /Diagnostics/ })).toHaveAttribute('aria-selected', 'true');
    await expect(drawer.getByTestId('diagnostic-row').first()).toBeVisible({ timeout: 20_000 });

    await run('project switcher');
    await expect(page.getByTestId('project-switcher')).toHaveAttribute('aria-expanded', 'true');
  });

  test('the palette also opens with Meta+K and closes on a click outside', async ({ page }) => {
    await gotoCockpit(page, '/help');
    await page.keyboard.press('Meta+k');
    const dialog = page.getByRole('dialog', { name: 'Command palette' });
    await expect(dialog).toBeVisible();
    await page.getByTestId('palette-backdrop').click({ position: { x: 5, y: 5 } });
    await expect(dialog).toHaveCount(0);
  });
});
