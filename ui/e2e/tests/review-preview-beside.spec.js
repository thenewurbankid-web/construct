import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gotoCockpit } from './support/cockpit.js';

// #838 (design 8's "Preview beside" on the Git screen), end to end: a real throwaway git repo with a real
// branch, the toggle off by default, and the shared `@/features/live-preview` panel (#837) rendered beside
// the change view -- not a new/duplicated preview implementation.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(__dirname, '../screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const API_BASE = process.env.E2E_API_BASE || 'http://localhost:4000';
const FIXTURE = path.resolve(__dirname, '../../../fixtures/impact-shared');
const CHANGE = '/review?base=main&head=feat%2Fbilling-notes';

test.describe.serial('"Preview beside" on the Git screen (#838)', () => {
  let repo;
  let originalDir;

  test.beforeAll(async ({ request }) => {
    originalDir = (await (await request.get(`${API_BASE}/api/settings`)).json()).projectDir;
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'og838-preview-beside-'));
    fs.cpSync(FIXTURE, repo, { recursive: true });
    const git = (...args) => execFileSync('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@example.invalid', ...args], { cwd: repo, encoding: 'utf8' });
    git('init', '-q', '-b', 'main');
    git('add', '-A');
    git('-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'base');
    git('checkout', '-q', '-b', 'feat/billing-notes');
    fs.writeFileSync(path.join(repo, 'features/billing/pages/BillingPage.tsx'), `${fs.readFileSync(path.join(repo, 'features/billing/pages/BillingPage.tsx'), 'utf8')}\n// a trivial change\n`);
    git('add', '-A');
    git('-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'a trivial change');
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir: repo } });
  });

  test.afterAll(async ({ request }) => {
    if (originalDir) await request.post(`${API_BASE}/api/settings`, { data: { projectDir: originalDir } });
    fs.rmSync(repo, { recursive: true, force: true });
  });

  test('off by default; toggling it on shows the shared live-preview panel beside the change, off again hides it', async ({ page }) => {
    await gotoCockpit(page, CHANGE);
    await expect(page.getByTestId('review-headline')).toBeVisible({ timeout: 90_000 });

    const toggle = page.getByTestId('review-preview-toggle');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('review-preview-beside')).toHaveCount(0);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    const beside = page.getByTestId('review-preview-beside');
    await expect(beside).toBeVisible();
    // The shared panel, not a new one: its own toolbar heading and URL field.
    await expect(beside.getByRole('heading')).toContainText('Live app preview');
    await expect(beside.locator('input[aria-label="Preview URL"]')).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, '838-preview-beside.png') });

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('review-preview-beside')).toHaveCount(0);
  });
});
