import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const BIN = path.join(REPO, 'packages', 'cli', 'construct.mjs');
const SHOTS = path.resolve(__dirname, '../screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const API_BASE = process.env.E2E_API_BASE || 'http://localhost:4000';

// #830 (design 8.2/9's "Tests N pass" inspector section), end to end: no new coverage engine, just a new
// reader of the SAME /api/tests/:feature the standalone Tests screen already uses (#300).
test.describe.serial('Inspector Tests section (#830)', () => {
  let originalDir;

  test.afterEach(async ({ request }) => {
    if (originalDir) await request.post(`${API_BASE}/api/settings`, { data: { projectDir: originalDir } });
  });

  async function openPage(page, feature, buttonName) {
    await page.goto('/pages');
    await expect(page.locator('h1')).toHaveText('Pages Editor');
    await page.locator('.pages-browser select').selectOption(feature);
    const openButton = page.getByRole('button', { name: buttonName });
    await expect(openButton).toBeVisible({ timeout: 10_000 });
    await openButton.click();
    await expect(page.locator('.tree-panel')).toBeVisible();
    // The Inspector shows nothing (just "Select a tree node...") until a node is selected.
    await page.locator('.tree-node').first().click();
  }

  test('a feature with no workflow shows an honest "no coverage", not an error', async ({ page, request }) => {
    // `billing` (the #379/#829 impact-shared fixture) has a plain async function in workflows/, not a
    // state machine -- planFeatureTests can't enumerate it, so this is the real "nothing to cover yet"
    // case, not a hardcoded label.
    const FIXTURE = path.resolve(REPO, 'fixtures/impact-shared');
    originalDir = (await (await request.get(`${API_BASE}/api/settings`)).json()).projectDir;
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'og830-no-coverage-'));
    fs.cpSync(FIXTURE, repo, { recursive: true });
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir: repo } });
    try {
      await openPage(page, 'billing', 'BillingPage.tsx');
      const tools = page.getByRole('complementary', { name: 'Right panel: Inspect' });
      const tests = tools.getByTestId('tests-panel');
      await expect(tests).toBeVisible();
      await expect(tests.getByTestId('tests-count')).toHaveText('no coverage');
      await expect(tests.getByTestId('tests-coverage-list')).toHaveCount(0);
      await tests.locator('summary').click();
      await expect(tests).toContainText('This feature has no scenarios to cover yet.');
      await page.screenshot({ path: path.join(SHOTS, '830-tests-no-coverage.png') });
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  test('a feature with a real workflow shows scenario coverage, reusing the Tests screen\'s own words', async ({ page, request }) => {
    originalDir = (await (await request.get(`${API_BASE}/api/settings`)).json()).projectDir;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og830-coverage-'));
    const LAYERS = ['controllers', 'workflows', 'hooks', 'domain', 'services', 'pages', 'components'];
    for (const l of LAYERS) fs.mkdirSync(path.join(dir, 'features', 'refunds', l), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'architecture.yml'),
      'version: 1\npreset: strict-nextjs\nproject:\n  framework: nextjs\nfeatures:\n  root: features\nfrozen:\n  - features/*/tests/generated/**\nnonLayer:\n  - features/*/tests/**\n',
    );
    fs.writeFileSync(path.join(dir, 'features', 'refunds', 'types.ts'), 'export type Id = string;\n');
    fs.writeFileSync(path.join(dir, 'features', 'refunds', 'index.ts'), "export type * from './types';\n");
    fs.writeFileSync(path.join(dir, 'features', 'refunds', 'pages', 'RefundsPage.tsx'), 'export function RefundsPage() { return <div>Refunds</div>; }\n');
    fs.copyFileSync(path.join(REPO, 'fixtures/workflow-graphs/refund-request.ts'), path.join(dir, 'features', 'refunds', 'workflows', 'RefundRequestWorkflow.ts'));
    execFileSync('node', [BIN, 'generate', 'tests', 'refunds', '--dir', dir], { encoding: 'utf8' });
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir: dir } });
    try {
      await openPage(page, 'refunds', 'RefundsPage.tsx');
      const tools = page.getByRole('complementary', { name: 'Right panel: Inspect' });
      const tests = tools.getByTestId('tests-panel');
      await expect(tests).toBeVisible();
      // the same words coverageSummary() renders on the standalone Tests screen (#300's tests-tab.spec.js) --
      // nothing computed twice.
      await expect(tests.getByTestId('tests-count')).toContainText('scenarios');
      await expect(tests.getByTestId('tests-count')).toContainText('with a generated test');
      await tests.locator('summary').click();
      await expect(tests.getByTestId('tests-coverage-list')).toContainText('Happy path');
      await expect(tests.getByTestId('tests-coverage-list')).toContainText('generated test');
      await page.screenshot({ path: path.join(SHOTS, '830-tests-coverage.png') });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
