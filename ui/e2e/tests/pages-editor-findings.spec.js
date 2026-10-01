import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gotoCockpit } from './support/cockpit.js';

// #831 (design 8.2's "Findings" inspector section), end to end: the SAME Review data (prHealth, #315's own
// `feat/billing-hooks` fixture branch, where `Leaky.tsx` reaches straight into a service -- a real conversation
// finding, not a fixture string), reused as a per-file Inspector section. Nothing here starts a new analysis
// from the Pages editor itself -- only visiting /review (as the first test does NOT) does that.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(__dirname, '../screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const API_BASE = process.env.E2E_API_BASE || 'http://localhost:4000';
const FIXTURE = path.resolve(__dirname, '../../../fixtures/impact-shared');
const CHANGE = '/review?base=main&head=feat%2Fbilling-hooks';

test.describe.serial('Inspector Findings section (#831)', () => {
  let repo;
  let originalDir;
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    fs.writeFileSync(path.join(repo, rel), text);
  };
  const commit = (msg) => {
    git('add', '-A');
    git('-c', 'user.email=e2e@example.com', '-c', 'user.name=E2E', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', msg);
  };

  test.beforeAll(async ({ request }) => {
    originalDir = (await (await request.get(`${API_BASE}/api/settings`)).json()).projectDir;
    repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'og831-findings-')));
    fs.cpSync(FIXTURE, repo, { recursive: true });
    git('init', '-q', '-b', 'main');
    commit('base');
    // The same scenario #315's review-findings.spec.js uses: a page reaching straight into a service is a real
    // "conversation" finding (no automated fix), scoped to exactly this file.
    git('checkout', '-q', '-b', 'feat/billing-hooks');
    write('features/billing/pages/Leaky.tsx', "import { fetchBilling } from '../services/billingService';\nexport function Leaky() { fetchBilling(); return <div />; }\n");
    commit('A leaky page');
    // `feat/billing-hooks` is the checked-out (current) branch, the same way a real session branch is.
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir: repo } });
  });

  test.afterAll(async ({ request }) => {
    if (originalDir) await request.post(`${API_BASE}/api/settings`, { data: { projectDir: originalDir } });
    fs.rmSync(repo, { recursive: true, force: true });
  });

  async function openLeakyPage(page) {
    await page.goto('/pages');
    await expect(page.locator('h1')).toHaveText('Pages Editor');
    await page.locator('.pages-browser select').selectOption('billing');
    const openButton = page.getByRole('button', { name: 'Leaky.tsx' });
    await expect(openButton).toBeVisible({ timeout: 10_000 });
    await openButton.click();
    await expect(page.locator('.tree-panel')).toBeVisible();
    await page.locator('.tree-node').first().click();
  }

  test('a file nobody has reviewed yet shows an honest "not reviewed yet", not an error', async ({ page }) => {
    await openLeakyPage(page);
    const tools = page.getByRole('complementary', { name: 'Right panel: Inspect' });
    const findings = tools.getByTestId('findings-panel');
    await expect(findings).toBeVisible();
    await expect(findings.getByTestId('findings-count')).toHaveText('not reviewed yet');
    await expect(findings.getByTestId('findings-list')).toHaveCount(0);
  });

  test('a real review finding for this file shows as a numbered item, reusing the Review screen\'s own data', async ({ page }) => {
    // Visiting /review is what starts the analysis (#315's own flow) -- the Pages editor itself never does this.
    await gotoCockpit(page, CHANGE);
    await expect(page.getByTestId('review-headline')).toBeVisible({ timeout: 90_000 });

    await openLeakyPage(page);
    const tools = page.getByRole('complementary', { name: 'Right panel: Inspect' });
    const findings = tools.getByTestId('findings-panel');
    await expect(findings).toBeVisible();
    await expect(findings.getByTestId('findings-count')).toHaveText('1 finding');
    await findings.locator('summary').click();
    const list = findings.getByTestId('findings-list');
    await expect(list.locator('li')).toHaveCount(1);
    // Numbered, not colour-only (acceptance: "text-labelled, never colour only").
    await expect(list.locator('.findings-number').first()).toHaveText('1');
    await page.screenshot({ path: path.join(SHOTS, '831-findings-section.png') });
  });
});
