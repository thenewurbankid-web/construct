import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(__dirname, '../screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const API_BASE = process.env.E2E_API_BASE || 'http://localhost:4000';
const FIXTURE = path.resolve(__dirname, '../../../fixtures/impact-shared');

// #833 (design 8.2's inline rule-violation callout), end to end against a REAL architecture-enforcer rule
// (PAGE-004, "Page calls fetch()") -- not a fixture string. The `fetch()` call sits on the <button>'s own
// line, so selecting <button> (or its ancestor <section>, whose subtree contains it) shows the violation;
// selecting the unrelated <span> sibling shows none -- the scoping is real, not hardcoded.
test.describe.serial('Inspector rule-violation callout (#833)', () => {
  let repo;
  let originalDir;

  test.beforeAll(async ({ request }) => {
    originalDir = (await (await request.get(`${API_BASE}/api/settings`)).json()).projectDir;
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'og833-diagnostics-'));
    fs.cpSync(FIXTURE, repo, { recursive: true });
    fs.writeFileSync(
      path.join(repo, 'features/billing/pages/BillingPage.tsx'),
      "export function BillingPage() {\n  return (\n    <section>\n      <span>Hello</span>\n      <button onClick={() => fetch('/api/orders')}>Go</button>\n    </section>\n  );\n}\n",
    );
    execFileSync('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@example.invalid', 'init', '-q', '-b', 'main'], { cwd: repo });
    execFileSync('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@example.invalid', 'add', '-A'], { cwd: repo });
    execFileSync('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'base'], { cwd: repo });
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir: repo } });
  });

  test.afterAll(async ({ request }) => {
    if (originalDir) await request.post(`${API_BASE}/api/settings`, { data: { projectDir: originalDir } });
    fs.rmSync(repo, { recursive: true, force: true });
  });

  async function openBillingPage(page) {
    await page.goto('/pages');
    await expect(page.locator('h1')).toHaveText('Pages Editor');
    await page.locator('.pages-browser select').selectOption('billing');
    const openButton = page.getByRole('button', { name: 'BillingPage.tsx' });
    await expect(openButton).toBeVisible({ timeout: 10_000 });
    await openButton.click();
    await expect(page.locator('.tree-panel')).toBeVisible();
  }

  test('a sibling with no violation on its own lines shows "0 violations"', async ({ page }) => {
    await openBillingPage(page);
    await page.locator('.tree-node').filter({ hasText: '<span>' }).click();
    const tools = page.getByRole('complementary', { name: 'Right panel: Inspect' });
    const panel = tools.getByTestId('node-diagnostics-panel');
    await expect(panel).toBeVisible();
    await expect(panel.getByTestId('node-diagnostics-count')).toHaveText('0 violations');
    await panel.locator('summary').click();
    await expect(panel).toContainText('No violations on this element.');
  });

  test('the element whose own line calls fetch() shows the real PAGE-004 violation, text-labelled', async ({ page }) => {
    await openBillingPage(page);
    await page.locator('.tree-node').filter({ hasText: '<button>' }).click();
    const tools = page.getByRole('complementary', { name: 'Right panel: Inspect' });
    const panel = tools.getByTestId('node-diagnostics-panel');
    await expect(panel.getByTestId('node-diagnostics-count')).toHaveText('1 violation');
    await panel.locator('summary').click();
    const list = panel.getByTestId('node-diagnostics-list');
    await expect(list).toContainText('Page calls fetch()');
    await expect(list).toContainText('Error');
    await page.screenshot({ path: path.join(SHOTS, '833-node-diagnostics.png') });
  });

  test('an ancestor whose subtree contains the violation shows it too', async ({ page }) => {
    await openBillingPage(page);
    await page.locator('.tree-node').filter({ hasText: '<section>' }).click();
    const tools = page.getByRole('complementary', { name: 'Right panel: Inspect' });
    const panel = tools.getByTestId('node-diagnostics-panel');
    await expect(panel.getByTestId('node-diagnostics-count')).toHaveText('1 violation');
  });
});
