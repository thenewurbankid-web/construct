import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gotoCockpit } from './support/cockpit.js';

// Review mode (#312 the shell and the list, #313 reviewing ONE change), end to end in a real browser
// against a REAL throwaway git repository with real branches. Nothing is mocked: the badges come from the
// PR-health engine running in a child process of the Cockpit server, the units are grouped by the layer
// graph, and the "what it now does" sentences come from summarizeUnit on the head commit.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(__dirname, '../screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const API = process.env.E2E_API_BASE || 'http://localhost:4000';
const FIXTURE = path.resolve(__dirname, '../../../fixtures/impact-shared');

const FLOW_BASE = `import { setup } from 'xstate';

export const SignupFlow = setup({}).createMachine({
  id: 'signupFlow',
  initial: 'idle',
  states: {
    idle: { on: { SUBMIT: 'pending' } },
    pending: { on: { OK: 'success', FAIL: 'rejected' } },
    rejected: { on: { OVERRIDE: 'success' } },
    success: { type: 'final' },
  },
});
`;

test.describe.serial('Review mode (#312, #313)', () => {
  let repo;
  let originalDir;
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

  test.beforeAll(async ({ request }) => {
    originalDir = (await (await request.get(`${API}/api/settings`)).json()).projectDir;
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'og312-review-'));
    fs.cpSync(FIXTURE, repo, { recursive: true });
    write('features/billing/workflows/SignupFlow.ts', FLOW_BASE);
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'e2e@example.com');
    git('config', 'user.name', 'E2E');
    git('config', 'commit.gpgsign', 'false');
    commit('base');
    // Branch 1: a change that touches two features, breaks a rule, drops a public export and a flow path.
    git('checkout', '-q', '-b', 'feat/billing-totals');
    write('features/billing/domain/billingRules.ts', '// Pure billing rules: no I/O, no framework.\nexport function totalBilling(lines: number[]): number {\n  return lines.reduce((a, b) => a + b, 0) + 0;\n}\n');
    write('features/billing/services/billingService.ts', `${fs.readFileSync(path.join(repo, 'features/billing/services/billingService.ts'), 'utf8')}// touched\n`);
    write('features/checkout/domain/checkoutRules.ts', `${fs.readFileSync(path.join(repo, 'features/checkout/domain/checkoutRules.ts'), 'utf8')}// isolated\n`);
    write('features/billing/workflows/SignupFlow.ts', FLOW_BASE.replace("rejected: { on: { OVERRIDE: 'success' } },", "rejected: { type: 'final' },"));
    write('features/billing/pages/Leaky.tsx', "import { fetchBilling } from '../services/billingService';\nexport function Leaky() { fetchBilling(); return <div />; }\n");
    commit('Billing totals, checkout rules and a signup flow change');
    git('checkout', '-q', 'main');
    // Branch 2: only prose changed.
    git('checkout', '-q', '-b', 'docs/readme');
    write('README.md', '# Shop\n\nA few more words about the shop.\n');
    commit('Explain the shop in the README');
    git('checkout', '-q', 'main');
    await request.post(`${API}/api/settings`, { data: { projectDir: repo } });
  });

  test.afterAll(async ({ request }) => {
    // Put the server's project back before the repo is deleted, so later specs see what they expect.
    if (originalDir) await request.post(`${API}/api/settings`, { data: { projectDir: originalDir } });
    fs.rmSync(repo, { recursive: true, force: true });
  });

  test('Review is a verb inside the Git screen: Git is the current screen, and Features leads to the plan side (#369)', async ({ page }) => {
    await gotoCockpit(page, '/review');
    const nav = page.getByRole('navigation', { name: 'Screens', exact: true });
    await expect(nav.getByRole('link', { name: /^Git/ })).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('link', { name: 'Features' })).toHaveAttribute('href', '/');
    await expect(nav.getByRole('link', { name: 'Features' })).not.toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('navigation', { name: 'Modes' })).toHaveCount(0);
    // The Git entry carries the number of branches waiting for review (this repository has two).
    await expect(page.getByTestId('screen-git-badge')).toContainText('2');
    await expect(nav.getByRole('link', { name: /^Git/ })).toContainText('branches under review');
    await page.screenshot({ path: path.join(SHOTS, '369-git-badge.png'), clip: { x: 0, y: 0, width: 1280, height: 90 } });
  });

  test('the list shows every local branch with the badges the engine computed, riskiest first', async ({ page }) => {
    const before = snapshot();
    await gotoCockpit(page, '/review');
    const rows = page.getByTestId('review-row');
    await expect(rows).toHaveCount(2);
    // Analysis runs off the server's request thread, so rows may say "Analysing" for a moment.
    await expect(page.getByTestId('review-analysing')).toHaveCount(0, { timeout: 60_000 });

    // Riskiest first: the branch with findings before the one with none.
    await expect(rows.nth(0)).toHaveAttribute('data-branch', 'feat/billing-totals');
    await expect(rows.nth(1)).toHaveAttribute('data-branch', 'docs/readme');

    const risky = rows.nth(0).getByTestId('review-badge');
    await expect(risky.filter({ hasText: /rule regression/ })).toHaveCount(1);
    await expect(risky.filter({ hasText: 'No plan' })).toHaveCount(1);
    // No plan is neutral, never an error colour.
    await expect(risky.filter({ hasText: 'No plan' })).toHaveAttribute('data-tone', 'neutral');

    // A branch with nothing found says so, in words.
    const calm = rows.nth(1).getByTestId('review-badge');
    await expect(calm.filter({ hasText: 'Nothing found' })).toHaveCount(1);
    await expect(calm.filter({ hasText: 'No plan' })).toHaveCount(1);

    // The Browser names the source and the base; the Tools pane explains the badges.
    await expect(page.getByTestId('review-sources')).toContainText('Local branches');
    await expect(page.getByTestId('review-base')).toHaveValue('main');
    await expect(page.getByTestId('review-legend')).toContainText('No plan');
    await expect(page.getByTestId('review-order-note')).toContainText('Riskiest first');
    await page.screenshot({ path: path.join(SHOTS, '312-review-list.png') });

    // The order is switchable and explained.
    await page.getByRole('button', { name: 'Newest' }).click();
    await expect(page.getByTestId('review-order-note')).toContainText('Newest first');
    await page.getByRole('button', { name: 'Riskiest first' }).click();

    // Keyboard: arrow keys move between rows.
    await rows.nth(0).focus();
    await page.keyboard.press('ArrowDown');
    await expect(rows.nth(1)).toBeFocused();

    expect(snapshot(), 'listing and analysing never touch the repository').toEqual(before);
  });

  test('opening one change groups its units by feature then layer and says what each now does', async ({ page }) => {
    const before = snapshot();
    await gotoCockpit(page, '/review');
    await expect(page.getByTestId('review-analysing')).toHaveCount(0, { timeout: 60_000 });
    await page.getByTestId('review-row').filter({ hasText: 'feat/billing-totals' }).click();
    await expect(page).toHaveURL(/\/review\?base=main&head=feat%2Fbilling-totals/);
    await expect(page.getByTestId('review-headline')).toBeVisible({ timeout: 60_000 });

    // Browser: features, then layers, then files; not a flat list.
    const tree = page.getByTestId('review-tree');
    await expect(tree.getByTestId('review-feature')).toHaveText([/billing/, /checkout/]);
    const billing = tree.locator('[data-testid="review-feature"][data-feature="billing"]');
    await expect(billing.getByTestId('review-layer')).toHaveCount(4);
    await expect(billing.locator('[data-testid="review-layer"][data-layer="domain"]')).toContainText('billingRules.ts');
    await expect(billing.locator('[data-testid="review-layer"][data-layer="service"]')).toContainText('billingService.ts');
    await expect(billing.locator('[data-testid="review-layer"][data-layer="workflow"]')).toContainText('SignupFlow.ts');
    await expect(billing.locator('[data-testid="review-layer"][data-layer="page"]')).toContainText('Leaky.tsx');
    const checkout = tree.locator('[data-testid="review-feature"][data-feature="checkout"]');
    await expect(checkout.locator('[data-testid="review-layer"][data-layer="domain"]')).toContainText('checkoutRules.ts');
    await expect(page.getByTestId('review-totals')).toHaveText(/5 files . 2 features . 4 layers/);

    // Stage: what each unit now does, from summarizeUnit.
    const units = page.getByTestId('review-unit');
    await expect(units.filter({ hasText: 'billingRules.ts' }).getByTestId('review-unit-summary')).toContainText('Pure billing rules');
    await expect(page.getByText('read from the code, not from the description')).toBeVisible();

    // Tools: the five indicators, the engine's own sentences.
    const cards = page.getByTestId('review-indicator');
    await expect(cards).toHaveCount(5);
    await expect(page.locator('[data-testid="review-indicator"][data-indicator="rule-regressions"]')).toContainText('Needs attention');
    await expect(page.locator('[data-testid="review-indicator"][data-indicator="flow-diff"]')).toContainText('no longer supports');

    // No plan: scope is a calm neutral card with its reason, not red and not empty.
    const scope = page.locator('[data-testid="review-indicator"][data-indicator="blast-radius"]');
    await expect(scope).toHaveAttribute('data-status', 'Not measured');
    await expect(scope).toContainText('Scope is not measured');
    await expect(page.getByTestId('review-indicator-reason').first()).toContainText('No plan is linked');
    await expect(scope.locator('.rv-badge--danger')).toHaveCount(0);
    await page.screenshot({ path: path.join(SHOTS, '313-review-change.png') });

    // Selecting a unit anywhere selects it everywhere.
    await tree.getByTestId('review-file').filter({ hasText: 'billingService.ts' }).click();
    await expect(units.filter({ hasText: 'billingService.ts' })).toHaveAttribute('aria-current', 'true');
    await units.filter({ hasText: 'billingRules.ts' }).getByRole('button').click();
    await expect(tree.getByTestId('review-file').filter({ hasText: 'billingRules.ts' })).toHaveAttribute('aria-current', 'true');

    // The other groupings are still one click away.
    await page.getByTestId('review-group-layer').click();
    await expect(tree.getByTestId('review-layer-group').first()).toHaveAttribute('data-layer', 'domain');
    await page.getByTestId('review-group-files').click();
    await expect(tree.getByTestId('review-file')).toHaveCount(5);

    await page.getByTestId('review-back').click();
    await expect(page.getByTestId('review-list')).toBeVisible();
    expect(snapshot(), 'reviewing a change never touches the repository').toEqual(before);
  });

  test('a change with nothing found reads calmly: positive indicators and a neutral scope card', async ({ page }) => {
    await gotoCockpit(page, '/review?base=main&head=docs%2Freadme');
    await expect(page.getByTestId('review-headline')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('review-headline')).toContainText('Scope is not measured');
    const cards = page.getByTestId('review-indicator');
    await expect(cards).toHaveCount(5);
    await expect(page.locator('[data-testid="review-indicator"][data-indicator="blast-radius"]')).toHaveAttribute('data-status', 'Not measured');
    // Unexplained needs a changed source file to walk from; a README-only change has none, so it says so calmly.
    await expect(page.locator('[data-testid="review-indicator"][data-indicator="unexplained"]')).toHaveAttribute('data-status', 'Not measured');
    for (const id of ['rule-regressions', 'public-surface', 'flow-diff']) {
      await expect(page.locator(`[data-testid="review-indicator"][data-indicator="${id}"]`)).toHaveAttribute('data-status', 'Nothing found');
    }
    // A README is in no feature: it still appears, in a group of its own.
    await expect(page.getByTestId('review-tree').getByTestId('review-feature')).toHaveText([/Outside features/]);
    await expect(page.getByTestId('review-tree')).toContainText('README.md');
    await page.screenshot({ path: path.join(SHOTS, '313-review-no-plan.png') });
  });

  test('a branch that is not in this project is refused, not passed to git', async ({ page }) => {
    await gotoCockpit(page, '/review?base=main&head=--upload-pack%3Dtouch%20pwned');
    await expect(page.getByTestId('review-change-error')).toBeVisible();
    await expect(page.getByTestId('review-change-error')).toContainText(/cannot start with|not a branch of this project/);
    expect(fs.existsSync(path.join(repo, 'pwned'))).toBe(false);
  });
});
