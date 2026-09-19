import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Design #250 — the shared empty / loading / error / offline states, used
// consistently by the migrated screens (Settings, Local Model, Dashboard, Wizard, Help).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(__dirname, '../screenshots/shell-states');
fs.mkdirSync(SHOTS, { recursive: true });

const OLLAMA_DOWN = { running: false, host: 'http://localhost:11434' };

test('reference page shows all four states; Try again retries', async ({ page }) => {
  await page.goto('/states');
  await expect(page.getByTestId('state-empty')).toContainText('Open a project to start');
  await expect(page.getByTestId('state-loading')).toContainText('Scanning 41 files');
  await expect(page.getByTestId('state-loading').getByRole('progressbar')).toHaveAttribute('aria-valuenow', '55');
  await expect(page.getByTestId('state-error')).toContainText('Preview could not start');
  await expect(page.getByTestId('state-offline')).toContainText('Local model is offline');
  await expect(page.getByTestId('state-offline')).toContainText('Deterministic steps still work');
  await page.screenshot({ path: path.join(SHOTS, 'states-dark.png'), fullPage: true });

  await expect(page.getByTestId('retry-count')).toHaveText('Retried 0 times');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('button', { name: 'Trying again…' })).toBeDisabled();
  await expect(page.getByTestId('retry-count')).toHaveText('Retried 1 time');
});

test('reference page in the light theme', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('construct.theme', 'light'));
  await page.goto('/states');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByTestId('state-error')).toBeVisible();
  await page.screenshot({ path: path.join(SHOTS, 'states-light.png'), fullPage: true });
});

test('reference page at phone width stacks the states', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/states');
  await expect(page.getByTestId('state-offline')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.screenshot({ path: path.join(SHOTS, 'states-phone-dark.png'), fullPage: true });
});

test('Settings: backend unreachable shows an error with Try again, which recovers', async ({ page }) => {
  await page.route('**/api/settings', (route) => route.abort('failed'));
  await page.goto('/settings');
  const error = page.getByTestId('state-error');
  await expect(error).toContainText('Could not load settings');
  await expect(error).toContainText('backend did not answer');
  await page.screenshot({ path: path.join(SHOTS, 'settings-error-dark.png') });

  await page.unroute('**/api/settings');
  await error.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  await expect(page.getByTestId('state-error')).toHaveCount(0);
});

test('Settings: slow backend shows the loading state first', async ({ page }) => {
  await page.route('**/api/settings', async (route) => {
    await new Promise((r) => setTimeout(r, 1200));
    await route.continue();
  });
  await page.goto('/settings');
  const loading = page.getByTestId('state-loading');
  await expect(loading).toContainText('Loading settings');
  await page.screenshot({ path: path.join(SHOTS, 'settings-loading-dark.png') });
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
});

test('Local Model: offline shows the offline state next to the install guidance', async ({ page }) => {
  await page.route('**/api/ollama/status', (route) => route.fulfill({ json: OLLAMA_DOWN }));
  await page.goto('/ollama');
  await expect(page.getByTestId('state-offline')).toContainText('Deterministic steps still work');
  await expect(page.getByRole('heading', { name: "Ollama isn't running" })).toBeVisible();
  await expect(page.getByTestId('state-error')).toHaveCount(0);
  await page.screenshot({ path: path.join(SHOTS, 'ollama-offline-dark.png'), fullPage: true });
});

test('Local Model: status request failing is an error (not "offline") with Try again', async ({ page }) => {
  await page.route('**/api/ollama/status', (route) => route.abort('failed'));
  await page.goto('/ollama');
  await expect(page.getByTestId('state-error')).toContainText('Could not check for Ollama');
  await page.unroute('**/api/ollama/status');
  await page.route('**/api/ollama/status', (route) => route.fulfill({ json: OLLAMA_DOWN }));
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByText('Not detected')).toBeVisible();
});

test('Local Model: no models installed is a designed empty state', async ({ page }) => {
  await page.route('**/api/ollama/status', (route) => route.fulfill({ json: { running: true, version: '0.3.12', host: 'http://localhost:11434' } }));
  await page.route('**/api/ollama/models', (route) => route.fulfill({ json: { models: [] } }));
  await page.goto('/ollama');
  await expect(page.locator('.ollama-models').getByTestId('state-empty')).toContainText('No models pulled yet');
});

test('Dashboard: an offline local model shows the banner; a running one does not', async ({ page }) => {
  await page.route('**/api/ollama/status', (route) => route.fulfill({ json: OLLAMA_DOWN }));
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
  await expect(page.getByTestId('state-offline')).toContainText('Local model is offline');
  await page.screenshot({ path: path.join(SHOTS, 'dashboard-offline-dark.png') });

  await page.unroute('**/api/ollama/status');
  await page.route('**/api/ollama/status', (route) => route.fulfill({ json: { running: true, version: '0.3.12', host: 'x' } }));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
  await expect(page.getByTestId('state-offline')).toHaveCount(0);
});

test('Wizard: a closed backend connection is an error state, not a bare line of text', async ({ page }) => {
  await page.routeWebSocket('**/ws/wizard', (ws) => ws.close());
  await page.goto('/wizard');
  await expect(page.getByRole('heading', { name: 'Import Route Wizard', level: 1 })).toBeVisible();
  await expect(page.getByTestId('state-error')).toContainText('Disconnected from the backend');
  await page.screenshot({ path: path.join(SHOTS, 'wizard-disconnected-dark.png') });
});

test('Help: contents are also a tab in the Browser pane and jump to the section', async ({ page }) => {
  await page.goto('/help');
  const browser = page.getByRole('complementary', { name: 'Browser' });
  await browser.getByRole('tab', { name: 'Contents' }).click();
  await expect(browser.getByRole('navigation', { name: 'Help contents' })).toBeVisible();
  await browser.getByRole('link', { name: 'Tutorials' }).click();
  await expect(page).toHaveURL(/#tutorials$/);
  await page.screenshot({ path: path.join(SHOTS, 'help-browser-contents-dark.png') });
});

test('screens on the shell idiom carry no glass blur', async ({ page }) => {
  for (const route of ['/dashboard', '/wizard', '/settings', '/ollama', '/help']) {
    await page.goto(route);
    await expect(page.locator('h1').first()).toBeVisible();
    const blurred = await page.evaluate(() =>
      [...document.querySelectorAll('.glass-panel')].filter((el) => getComputedStyle(el).backdropFilter !== 'none').length);
    expect(blurred, `${route} still has blurred glass panels`).toBe(0);
  }
});
