import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gotoCockpit, setTheme } from './support/cockpit.js';
import { makeReviewRepo } from './support/reviewRepo.js';

// #374 -- the Git screen shell: left tabs Changes | Branches | PRs | Commits, right tabs Health |
// Findings | Detail | Plan match | Commit, the no-remote Connect/Clone empty state, the Approvals
// drawer tab, and the status-bar commit link. This is the SHELL only (issue #374); stage/unstage,
// diff, commit box and push/pull (#331/#710) are not built here -- see GitChangesPlaceholder.tsx and
// GitCommitsPlaceholder.tsx for the named extension points.
//
// Every review e2e fixture (this one included) is a bare `git init` with no `origin`, which is
// exactly the "no remote" case ia-git-connect.html designs for -- so the PRs tab's empty state is
// exercised for real, not mocked.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(__dirname, '../screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const API = process.env.E2E_API_BASE || 'http://localhost:4000';

const railTabs = (page) => page.getByTestId('rail-subtabs');
const tools = (page) => page.getByRole('complementary', { name: 'Tools' });
const drawer = (page) => page.getByRole('region', { name: 'Drawer' });

test.describe.serial('Git screen shell (#374)', () => {
  let plainRepo;
  let changeRepo;
  let originalDir;

  test.beforeAll(async ({ request }) => {
    originalDir = (await (await request.get(`${API}/api/settings`)).json()).projectDir;
    // A minimal repo with one local commit and no remote -- enough for the list/PRs/Commit tabs.
    // `/api/init` first (like commit-on-save.spec.js's fixture): `/review` is wrapped in
    // ProjectGateController, which blocks everything behind it -- Changes/Branches/PRs/Commits
    // included -- for a directory with no architecture.yml.
    plainRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'og374-plain-'));
    await request.post(`${API}/api/settings`, { data: { projectDir: plainRepo } });
    await request.post(`${API}/api/init`);
    const git = (...a) => execFileSync('git', a, { cwd: plainRepo, encoding: 'utf8' });
    fs.writeFileSync(path.join(plainRepo, 'README.md'), '# Shop\n');
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'e2e@example.com');
    git('config', 'user.name', 'E2E');
    git('config', 'commit.gpgsign', 'false');
    git('add', '-A');
    git('commit', '-q', '-m', 'base');
    // A branch, so the PRs list has something to rank once a remote is connected/not asserted here.
    git('checkout', '-q', '-b', 'feat/thing');
    fs.writeFileSync(path.join(plainRepo, 'NOTES.md'), 'notes\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'a change');
    git('checkout', '-q', 'main');
    changeRepo = makeReviewRepo('og374-change-');
  });

  test.afterAll(async ({ request }) => {
    if (originalDir) await request.post(`${API}/api/settings`, { data: { projectDir: originalDir } });
    fs.rmSync(plainRepo, { recursive: true, force: true });
    fs.rmSync(changeRepo.repo, { recursive: true, force: true });
  });

  test('the list route shows the four left tabs and the badges/Commit right tabs, in both themes', async ({ page, request }) => {
    await request.post(`${API}/api/settings`, { data: { projectDir: plainRepo } });
    await gotoCockpit(page, '/review');

    // Branches and PRs each carry a count badge inside the tab button (branches/rows found), so
    // their accessible text has a number appended -- match by prefix, as above for Findings.
    const left = railTabs(page);
    await expect(left.getByRole('tab')).toHaveText([/^Changes$/, /^Branches/, /^PRs/, /^Commits$/]);
    // Tools also always carries the shell's own "Project" tab after a screen's own tabs (unrelated
    // to #374); asserting the Git-specific ones by name, not the whole list, keeps this test from
    // being coupled to that pre-existing default.
    const right = tools(page);
    await expect(right.getByRole('tab', { name: 'What the badges mean' })).toBeVisible();
    await expect(right.getByRole('tab', { name: 'Commit' })).toBeVisible();

    await right.getByRole('tab', { name: 'Commit' }).click();
    await expect(page.locator('.git-settings').getByRole('heading', { name: 'Commit on save' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('commit-indicator')).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, '374-git-commit-tab--dark.png') });

    await setTheme(page, 'light');
    await page.screenshot({ path: path.join(SHOTS, '374-git-commit-tab--light.png') });
    await setTheme(page, 'dark');
  });

  test('the PRs tab shows the no-remote Connect/Clone empty state (ia-git-connect.html), and never touches the default browser tab', async ({ page }) => {
    await gotoCockpit(page, '/review');
    // Branches (review-sources) stays the default -- adding PRs must not steal it.
    await expect(page.getByTestId('review-sources')).toBeVisible();

    await railTabs(page).getByRole('tab', { name: 'PRs' }).click();
    const connect = page.getByTestId('git-connect-state');
    await expect(connect).toBeVisible();
    await expect(connect).toContainText('This project has no remote yet');
    await page.screenshot({ path: path.join(SHOTS, '374-git-connect-state--dark.png') });

    await page.getByTestId('git-connect-remote').click();
    await expect(page.getByTestId('connect-remote')).toBeVisible();
    await expect(page.getByTestId('remote-not-repo')).toHaveCount(0); // it IS a repo, just no origin
    await page.getByTestId('git-connect-remote').click(); // collapse
    await page.getByTestId('git-clone-repo').click();
    await expect(page.getByTestId('clone')).toBeVisible();
  });

  test('Changes and Commits tabs are honest, labelled interim placeholders (#331/#710 extension points)', async ({ page }) => {
    await gotoCockpit(page, '/review');
    await railTabs(page).getByRole('tab', { name: 'Changes' }).click();
    await expect(page.getByTestId('git-changes-placeholder')).toContainText('#331');
    await railTabs(page).getByRole('tab', { name: 'Commits' }).click();
    await expect(page.getByTestId('git-commits-placeholder')).toBeVisible();
  });

  test('a change route shows Health, Findings, Detail, Plan match and Commit on the right, Findings/Detail linked without disturbing the tree', async ({ page, request }) => {
    await request.post(`${API}/api/settings`, { data: { projectDir: changeRepo.repo } });
    await gotoCockpit(page, '/review?base=main&head=feat%2Fbilling-totals');
    await expect(page.getByTestId('review-headline')).toBeVisible({ timeout: 90_000 });

    // Findings carries a count badge inside its own tab button, so its accessible text is "Findings5"
    // -- match by prefix, not exact text, the same way the findings count itself is variable.
    const right = tools(page);
    await expect(right.getByRole('tab')).toHaveText([/^Health$/, /^Findings/, /^Detail$/, /^Plan match$/, /^Commit$/, /^Project$/]);
    // Health stays the default (unchanged by #374's additive tabs).
    await expect(page.getByTestId('review-indicator').first()).toBeVisible();

    await right.getByRole('tab', { name: 'Detail' }).click();
    await expect(page.getByTestId('git-detail-empty')).toBeVisible();

    await right.getByRole('tab', { name: 'Plan match' }).click();
    // Additive, not moved: the same scope/plan view still shows on the stage too (untouched), so
    // scope this to the Tools panel's own copy.
    await expect(right.getByTestId('review-scope')).toBeVisible();

    // Findings tab is untouched: selecting a finding still shows it inline on the stage too, so the
    // existing review-findings.spec.js flow (select several findings in sequence) needs no changes.
    await right.getByRole('tab', { name: 'Findings' }).click();
    await expect(page.getByTestId('review-finding').first()).toBeVisible();
    await page.getByTestId('review-finding').first().click();
    await expect(page.getByTestId('review-finding-detail')).toBeVisible();
    // ...and the same detail is also reachable from its own tab (both visible at once now: the
    // stage's copy is untouched and the Detail tab adds its own).
    await right.getByRole('tab', { name: 'Detail' }).click();
    await expect(right.getByTestId('review-finding-detail')).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, '374-git-detail-tab--dark.png') });
  });

  test('the Approvals drawer tab exists beside Processes, and never claims something is applied when nothing is', async ({ page }) => {
    await gotoCockpit(page, '/review');
    await page.getByTestId('toggle-drawer').click();
    const d = drawer(page);
    // Diagnostics and Approvals both carry count badges (see above); match by prefix.
    await expect(d.getByRole('tab')).toHaveText([/^Diagnostics/, /^Logs$/, /^Processes$/, /^Approvals/]);
    await d.getByRole('tab', { name: /Approvals/ }).click();
    await expect(page.getByTestId('approvals-empty')).toContainText('Nothing waiting on you');
    await page.screenshot({ path: path.join(SHOTS, '374-approvals-empty--dark.png') });
  });

  test('the status-bar commit indicator links to Git > Commit, from a different screen', async ({ page }) => {
    await gotoCockpit(page, '/tests');
    const chip = page.getByTestId('status-commit');
    await expect(chip).toContainText('Commit:');
    await chip.click();
    await expect(page).toHaveURL(/\/review$/);
    await expect(tools(page).getByRole('tab', { name: 'Commit' })).toHaveAttribute('aria-selected', 'true');
  });
});
