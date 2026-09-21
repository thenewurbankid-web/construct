import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gotoCockpit } from './support/cockpit.js';

// Plan mode (#289 note, impact and run; #332 plan review and edit), end to end in a real browser against a
// REAL throwaway git repository (the impact-shared fixture). Nothing is mocked: the impact is the real
// analyzeImpact, the verdict on every edit is the server's real validatePlan(), and Run creates a real process
// that the real bot runner executes in its own worktree, watched in the real Processes drawer.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(__dirname, '../screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const API = process.env.E2E_API_BASE || 'http://localhost:4000';
const FIXTURE = path.resolve(__dirname, '../../../fixtures/impact-shared');
const TICKET = 'The billing totals are wrong when checkout applies a discount';

const step = (page, n) => page.getByTestId('plan-step').nth(n);
const stepErrors = (page, n) => step(page, n).getByTestId('plan-step-errors');

test.describe.serial('Plan mode (#289, #332)', () => {
  let repo;
  let originalDir;
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });

  test.beforeAll(async ({ request }) => {
    originalDir = (await (await request.get(`${API}/api/settings`)).json()).projectDir;
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'og289-plan-'));
    fs.cpSync(FIXTURE, repo, { recursive: true });
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'e2e@example.com');
    git('config', 'user.name', 'E2E');
    git('config', 'commit.gpgsign', 'false');
    git('add', '-A');
    git('commit', '-q', '-m', 'base');
    await request.post(`${API}/api/settings`, { data: { projectDir: repo } });
  });

  test.afterAll(async ({ request }) => {
    if (originalDir) await request.post(`${API}/api/settings`, { data: { projectDir: originalDir } });
    fs.rmSync(repo, { recursive: true, force: true });
  });

  test('Plan leads to the Plan screen, whose left pane shows the note and the constraints from architecture.yml', async ({ page }) => {
    await gotoCockpit(page, '/plan');
    // #369: the plan lives on the Features screen (Plan is no longer a mode).
    const nav = page.getByRole('navigation', { name: 'Screens', exact: true });
    await expect(nav.getByRole('link', { name: 'Features' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('plan-ticket')).toBeVisible();
    // #366: the user-visible word is Notes, never "ticket".
    await expect(page.getByTestId('plan-ticket')).toContainText('Notes');
    await expect(page.getByLabel('Note title')).toBeVisible();
    await expect(page.getByLabel('Note text')).toBeVisible();
    await expect(page.getByTestId('plan-ticket')).not.toContainText(/ticket/i);
    await expect(page.getByTestId('plan-constraints')).toContainText('nextjs');
    await expect(page.getByTestId('plan-rule').filter({ hasText: 'SLICE-002' })).toBeVisible();
    // The empty states are designed, not blank.
    await expect(page.getByTestId('plan-impact-empty')).toContainText('No impact yet');
    await expect(page.getByTestId('plan-empty')).toContainText('No steps yet');
    await expect(page.getByTestId('plan-run')).toBeDisabled();
    await page.screenshot({ path: path.join(SHOTS, '366-notes-plan-screen.png') });
  });

  test('a note becomes proposals you confirm, then a deterministic impact with derived and inferred rows', async ({ page }) => {
    await gotoCockpit(page, '/plan');
    await page.getByTestId('plan-ticket-title').fill('Fix billing totals');
    await page.getByTestId('plan-ticket-body').fill(TICKET);
    await expect(page.getByTestId('plan-analyse')).toBeDisabled();

    await page.getByTestId('plan-propose').click();
    await expect(page.getByTestId('plan-proposal').first()).toContainText('inferred');
    await expect(page.getByTestId('plan-proposal').filter({ hasText: 'feature:billing' })).toHaveCount(1);
    // A proposal is not used until it is confirmed.
    await expect(page.getByTestId('plan-analyse')).toBeDisabled();
    const confirm = page.getByTestId('plan-proposal').filter({ hasText: 'feature:billing' }).getByTestId('plan-proposal-confirm');
    await confirm.click();
    await expect(confirm).toBeChecked();
    await page.getByTestId('plan-pick-checkout').click();
    await page.getByTestId('plan-analyse').click();

    await expect(page.getByTestId('plan-impact')).toBeVisible();
    await expect(page.getByTestId('plan-impact-headline')).toContainText('DETERMINISTIC');
    await expect(page.getByTestId('plan-impact-headline')).toContainText('you picked');
    await expect(page.getByTestId('plan-impact-file').first()).toBeVisible();
    // Provenance: what was picked is derived; what depends on the confirmed guess is inferred.
    await expect(page.getByTestId('plan-impact-file').getByTestId('plan-provenance').filter({ hasText: 'derived' }).first()).toBeVisible();
    await expect(page.getByTestId('plan-impact-features').getByTestId('plan-provenance').first()).toBeVisible();
    await expect(page.getByTestId('plan-impact-file').filter({ hasText: 'features/billing/domain/billingRules.ts' })).toHaveCount(1);
    await page.screenshot({ path: path.join(SHOTS, '289-plan-impact.png') });
  });

  test('build a plan: add, reorder, re-tag, and see a plain error next to the step until it is valid', async ({ page }) => {
    await gotoCockpit(page, '/plan');
    await page.getByTestId('plan-ticket-title').fill('Wishlist');
    await page.getByTestId('plan-ticket-body').fill(TICKET);
    await page.getByTestId('plan-pick-billing').click();
    await page.getByTestId('plan-analyse').click();
    await expect(page.getByTestId('plan-impact')).toBeVisible();

    // The impact hands the plan concrete read-only steps to start from.
    await page.getByTestId('plan-add-suggested').click();
    await expect(page.getByTestId('plan-step').first()).toBeVisible();
    const suggested = await page.getByTestId('plan-step').count();
    expect(suggested).toBeGreaterThanOrEqual(1);

    // Add a writing step from the catalogue: it has no name yet, so it says so and Run stays off.
    await page.getByTestId('plan-add-flow').selectOption('create.feature');
    await page.getByTestId('plan-add').click();
    const last = suggested;
    await expect(page.getByTestId('plan-step')).toHaveCount(suggested + 1);
    await expect(stepErrors(page, last)).toContainText('requires the "name" argument');
    await expect(page.getByTestId('plan-run')).toBeDisabled();
    await expect(page.getByTestId('plan-run-blocked')).toContainText('Fix the errors');

    // The exact command appears the moment the step is complete.
    await step(page, last).getByTestId('plan-arg-name').fill('Wishlist');
    await expect(step(page, last).getByTestId('plan-step-command')).toHaveText('construct create feature Wishlist');
    await expect(step(page, last).getByTestId('plan-step-touches')).toContainText('Wishlist');
    await expect(page.getByTestId('plan-run')).toBeEnabled();

    // Reorder: move the new step to the top; the numbers follow.
    for (let i = last; i > 0; i -= 1) await step(page, i).getByTestId('plan-step-up').click();
    await expect(step(page, 0)).toHaveAttribute('data-flow', 'create.feature');
    await expect(step(page, 0).getByTestId('plan-step-n')).toHaveText('1');

    // Re-tag a read-only step to "Local model": that flow has no model path, and the validator says so, next to it.
    const readOnly = page.locator('[data-testid="plan-step"]:not([data-flow="create.feature"])').first();
    await readOnly.getByTestId('plan-tag-local-model').click();
    await expect(readOnly.getByTestId('plan-step-errors')).toContainText('cannot be executed by "local-model"');
    await expect(page.getByTestId('plan-run')).toBeDisabled();
    await readOnly.getByTestId('plan-step-errors').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SHOTS, '332-plan-invalid.png') });
    await readOnly.getByTestId('plan-tag-deterministic').click();
    await expect(readOnly.getByTestId('plan-step-errors')).toHaveCount(0);
    await expect(page.getByTestId('plan-run')).toBeEnabled();

    // A deterministic step may not smuggle a model in through its arguments.
    await page.getByTestId('plan-add-flow').selectOption('create.unit');
    await page.getByTestId('plan-add').click();
    const unit = page.getByTestId('plan-step').last();
    await unit.getByTestId('plan-arg-layer').fill('domain');
    await unit.getByTestId('plan-arg-name').fill('wishlistRules');
    await unit.getByTestId('plan-arg-feature').fill('billing');
    await unit.getByTestId('plan-arg-llm').fill('ollama');
    await expect(unit.getByTestId('plan-step-errors')).toContainText('tag it "local-model"');
    await expect(page.getByTestId('plan-run')).toBeDisabled();
    // Tagged Local model, the same step is valid, and the plan says BEFORE running that a model is used.
    await unit.getByTestId('plan-tag-local-model').click();
    await expect(unit.getByTestId('plan-step-errors')).toHaveCount(0);
    await expect(page.getByTestId('plan-model-notice')).toContainText('the local model');
    await expect(unit.getByTestId('plan-step-model')).toBeVisible();
    // A hosted model is refused outright.
    await unit.getByTestId('plan-arg-llm').fill('claude');
    await expect(unit.getByTestId('plan-step-errors')).toContainText('Only the local model');
    // Remove it again.
    await unit.getByTestId('plan-step-remove').click();
    await expect(page.getByTestId('plan-step')).toHaveCount(suggested + 1);
    await expect(page.getByTestId('plan-run')).toBeEnabled();
  });

  test('Run plan starts a process that appears in the Processes drawer; nothing reaches the project tree', async ({ page }) => {
    const before = git('status', '--porcelain=v2', '--untracked-files=all');
    await gotoCockpit(page, '/plan');
    await page.getByTestId('plan-ticket-title').fill('Add a wishlist feature');
    await page.getByTestId('plan-add-flow').selectOption('summarize.list');
    await page.getByTestId('plan-add').click();
    await page.getByTestId('plan-add-flow').selectOption('create.feature');
    await page.getByTestId('plan-add').click();
    await step(page, 1).getByTestId('plan-arg-name').fill('Wishlist');
    await step(page, 0).getByTestId('plan-arg-kind').fill('feature');
    await expect(step(page, 0).getByTestId('plan-step-command')).toHaveText('construct summarize --list --kind feature');
    await expect(page.getByTestId('plan-run')).toBeEnabled();
    await page.getByTestId('plan-run').click();

    await expect(page.getByTestId('plan-started')).toBeVisible();
    const drawer = page.getByRole('region', { name: 'Drawer' });
    await expect(drawer.getByRole('tab', { name: /Processes/ })).toHaveAttribute('aria-selected', 'true');
    await expect(drawer.getByTestId('process-row').filter({ hasText: 'Add a wishlist feature' })).toHaveCount(1);
    await page.screenshot({ path: path.join(SHOTS, '289-plan-run.png') });
    // The bot works in its own worktree and branch; the project tree is untouched until an approval.
    expect(git('status', '--porcelain=v2', '--untracked-files=all')).toEqual(before);
    expect(fs.existsSync(path.join(repo, 'features', 'Wishlist'))).toBe(false);
  });

  test('a plan the server refuses is not run, even if the browser is talked into sending it', async ({ page, request }) => {
    await gotoCockpit(page, '/plan');
    const bad = { version: 1, ticket: { source: 'text', title: 'x' }, steps: [{ id: 's1', title: 'Page', flow: 'create.page.from', args: { name: 'P', feature: 'billing', from: '../../etc/passwd' }, executor: 'deterministic', touches: { features: [], files: [] } }] };
    const res = await page.evaluate(([api, plan]) => fetch(`${api}/api/plan/run`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan }) }).then(async (r) => ({ status: r.status, body: await r.json() })), [API, bad]);
    expect(res.status).toBe(400);
    expect(res.body.errors.some((e) => e.code === 'COCKPIT_ARG_PATH')).toBe(true);
    const listed = await (await request.get(`${API}/api/processes`)).json();
    expect(listed.processes.filter((p) => p.title === 'x')).toHaveLength(0);
  });

  test('on a phone the screen is one pane at a time with no sideways scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await gotoCockpit(page, '/plan');
    await expect(page.getByTestId('plan-stage')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: path.join(SHOTS, '289-plan-narrow.png') });
  });
});
