import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gotoCockpit } from './support/cockpit.js';
import { makeReviewRepo } from './support/reviewRepo.js';

// #351 -- a Review analysis is a Process: it is in the Processes drawer, it can be cancelled with the
// machine's own controls, and cancelling really stops it and cleans up after it.
//
// Run with playwright.review-processes.config.js: the server is the real one, with the review worker swapped
// for a slow fixture that REALLY checks out both commits into temporary git worktrees and holds them
// (support/review-server.mjs), so the analysis is genuinely in flight when the test cancels it.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(__dirname, '../screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const API = process.env.E2E_API_BASE || 'http://localhost:4000';
const MARKER = process.env.OG351_MARKER;

const drawer = (page) => page.getByRole('region', { name: 'Drawer' });
const readMarker = () => (fs.existsSync(MARKER) ? JSON.parse(fs.readFileSync(MARKER, 'utf8')) : null);
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const treesOf = (pid) => fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith(`construct-prhealth-${pid}-`));

test.describe.serial('Review analyses as cancellable processes (#351)', () => {
  let ctx;
  let originalDir;

  test.beforeAll(async ({ request }) => {
    originalDir = (await (await request.get(`${API}/api/settings`)).json()).projectDir;
    ctx = makeReviewRepo('og351-proc-');
    await request.post(`${API}/api/settings`, { data: { projectDir: ctx.repo } });
    fs.rmSync(MARKER, { force: true });
  });

  test.afterAll(async ({ request }) => {
    // Stop anything still running, so no worker outlives the run, then put the project back.
    const list = await (await request.get(`${API}/api/processes`)).json();
    for (const p of list.processes ?? []) if (p.controls?.includes('CANCEL')) await request.post(`${API}/api/processes/${p.id}/cancel`);
    if (originalDir) await request.post(`${API}/api/settings`, { data: { projectDir: originalDir } });
    fs.rmSync(ctx.repo, { recursive: true, force: true });
  });

  test('an analysis is in the Processes drawer, is cancelled from it, and its worker and checkouts are gone afterwards', async ({ page, request }) => {
    const before = ctx.snapshot();
    await page.goto('/review');
    await gotoCockpit(page, '/review');
    // The list says the analyses are running.
    await expect(page.getByTestId('review-analysing').first()).toBeVisible({ timeout: 30_000 });

    // The worker really holds its temporary checkouts right now: this is what cancel has to clean up.
    await expect.poll(readMarker, { timeout: 30_000 }).not.toBeNull();
    const first = readMarker();
    expect(treesOf(first.pid).length).toBeGreaterThan(0);
    expect(ctx.git('worktree', 'list', '--porcelain')).toContain(`construct-prhealth-${first.pid}-`);

    // The drawer lists it as a process, with the machine's own controls.
    const processes = (await (await request.get(`${API}/api/processes`)).json()).processes;
    expect(processes.map((p) => p.title).sort()).toEqual(['Review docs/readme against main', 'Review feat/billing-totals against main']);
    let runningTitle = null;
    for (const p of processes) {
      const detail = (await (await request.get(`${API}/api/processes/${p.id}`)).json()).process;
      if (detail.steps[0].status === 'running') runningTitle = p.title;
      expect(detail.steps[0].flow).toBe('review.analyze');
      expect(detail.artifacts).toEqual([]);
    }
    expect(runningTitle).not.toBeNull();
    await page.getByTestId('pill-processes').click();
    await expect(drawer(page)).toBeVisible();
    const row = page.getByTestId('process-row').filter({ hasText: runningTitle });
    await expect(row).toBeVisible();
    await row.click();
    await expect(page.getByTestId('process-step').first()).toHaveAttribute('data-status', 'running');
    await expect(page.getByTestId('process-step').first()).toContainText('Deterministic');
    const controls = await page.getByRole('group', { name: 'Process controls' }).getByRole('button').allTextContents();
    expect(controls).toEqual(['Pause', 'Cancel']);
    // No approval surface for it: an analysis has no files to approve.
    await expect(drawer(page).getByRole('button', { name: /approve|apply|accept|reject/i })).toHaveCount(0);
    await page.screenshot({ path: path.join(SHOTS, '351-analysis-in-drawer.png') });

    // Cancel with the drawer's own button.
    await page.getByTestId('process-cancel').click();
    await expect(page.getByTestId('process-state')).toHaveText('Cancelled');

    // The worker is gone and so is everything it had checked out.
    await expect.poll(() => alive(first.pid), { timeout: 15_000 }).toBe(false);
    await expect.poll(() => treesOf(first.pid), { timeout: 15_000 }).toEqual([]);
    expect(ctx.git('worktree', 'list', '--porcelain')).not.toContain(`construct-prhealth-${first.pid}-`);
    await page.screenshot({ path: path.join(SHOTS, '351-analysis-cancelled.png') });

    // The second analysis now runs (the engine has one slot): cancel it too, from the Review screen.
    await expect.poll(() => readMarker()?.pid, { timeout: 30_000 }).not.toBe(first.pid);
    const second = readMarker();
    expect(treesOf(second.pid).length).toBeGreaterThan(0);
    const head = runningTitle === 'Review docs/readme against main' ? 'feat/billing-totals' : 'docs/readme';
    await page.goto(`/review?base=main&head=${encodeURIComponent(head)}`);
    await expect(page.getByTestId('review-waiting')).toBeVisible();
    await expect(page.getByTestId('review-waiting')).toContainText('Processes drawer');
    await page.getByTestId('review-cancel').click();
    const notice = page.getByTestId('review-change-error');
    await expect(notice).toContainText('The analysis was cancelled');
    await expect(notice).toContainText('Nothing was changed in your repository');
    await expect(notice.getByRole('button', { name: 'Try again' })).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, '351-review-cancelled-notice.png') });
    await expect.poll(() => alive(second.pid), { timeout: 15_000 }).toBe(false);
    await expect.poll(() => treesOf(second.pid), { timeout: 15_000 }).toEqual([]);

    // Everything the analyses could have touched is byte-identical, after two cancels.
    expect(ctx.snapshot(), 'a cancelled analysis leaves status, refs, stash and worktree list untouched').toEqual(before);
    expect(ctx.git('for-each-ref', '--format=%(refname)', 'refs/heads/construct/')).toBe('');
  });

  test('a cancelled analysis stays cancelled in the list until you ask again', async ({ page, request }) => {
    const before = ctx.snapshot();
    await gotoCockpit(page, '/review');
    const cancelled = page.getByTestId('review-cancelled');
    await expect(cancelled).toHaveCount(2);
    await expect(page.getByTestId('review-analysing')).toHaveCount(0);
    await page.screenshot({ path: path.join(SHOTS, '351-list-cancelled.png') });
    const pid = readMarker().pid;
    await page.waitForTimeout(2500); // nothing restarts by itself
    expect(readMarker().pid).toBe(pid);
    await expect(cancelled).toHaveCount(2);
    // Re-analyse all is an explicit request: both start again (and are cancelled again so nothing outlives the test).
    await page.getByTestId('review-reanalyse').click();
    await expect(page.getByTestId('review-analysing').first()).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => readMarker().pid, { timeout: 30_000 }).not.toBe(pid);
    for (let i = 0; i < 2; i += 1) {
      const list = (await (await request.get(`${API}/api/processes`)).json()).processes;
      for (const p of list) if (p.controls.includes('CANCEL')) await request.post(`${API}/api/processes/${p.id}/cancel`);
      await page.waitForTimeout(1500);
    }
    await expect.poll(async () => (await (await request.get(`${API}/api/processes`)).json()).processes.filter((p) => p.controls.includes('CANCEL')).length, { timeout: 30_000 }).toBe(0);
    expect(ctx.snapshot()).toEqual(before);
  });
});
