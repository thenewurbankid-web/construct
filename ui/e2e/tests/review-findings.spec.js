import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gotoCockpit } from './support/cockpit.js';
import { createProcess } from '../../../src/engine/processModel.mjs';
import { openProcessStore } from '../../../src/engine/processStore.mjs';

// Review mode, second slice: #315 findings (mechanical fixes and conversations, visibly separated), #316
// blast radius (declared vs actual, and the no-plan state), #318 the empty, loading, error, degraded and
// narrow states. Everything is real: a throwaway git repository with real branches, the PR-health engine
// in a child process of the Cockpit server, saved plans seeded through the same process store the server
// reads. Nothing here applies a fix, posts or edits a branch: every test ends with the repository unchanged.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(__dirname, '../screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const API = process.env.E2E_API_BASE || 'http://localhost:4000';
const STATE_DIR = process.env.E2E_STATE_DIR;
const FIXTURE = path.resolve(__dirname, '../../../fixtures/impact-shared');
const CHANGE = '/review?base=main&head=feat%2Fbilling-hooks';

const planOf = (title, features, files = []) => ({
  version: 1,
  ticket: { source: 'text', title },
  steps: [{ id: 'step1', title, flow: 'create.unit', args: { layer: 'hook', name: 'Thing', feature: features[0] }, executor: 'deterministic', touches: { features, files } }],
});

test.describe.serial('Review mode: findings, scope and states (#315, #316, #318)', () => {
  let repo;
  let originalDir;
  const scratch = [];
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    fs.writeFileSync(path.join(repo, rel), text);
  };
  const commit = (msg) => {
    git('add', '-A');
    git('commit', '-q', '-m', msg);
  };
  const snapshot = () => ({ status: git('status', '--porcelain=v2', '--untracked-files=all'), worktrees: git('worktree', 'list', '--porcelain'), refs: git('for-each-ref', '--format=%(refname) %(objectname)'), stash: git('stash', 'list') });
  const useProject = (request, dir) => request.post(`${API}/api/settings`, { data: { projectDir: dir } });
  const seedPlan = (id, title, features, files) => {
    const store = openProcessStore(repo, { stateDir: STATE_DIR });
    const rec = createProcess(planOf(title, features, files), { id, projectRoot: repo, title });
    store.save({ ...rec, state: 'done', steps: rec.steps.map((s) => ({ ...s, status: 'done' })) });
  };
  const tools = (page) => page.getByRole('complementary', { name: 'Tools' });
  const openFindingsTab = async (page) => {
    await tools(page).getByRole('tab', { name: /Findings/ }).click();
    await expect(page.getByTestId('review-findings')).toBeVisible();
  };
  const waitForChange = (page) => expect(page.getByTestId('review-headline')).toBeVisible({ timeout: 90_000 });

  test.beforeAll(async ({ request }) => {
    originalDir = (await (await request.get(`${API}/api/settings`)).json()).projectDir;
    repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'og315-review-')));
    scratch.push(repo);
    fs.cpSync(FIXTURE, repo, { recursive: true });
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'e2e@example.com');
    git('config', 'user.name', 'E2E');
    git('config', 'commit.gpgsign', 'false');
    commit('base');
    // Branch 1: a hook nobody exported (mechanical, `construct sync`), a deep cross-feature import
    // (mechanical in kind, no command performs it yet) and a page reaching into a service (a conversation).
    git('checkout', '-q', '-b', 'feat/billing-hooks');
    write('features/billing/hooks/useBillingTotals.ts', 'export function useBillingTotals() { return 1; }\n');
    write('features/checkout/services/checkoutService.ts', `import { totalBilling } from '../../billing/domain/billingRules';\n${fs.readFileSync(path.join(repo, 'features/checkout/services/checkoutService.ts'), 'utf8')}\nexport const billed = totalBilling;\n`);
    write('features/billing/pages/Leaky.tsx', "import { fetchBilling } from '../services/billingService';\nexport function Leaky() { fetchBilling(); return <div />; }\n");
    commit('Billing totals hook, a checkout import and a leaky page');
    git('checkout', '-q', 'main');
    // Branch 2: prose only.
    git('checkout', '-q', '-b', 'docs/readme');
    write('README.md', '# Shop\n\nA few more words about the shop.\n');
    commit('Explain the shop in the README');
    git('checkout', '-q', 'main');
    // Branch 3: over the 200-file impact cap, so the engine degrades to a feature-level summary.
    git('checkout', '-q', '-b', 'big/bulk');
    for (let i = 0; i < 205; i += 1) write(`features/reporting/domain/bulk/bulk${String(i).padStart(3, '0')}.ts`, `export const bulk${i} = ${i};\n`);
    commit('Two hundred and five generated files');
    git('checkout', '-q', 'main');
    // Two saved plans in the process store, as a finished plan run would have left them.
    seedPlan('plan-billing', 'Billing totals hook', ['billing'], [{ path: 'features/billing/hooks/useBillingTotals.ts', change: 'create' }]);
    seedPlan('plan-wide', 'Billing, checkout and reporting', ['billing', 'checkout', 'reporting']);
    await useProject(request, repo);
  });

  test.afterAll(async ({ request }) => {
    if (originalDir) await useProject(request, originalDir);
    for (const d of scratch) fs.rmSync(d, { recursive: true, force: true });
  });

  test('#315 findings are two groups that are never blurred: mechanical carries the exact command, a conversation carries no fix', async ({ page }) => {
    const before = snapshot();
    await gotoCockpit(page, CHANGE);
    await waitForChange(page);
    await openFindingsTab(page);

    const mech = page.getByTestId('review-group-mechanical');
    const conv = page.getByTestId('review-group-conversation');
    await expect(page.getByTestId('review-findings-summary')).toHaveText('2 of 3 findings can be fixed mechanically.');
    await expect(mech.getByRole('heading')).toContainText('Can be fixed mechanically');
    await expect(conv.getByRole('heading')).toContainText('Needs a decision');
    await expect(mech.getByTestId('review-finding')).toHaveCount(2);
    await expect(conv.getByTestId('review-finding')).toHaveCount(1);

    // The exact command, from the engine's fix.via: `construct sync` is available; SLICE-002 says so plainly.
    const sync = mech.locator('[data-finding*="SLICE-003"]');
    await expect(sync.getByTestId('review-finding-fix')).toContainText('construct sync');
    await expect(sync.getByTestId('review-finding-fix')).toHaveAttribute('data-available', 'yes');
    const deep = mech.locator('[data-finding*="SLICE-002"]');
    await expect(deep.getByTestId('review-finding-fix')).toHaveAttribute('data-available', 'no');
    await expect(deep.getByTestId('review-finding-fix')).toContainText('No automated fix yet');

    // A conversation never shows a fix affordance of any kind.
    await expect(conv.getByTestId('review-finding-fix')).toHaveCount(0);
    await expect(conv.getByText('Fix:')).toHaveCount(0);
    await expect(conv.locator('code')).toHaveCount(0);
    // Marks are shape + text + heading, never colour alone.
    await expect(mech.getByRole('heading')).toContainText('✓');
    await expect(conv.getByRole('heading')).toContainText('◆');
    await expect(page.getByTestId('review-readonly')).toContainText('nothing here applies a fix');
    await page.screenshot({ path: path.join(SHOTS, '315-review-findings.png') });

    expect(snapshot(), 'reading findings never touches the repository').toEqual(before);
  });

  test('#315 selecting a finding shows it on the stage: the command is shown, never run; a conversation is a question', async ({ page }) => {
    const before = snapshot();
    await gotoCockpit(page, CHANGE);
    await waitForChange(page);
    await openFindingsTab(page);

    // Keyboard: focus a finding and press Enter to open it.
    const sync = page.getByTestId('review-group-mechanical').locator('[data-finding*="SLICE-003"]');
    await sync.focus();
    await page.keyboard.press('Enter');
    const detail = page.getByTestId('review-finding-detail');
    await expect(detail).toHaveAttribute('data-kind', 'mechanical');
    await expect(detail.getByTestId('review-fix-command')).toHaveText('construct sync');
    await expect(detail).toContainText('Not applied');
    await expect(detail).toContainText('never runs the command');
    await expect(sync).toHaveAttribute('aria-current', 'true');
    await page.screenshot({ path: path.join(SHOTS, '315-review-finding-detail.png') });

    // A finding with no automated fix yet says so instead of offering one.
    await page.getByTestId('review-group-mechanical').locator('[data-finding*="SLICE-002"]').click();
    await expect(detail.getByTestId('review-detail-fix')).toHaveAttribute('data-available', 'no');
    await expect(detail).toContainText('No automated fix yet');

    // A conversation shows no command at all.
    await page.getByTestId('review-group-conversation').getByTestId('review-finding').click();
    await expect(detail).toHaveAttribute('data-kind', 'conversation');
    await expect(detail.getByTestId('review-detail-conversation')).toContainText('This is a conversation');
    await expect(detail.getByTestId('review-fix-command')).toHaveCount(0);
    await page.getByTestId('review-finding-close').click();
    await expect(detail).toHaveCount(0);

    expect(snapshot(), 'nothing was applied').toEqual(before);
  });

  test('#315 the drawer summarises how many findings are mechanical', async ({ page }) => {
    await gotoCockpit(page, CHANGE);
    await waitForChange(page);
    await page.keyboard.press('Control+j');
    const drawer = page.getByRole('region', { name: 'Drawer' });
    await drawer.getByRole('tab', { name: /Findings/ }).click();
    await expect(drawer.getByTestId('review-drawer-summary')).toHaveText('2 of 3 findings can be fixed mechanically.');
    await expect(drawer.getByTestId('review-findings-drawer')).toContainText('2 can be fixed mechanically');
    await expect(drawer.getByTestId('review-findings-drawer')).toContainText('1 need a decision');
  });

  test('#315 a change with nothing found has a designed empty Findings tab', async ({ page }) => {
    await gotoCockpit(page, '/review?base=main&head=docs%2Freadme');
    await waitForChange(page);
    await openFindingsTab(page);
    await expect(page.getByTestId('review-findings')).toHaveAttribute('data-empty', 'true');
    await expect(page.getByTestId('review-findings')).toContainText('No findings on this change');
  });

  test('#316 no plan is a calm neutral "Not measured": nothing red, nothing empty, every other indicator still works', async ({ page }) => {
    await gotoCockpit(page, CHANGE);
    await waitForChange(page);
    const scope = page.getByTestId('review-scope');
    await expect(scope).toHaveAttribute('data-measured', 'no');
    await expect(page.getByTestId('review-scope-status')).toHaveText('Not measured');
    await expect(page.getByTestId('review-scope-text')).toContainText('normal for hand-written work');
    await expect(page.getByTestId('review-scope-text')).toContainText('Every other check on this page still runs');
    await expect(scope.locator('.rv-badge--danger, .rv-badge--warn')).toHaveCount(0);
    await expect(scope).toHaveClass(/rv-scope--neutral/);
    // The other four indicators still measured, the Tools card for scope is grey too.
    const card = page.locator('[data-testid="review-indicator"][data-indicator="blast-radius"]');
    await expect(card).toHaveAttribute('data-status', 'Not measured');
    await expect(page.locator('[data-testid="review-indicator"][data-indicator="rule-regressions"]')).toHaveAttribute('data-status', 'Needs attention');
    await expect(page.getByTestId('review-plan-select')).toHaveValue('');
    await page.screenshot({ path: path.join(SHOTS, '316-review-no-plan.png') });
  });

  test('#316 choosing a plan compares it with what changed, both ways, and the extra files are listable', async ({ page }) => {
    const before = snapshot();
    await gotoCockpit(page, CHANGE);
    await waitForChange(page);
    await page.getByTestId('review-plan-select').selectOption('plan-billing');
    await expect(page).toHaveURL(/plan=plan-billing/);
    await expect(page.getByTestId('review-scope')).toHaveAttribute('data-measured', 'yes', { timeout: 90_000 });
    await expect(page.getByTestId('review-scope-status')).toHaveText('Outside the plan');
    await expect(page.getByTestId('review-scope-headline')).toContainText('The plan declared 1 feature (billing); this change touches 2');
    const rows = page.getByTestId('review-scope-row');
    await expect(rows).toHaveCount(2);
    await expect(page.locator('[data-testid="review-scope-row"][data-feature="billing"]')).toContainText('As planned');
    await expect(page.locator('[data-testid="review-scope-row"][data-feature="checkout"]')).toContainText('Changed here, not in the plan');
    // The files the plan did not list are one click away.
    const extra = page.getByTestId('review-scope-extra');
    await extra.locator('summary').click();
    await expect(extra).toContainText('features/checkout/services/checkoutService.ts');
    await page.screenshot({ path: path.join(SHOTS, '316-review-plan-outside.png') });

    // The delta goes both ways: a wider plan names a feature this change never touched.
    await page.getByTestId('review-plan-select').selectOption('plan-wide');
    await expect(page.getByTestId('review-scope-status')).toHaveText('Planned work not touched yet', { timeout: 90_000 });
    await expect(page.locator('[data-testid="review-scope-row"][data-feature="reporting"]')).toContainText('In the plan, not touched yet');
    await expect(page.getByTestId('review-scope-headline')).toContainText('not touched yet: reporting');
    await page.screenshot({ path: path.join(SHOTS, '316-review-plan-untouched.png') });

    // Back to no plan: the calm state returns.
    await page.getByTestId('review-plan-select').selectOption('');
    await expect(page.getByTestId('review-scope')).toHaveAttribute('data-measured', 'no', { timeout: 90_000 });
    expect(snapshot(), 'comparing with a plan never touches the repository').toEqual(before);
  });

  test('#316 a plan id that is not one of the saved plans is refused with a next action, and nothing is read from disk', async ({ page, request }) => {
    for (const bad of ['../../etc/passwd', '--upload-pack=x', 'plan-billing/../plan-wide']) {
      const r = await request.get(`${API}/api/review/change?base=main&head=feat%2Fbilling-hooks&plan=${encodeURIComponent(bad)}`);
      expect([401, 404]).toContain(r.status());
    }
    await gotoCockpit(page, `${CHANGE}&plan=${encodeURIComponent('../../etc/passwd')}`);
    const failure = page.getByTestId('review-change-error');
    await expect(failure).toContainText('That plan is not saved in this project');
    await expect(failure.getByTestId('review-failure-next')).toContainText('Review without a plan');
    await failure.getByRole('button', { name: 'Review without a plan' }).click();
    await expect(page).not.toHaveURL(/plan=/);
    await waitForChange(page);
    await expect(page.getByTestId('review-scope')).toHaveAttribute('data-measured', 'no');
  });

  test('#318 an error states what happened and what to do next, with buttons that work', async ({ page }) => {
    await gotoCockpit(page, '/review?base=main&head=no-such-branch');
    const failure = page.getByTestId('review-change-error');
    await expect(failure).toContainText('That branch is not in this project');
    await expect(failure.getByTestId('review-failure-what')).not.toBeEmpty();
    await expect(failure.getByTestId('review-failure-next')).toContainText('What to do');
    await page.screenshot({ path: path.join(SHOTS, '318-review-error.png') });
    await failure.getByRole('button', { name: 'Back to the list' }).click();
    await expect(page.getByTestId('review-list')).toBeVisible();
  });

  test('#318 loading is progressive: the steps are listed, the Browser and the list stay usable, the result fills in', async ({ page }) => {
    let held = 0;
    await page.route('**/api/review/change**', async (route) => {
      held += 1;
      if (held > 2) return route.continue();
      const real = await route.fetch();
      const body = await real.json();
      return route.fulfill({ json: { ok: true, state: 'running', base: body.base, head: body.head, plan: null } });
    });
    await gotoCockpit(page, CHANGE);
    const waiting = page.getByTestId('review-waiting');
    await expect(waiting).toBeVisible();
    await expect(waiting).toContainText('no model involved');
    await expect(waiting.getByRole('listitem')).toHaveCount(4);
    // The rest of the Cockpit is not blocked: the Back button and the Browser pane are live meanwhile.
    await expect(page.getByTestId('review-back')).toBeEnabled();
    await expect(page.getByRole('complementary', { name: 'Browser' })).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, '318-review-analysing.png') });
    await waitForChange(page);
    await expect(page.getByTestId('review-waiting')).toHaveCount(0);
  });

  test('#318 a change over the 200-file cap degrades to a feature-level summary and still gives a usable report', async ({ page }) => {
    test.setTimeout(180_000);
    await gotoCockpit(page, '/review?base=main&head=big%2Fbulk');
    await waitForChange(page);
    const banner = page.getByTestId('review-degraded');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('summarised by feature');
    await expect(banner).toContainText('200-file');
    await expect(banner).toContainText('still ran on the whole change');
    await expect(banner).toContainText('Unexplained changes are not measured');
    // Not an error: the report is there, the scope card is calm, the indicators are listed.
    await expect(page.getByTestId('review-change-error')).toHaveCount(0);
    await expect(page.getByTestId('review-scope')).toBeVisible();
    await expect(page.getByTestId('review-indicator')).toHaveCount(5);
    await expect(page.locator('[data-testid="review-indicator"][data-indicator="unexplained"]')).toHaveAttribute('data-status', 'Not measured');
    await page.screenshot({ path: path.join(SHOTS, '318-review-degraded.png') });
  });

  test('#318 the narrow layout shows one pane at a time with no horizontal scroll, and Findings is reachable from the tab bar', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoCockpit(page, `${CHANGE}&plan=plan-billing`);
    await expect(page.getByTestId('review-scope')).toHaveAttribute('data-measured', 'yes', { timeout: 90_000 });
    const noHorizontalScroll = async () => {
      const { scroll, inner } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
      expect(scroll).toBeLessThanOrEqual(inner);
    };
    await noHorizontalScroll();
    await page.screenshot({ path: path.join(SHOTS, '318-review-narrow-stage.png') });

    const bar = page.getByRole('tablist', { name: 'Panes' });
    await expect(bar.getByRole('tab')).toHaveText(['Browser', 'Stage', 'Tools']);
    for (const tab of await bar.getByRole('tab').all()) {
      const box = await tab.boundingBox();
      expect(box.height, 'tab bar targets are at least 24px').toBeGreaterThanOrEqual(24);
    }
    // Reach the findings by keyboard: focus the Stage tab and arrow to Tools.
    await bar.getByRole('tab', { name: 'Stage' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(bar.getByRole('tab', { name: 'Tools' })).toHaveAttribute('aria-selected', 'true');
    await openFindingsTab(page);
    // The same three findings as without a plan, plus what the plan adds: a feature outside it (a conversation).
    await expect(page.getByTestId('review-finding')).toHaveCount(5);
    await expect(page.getByTestId('review-group-conversation')).toContainText('outside the plan');
    await noHorizontalScroll();
    await page.screenshot({ path: path.join(SHOTS, '318-review-narrow-findings.png') });
    // Browser: the changed units.
    await bar.getByRole('tab', { name: 'Browser' }).click();
    await expect(page.getByTestId('review-tree')).toBeVisible();
    await noHorizontalScroll();
  });

  test('#318 empty: a repository with no commit says there is nothing to compare, and what to do', async ({ page, request }) => {
    const empty = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'og315-empty-')));
    scratch.push(empty);
    fs.cpSync(FIXTURE, empty, { recursive: true });
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: empty });
    await useProject(request, empty);
    await gotoCockpit(page, '/review');
    const state = page.getByTestId('review-no-branches');
    await expect(state).toBeVisible();
    await expect(state).toContainText('nothing to compare yet');
    await expect(state).toContainText('What to do');
    await page.screenshot({ path: path.join(SHOTS, '318-review-empty.png') });
  });

  test('#318 empty: only one branch means no other change to review, with a next step', async ({ page, request }) => {
    const single = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'og315-single-')));
    scratch.push(single);
    fs.cpSync(FIXTURE, single, { recursive: true });
    const g = (...a) => execFileSync('git', a, { cwd: single });
    g('init', '-q', '-b', 'main');
    g('config', 'user.email', 'e2e@example.com');
    g('config', 'user.name', 'E2E');
    g('config', 'commit.gpgsign', 'false');
    g('add', '-A');
    g('commit', '-q', '-m', 'base');
    await useProject(request, single);
    await gotoCockpit(page, '/review');
    await expect(page.getByTestId('review-empty')).toContainText('No other branches to review');
    await expect(page.getByTestId('review-empty')).toContainText('Create a branch');
  });

  test('#318 error: a project that is not a git repository says so and offers Settings', async ({ page, request }) => {
    const plain = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'og315-nogit-')));
    scratch.push(plain);
    fs.cpSync(FIXTURE, plain, { recursive: true });
    await useProject(request, plain);
    await gotoCockpit(page, '/review');
    const failure = page.getByTestId('review-error');
    await expect(failure).toContainText('This project is not a git repository');
    await expect(failure.getByTestId('review-failure-next')).toContainText('git init');
    await page.screenshot({ path: path.join(SHOTS, '318-review-not-git.png') });
    await failure.getByRole('button', { name: 'Open Settings' }).click();
    await expect(page).toHaveURL(/\/settings/);
  });
});
