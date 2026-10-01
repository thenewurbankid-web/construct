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

// #379 (design 8.2's "Impact" inspector section), end to end against the real `impact-shared`
// fixture the engine's own goldens use (#288): a page nobody else imports starts at "0 features",
// and a real new import edge from another feature's page is what moves that count -- nothing here
// is a hardcoded label.
test.describe.serial('Inspector Impact section (#379)', () => {
  let repo;
  let originalDir;

  test.beforeAll(async ({ request }) => {
    originalDir = (await (await request.get(`${API_BASE}/api/settings`)).json()).projectDir;
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'og379-impact-'));
    fs.cpSync(FIXTURE, repo, { recursive: true });
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
    // Impact is shown for whichever node is selected (#379); nothing is selected on open.
    await page.locator('.tree-node').first().click();
  }

  test('a page nobody else imports shows "0 features", collapsed with a one-line summary', async ({ page }) => {
    await openBillingPage(page);
    const tools = page.getByRole('complementary', { name: 'Right panel: Inspect' });
    const impact = tools.getByTestId('impact-panel');
    await expect(impact).toBeVisible();
    await expect(impact.getByTestId('impact-count')).toHaveText('0 features');
    // Collapsed by default (the pal-group disclosure every other inspector section but Props uses).
    await expect(impact.getByTestId('impact-feature-list')).toHaveCount(0);

    await impact.locator('summary').click();
    await expect(impact).toContainText('No other feature imports this file.');
    await page.screenshot({ path: path.join(SHOTS, '379-impact-section.png') });
  });

  test('a real new import from another feature moves the count — not a hardcoded label', async ({ page }) => {
    const checkoutPage = path.join(repo, 'features/checkout/pages/CheckoutPage.tsx');
    const before = fs.readFileSync(checkoutPage, 'utf8');
    fs.writeFileSync(checkoutPage, `import '../../billing/pages/BillingPage';\n${before}`);
    try {
      await openBillingPage(page);
      const tools = page.getByRole('complementary', { name: 'Right panel: Inspect' });
      const impact = tools.getByTestId('impact-panel');
      await expect(impact.getByTestId('impact-count')).toHaveText('1 feature');
      await impact.locator('summary').click();
      await expect(impact.getByTestId('impact-feature-list')).toContainText('checkout');
    } finally {
      fs.writeFileSync(checkoutPage, before);
    }
  });
});
