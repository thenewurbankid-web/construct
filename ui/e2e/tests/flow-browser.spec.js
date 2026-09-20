import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gotoCockpit } from './support/cockpit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.resolve(__dirname, '../screenshots');
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
const API_BASE = process.env.E2E_API_BASE || 'http://localhost:4000';
const FIXTURE = path.resolve(__dirname, '../../../fixtures/flow-react-spa');

// #328 — the Browser pane's Files | Flow switch. The fixture project has three routes: /billing and
// /billing/history (each renders billing), /checkout (a fan-out: orders, then billing, in the route file's import
// order), a shared component reached from both features (drawn once, then "shown above"), and ui-kit, which no
// route reaches.
test.describe.serial('Browser pane Flow view (#328)', () => {
  let projectDir;

  test.beforeAll(async ({ request }) => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-ui-e2e-flow-'));
    fs.cpSync(FIXTURE, projectDir, { recursive: true });
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir } });
  });

  test.afterAll(async ({ request }) => {
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir: path.resolve(__dirname, '../../..') } });
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  const row = (page, label) => page.getByTestId('flow-row').filter({ has: page.locator('.flow-name', { hasText: new RegExp(`^${label}$`) }) });
  const pickFeature = async (page, feature) => {
    await page.locator('.pages-browser select').selectOption(feature);
  };
  const switchTo = (page, name) => page.getByTestId('browser-view-switch').getByRole('radio', { name });
  // Every test starts in a fresh browser context, so the Flow choice is made (and remembered) by clicking it.
  // The Browser pane is narrow by default; widen it (keyboard splitter) so the screenshots show whole rows.
  const widenBrowser = async (page) => {
    await page.locator('[role="separator"]').first().focus();
    for (let i = 0; i < 6; i++) await page.keyboard.press('Shift+ArrowRight');
  };
  const openFlow = async (page, feature) => {
    await gotoCockpit(page, '/pages');
    await switchTo(page, 'Flow').click();
    await pickFeature(page, feature);
    await expect(page.getByTestId('flow-view')).toBeVisible();
  };

  test('Files is the default; Flow draws routes as roots with the fan-out, branches and shared-once files', async ({ page }) => {
    await gotoCockpit(page, '/pages');
    await pickFeature(page, 'billing');

    // Today's list, unchanged, is what opens.
    await expect(switchTo(page, 'Files')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('.pages-browser')).toContainText('pages/ in "billing"');
    await expect(page.getByTestId('flow-view')).toHaveCount(0);

    await switchTo(page, 'Flow').click();
    await expect(page.getByTestId('flow-view')).toContainText('Deterministic');
    await expect(page.getByTestId('flow-view')).toContainText('Computed from imports');
    const routes = page.locator('[data-testid="flow-row"][data-kind="route"] .flow-name');
    await expect(routes).toHaveText(['/billing', '/billing/history', '/checkout']);

    // The fan-out: orders first, then billing (the route file's import order), each with its controller.
    const controllers = page.locator('[data-testid="flow-row"][data-kind="controller"] .flow-name');
    await expect(controllers).toHaveText(['BillingController', 'BillingController', 'OrdersController', 'BillingController']);
    await expect(page.locator('.flow-row.flow-branch', { hasText: 'Behaviour path' }).first()).toBeVisible();
    await expect(page.locator('.flow-row.flow-branch', { hasText: 'Render path' }).first()).toBeVisible();

    // types.ts / index.ts are never drawn; a shared file is drawn once per route tree, then dimmed and marked.
    await expect(page.locator('[data-testid="flow-row"]', { hasText: /^\s*types\b/ })).toHaveCount(0);
    const shared = page.locator('[data-testid="flow-row"].shared');
    await expect(shared).toHaveCount(1);
    await expect(shared).toContainText('shown above');
    await expect(shared).toContainText('CurrencyLabel');
    await expect(page.locator('.flow-row .flow-name', { hasText: 'CurrencyLabel' })).toHaveCount(4);
    await widenBrowser(page);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'flow-browser-tree.png') });
  });

  test('selecting a row tags what it uses and what uses it, in words; hover explains the layer relationship', async ({ page }) => {
    await openFlow(page, 'billing');
    await row(page, 'BillingWorkflow').first().click();
    await expect(row(page, 'BillingWorkflow').first()).toHaveAttribute('aria-selected', 'true');
    const first = page.locator('[data-testid="flow-row"][data-kind="route"]').first();
    await expect(first).toBeVisible();
    const usesSel = row(page, 'useBilling').first();
    await expect(usesSel).toHaveAttribute('data-relation', 'usedBy');
    await expect(usesSel).toContainText('uses selection');
    for (const name of ['billingService', 'billingRules']) {
      await expect(row(page, name).first()).toHaveAttribute('data-relation', 'uses');
      await expect(row(page, name).first()).toContainText('selection uses this');
    }
    await expect(row(page, 'BillingController').first()).toContainText('uses selection');
    // Not by colour alone: a left edge in addition to the words.
    await expect(usesSel).not.toHaveCSS('border-left-color', 'rgba(0, 0, 0, 0)');
    // Unrelated rows carry no tag.
    await expect(row(page, 'BillingPage').first()).not.toHaveAttribute('data-relation', /.+/);

    await row(page, 'BillingView').first().hover();
    await expect(page.getByTestId('flow-tip-relation')).toHaveText('page -> component');
    await expect(page.getByTestId('flow-tip-path')).toContainText('features/billing/components/BillingView.tsx');
    // Cross-feature: the features are named, not the layers.
    await row(page, 'CurrencyLabel').first().hover();
    await expect(page.getByTestId('flow-tip-relation')).toHaveText('billing -> shared');
    await widenBrowser(page);
    await row(page, 'CurrencyLabel').first().hover();
    await expect(page.getByTestId('flow-tip-relation')).toHaveText('billing -> shared');
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'flow-browser-selection.png') });
  });

  test('Ctrl-click opens the file with the same reference trail as Navigate; a plain click does not', async ({ page }) => {
    await openFlow(page, 'billing');
    await row(page, 'useBilling').first().click();
    await expect(page.getByTestId('flow-peek')).toHaveCount(0);

    await row(page, 'useBilling').first().click({ modifiers: ['Control'] });
    await expect(page.getByTestId('flow-peek-file')).toHaveText('features/billing/hooks/useBilling.ts');
    await expect(page.locator('[data-testid="flow-peek"] [data-testid="linked-code"]')).toContainText('BillingWorkflow');

    // The trail and links are #321's: follow a reference with Ctrl+click and the trail grows.
    await page.locator('[data-testid="flow-peek"] .ref-link').first().click({ modifiers: ['Control'] });
    await expect(page.locator('[data-testid="flow-peek"] [data-testid="trail-current"]')).toHaveText('billingWorkflow');
    await expect(page.getByTestId('flow-peek-file')).toHaveText('features/billing/workflows/BillingWorkflow.ts');
    await widenBrowser(page);
    await page.getByTestId('flow-peek').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'flow-browser-open-file.png') });
  });

  test('a feature no route reaches shows an info note (not a warning) and no routes', async ({ page }) => {
    await openFlow(page, 'ui-kit');
    await expect(page.getByTestId('flow-no-routes')).toContainText('Not entered from any route');
    const note = page.getByTestId('flow-note-no-route');
    await expect(note).toContainText('No route reaches this feature');
    await expect(note.locator('.flow-note-i')).toHaveText('i');
    await expect(page.locator('[data-testid="flow-row"][data-kind="route"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="flow-view"] [role="alert"]')).toHaveCount(0);
    await widenBrowser(page);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'flow-browser-no-route.png') });
  });

  test('the choice is remembered per project across a reload, and switching back shows the Files list', async ({ page }) => {
    await gotoCockpit(page, '/pages');
    await expect(switchTo(page, 'Files')).toHaveAttribute('aria-checked', 'true'); // nothing chosen yet in this context
    await switchTo(page, 'Flow').click();
    await page.reload();
    await expect(switchTo(page, 'Flow')).toHaveAttribute('aria-checked', 'true');
    await pickFeature(page, 'billing');
    await expect(page.getByTestId('flow-tree')).toBeVisible();

    await switchTo(page, 'Files').click();
    await expect(page.locator('.pages-browser')).toContainText('pages/ in "billing"');
    await page.reload();
    await expect(switchTo(page, 'Files')).toHaveAttribute('aria-checked', 'true');
  });

  test('the server refuses an unknown feature and path-shaped names, and returns only project-relative paths', async ({ request }) => {
    expect((await request.get(`${API_BASE}/api/flow/nope`)).status()).toBe(404);
    expect((await request.get(`${API_BASE}/api/flow/${encodeURIComponent('../orders')}`)).status()).toBe(400);
    expect((await request.get(`${API_BASE}/api/flow/${encodeURIComponent('/etc/passwd')}`)).status()).toBe(400);
    const ok = await request.get(`${API_BASE}/api/flow/billing`);
    expect(ok.status()).toBe(200);
    const text = await ok.text();
    expect(text).not.toContain(projectDir);
    expect((await request.get(`${API_BASE}/api/nav/file?feature=billing&path=${encodeURIComponent('../../etc/passwd')}`)).status()).toBe(404);
    expect((await request.get(`${API_BASE}/api/nav/file?feature=billing&path=${encodeURIComponent('features/billing/types.ts')}`)).status()).toBe(404);
  });
});
