import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(__dirname, '../screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const API_BASE = process.env.E2E_API_BASE || 'http://localhost:4000';
const FIXTURE = path.resolve(__dirname, '../../../fixtures/impact-shared');

// #381 — Inspector "Change" tab, end to end against a REAL throwaway git repository (the impact-shared
// fixture, which already has `features/billing/pages/BillingPage.tsx` imported by exactly one other file,
// `features/billing/controllers/BillingController.tsx` — real provenance to show, a real one-file checklist
// to toggle). Nothing is mocked: the preview is the real dry run of `construct refactor move|rename`, and
// Approve is the real Plan-mode `/api/plan/run`, proven the same way plan-mode.spec.js proves it — the
// working tree is untouched until an approval, watched in the real Processes drawer.
test.describe.serial('Inspector Change tab: Move, Rename, Extract, Wrap in (#381)', () => {
  let repo;
  let originalDir;
  let previewServer;
  let previewPort;
  const git = (...args) => execFileSync('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: repo, encoding: 'utf8' });

  test.beforeAll(async ({ request }) => {
    originalDir = (await (await request.get(`${API_BASE}/api/settings`)).json()).projectDir;
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'og381-change-'));
    fs.cpSync(FIXTURE, repo, { recursive: true });
    git('init', '-q', '-b', 'main');
    git('add', '-A');
    git('commit', '-q', '-m', 'base');
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir: repo } });

    // A stand-in for the target dev server (own port, taken from the OS): just enough for the live
    // preview to reach "up" and show the frame, which is what the impact-preview card is drawn over.
    previewServer = http.createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><html><body><h1>Billing</h1></body></html>'); });
    previewPort = await new Promise((resolve) => previewServer.listen(0, '127.0.0.1', () => resolve(previewServer.address().port)));
  });

  test.afterAll(async ({ request }) => {
    previewServer?.close();
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

  async function openChangeTab(page) {
    const tools = page.getByRole('complementary', { name: 'Tools' });
    await tools.getByRole('tab', { name: 'Change' }).click();
    return tools;
  }

  test('Extract and "Wrap in..." have no block yet and are offered disabled, AI-only', async ({ page }) => {
    await openBillingPage(page);
    const tools = await openChangeTab(page);

    await expect(tools.getByTestId('change-verb-move')).toBeEnabled();
    await expect(tools.getByTestId('change-verb-rename')).toBeEnabled();
    await expect(tools.getByTestId('change-verb-extract')).toBeDisabled();
    await expect(tools.getByTestId('change-verb-wrap')).toBeDisabled();

    await tools.getByTestId('change-verb-extract').click({ force: true });
    // A disabled button never actually presses (onClick guards on `available` too), so the tab stays on Move.
    await expect(tools.getByTestId('change-verb-move')).toHaveAttribute('aria-pressed', 'true');
  });

  test('Rename: steps with provenance, a per-file checklist, nothing written until Approve', async ({ page }) => {
    const before = git('status', '--porcelain=v2', '--untracked-files=all');
    await openBillingPage(page);
    const tools = await openChangeTab(page);

    await tools.getByTestId('change-verb-rename').click();
    await tools.getByTestId('change-arg-rename').fill('BillingSummary');
    await tools.getByTestId('change-preview-btn').click();

    const step = tools.getByTestId('change-step');
    await expect(step).toContainText('Rename Billing to BillingSummary');
    await expect(step).toContainText('construct refactor rename');

    const checklistHeader = tools.getByTestId('change-checklist-header');
    await expect(checklistHeader).toContainText('1 of 1');
    const fileRow = tools.getByTestId('change-file-features/billing/controllers/BillingController.tsx');
    await expect(fileRow).toBeVisible();
    await expect(fileRow).toBeChecked();

    // Nothing on disk yet: this was a dry run.
    expect(fs.existsSync(path.join(repo, 'features/billing/pages/BillingSummaryPage.tsx'))).toBe(false);
    expect(git('status', '--porcelain=v2', '--untracked-files=all')).toEqual(before);

    await page.screenshot({ path: path.join(SHOTS, '381-change-rename-preview.png') });

    // Deselect the only file: Approve is disabled at 0 of 1, so nothing can be started with an empty checklist.
    await fileRow.uncheck();
    await expect(checklistHeader).toContainText('0 of 1');
    await expect(tools.getByTestId('change-approve')).toBeDisabled();

    // Re-select it and approve for real: this is the real Plan-mode pipeline (POST /api/plan/run).
    await fileRow.check();
    await expect(tools.getByTestId('change-approve')).toBeEnabled();
    await tools.getByTestId('change-approve').click();

    await expect(tools.getByTestId('change-started')).toBeVisible();
    const drawer = page.getByRole('region', { name: 'Bottom panel: Run' });
    await expect(drawer.getByRole('tab', { name: /Processes/ })).toHaveAttribute('aria-selected', 'true');
    await expect(drawer.getByTestId('process-row').filter({ hasText: 'Rename Billing to BillingSummary' })).toHaveCount(1);

    // The bot works in its own worktree/branch; the real project tree is still untouched until an approval there.
    expect(git('status', '--porcelain=v2', '--untracked-files=all')).toEqual(before);
    expect(fs.existsSync(path.join(repo, 'features/billing/pages/BillingSummaryPage.tsx'))).toBe(false);

    await page.screenshot({ path: path.join(SHOTS, '381-change-approved.png') });
  });

  test('Move: the impact preview is drawn on the live app stage while a change is pending, and clears on Discard', async ({ page }) => {
    await openBillingPage(page);
    await page.getByLabel('Preview URL').fill(`http://127.0.0.1:${previewPort}/`);
    await page.getByRole('button', { name: 'Load preview' }).click();
    const frame = page.frameLocator('iframe[title="Live app preview"]');
    await expect(frame.locator('h1')).toBeVisible();

    const tools = await openChangeTab(page);
    await tools.getByTestId('change-verb-move').click();
    await tools.getByTestId('change-arg-move').selectOption('component');
    await tools.getByTestId('change-preview-btn').click();

    await expect(tools.getByTestId('change-step')).toContainText('construct refactor move');
    await expect(tools.getByTestId('change-checklist-header')).toContainText('1 of 1');

    // #381 acceptance: "impact preview drawn on the live preview" — a dashed card over the stage naming every
    // file the pending change touches, live-updating with the same checklist (not per-element boxes yet: the
    // preview plugin has no rect-report postMessage protocol to place those on the real DOM nodes — see the
    // component's own comment on this scoping call).
    const impact = page.getByTestId('change-impact-preview');
    await expect(impact).toBeVisible();
    await expect(impact).toContainText('Move Billing to component');
    await expect(impact).toContainText('features/billing/controllers/BillingController.tsx');
    await page.screenshot({ path: path.join(SHOTS, '381-change-impact-preview.png') });

    await tools.getByTestId('change-discard').click();
    await expect(impact).not.toBeVisible();
  });
});
