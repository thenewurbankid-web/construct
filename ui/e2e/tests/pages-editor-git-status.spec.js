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

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });

// #829 (design 8.2's Git row): a single quiet dot on the page's root tree row when it differs from
// `main` -- the common real case is the Cockpit's own session-branch-per-save model, not an
// uncommitted edit, so the fixture commits on a branch past `main` exactly the way a real save does.
test.describe.serial('Tree-row Git-changed dot (#829)', () => {
  let repo;
  let originalDir;

  test.beforeAll(async ({ request }) => {
    originalDir = (await (await request.get(`${API_BASE}/api/settings`)).json()).projectDir;
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'og829-git-status-'));
    fs.cpSync(FIXTURE, repo, { recursive: true });
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'base');
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir: repo } });
  });

  test.afterAll(async ({ request }) => {
    if (originalDir) await request.post(`${API_BASE}/api/settings`, { data: { projectDir: originalDir } });
    fs.rmSync(repo, { recursive: true, force: true });
  });

  async function openPage(page, name) {
    await page.goto('/pages');
    await expect(page.locator('h1')).toHaveText('Pages Editor');
    await page.locator('.pages-browser select').selectOption(name);
    const openButton = page.getByRole('button', { name: `${name === 'billing' ? 'Billing' : 'Checkout'}Page.tsx` });
    await expect(openButton).toBeVisible({ timeout: 10_000 });
    await openButton.click();
    await expect(page.locator('.tree-panel')).toBeVisible();
  }

  test('unchanged since main: no dot', async ({ page }) => {
    await openPage(page, 'billing');
    const browser = page.getByRole('complementary', { name: 'Left panel: Browse' });
    await expect(browser.getByTestId('tree-node-dot-git')).toHaveCount(0);
  });

  test('a real commit on a session branch past main shows the dot on the root row — never a chip, and never on the selected row', async ({ page }) => {
    git(repo, 'checkout', '-q', '-b', 'session');
    const billingPage = path.join(repo, 'features/billing/pages/BillingPage.tsx');
    fs.writeFileSync(billingPage, `${fs.readFileSync(billingPage, 'utf8')}\n// edited`);
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'edit');

    await openPage(page, 'billing');
    const browser = page.getByRole('complementary', { name: 'Left panel: Browse' });
    const dot = browser.getByTestId('tree-node-dot-git');
    await expect(dot).toBeVisible();
    await expect(dot).toHaveCount(1);
    await expect(dot).toHaveAttribute('title', 'Changed vs main');
    await page.screenshot({ path: path.join(SHOTS, '829-git-status-dot.png') });

    // Selecting that row drops the dot (chips only on the selected row; the dot is for unselected rows).
    await dot.locator('xpath=ancestor::div[contains(@class,"tree-node")]').click();
    await expect(browser.getByTestId('tree-node-dot-git')).toHaveCount(0);

    // A different, untouched page stays clean.
    await openPage(page, 'checkout');
    await expect(page.getByRole('complementary', { name: 'Left panel: Browse' }).getByTestId('tree-node-dot-git')).toHaveCount(0);
  });
});
