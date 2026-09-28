import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gotoCockpit } from './support/cockpit.js';
import { makeReviewRepo } from './support/reviewRepo.js';

// The Git screen's "no remote" empty state (`ia-git-connect`, #374): the shared review fixture (like
// every other e2e fixture in this suite) has no `git remote`, so the PRs tab -- where remote-backed data
// lives -- shows "Connect remote" / "Clone a repository" instead of the plain #330 placeholder. The
// local branch list itself needs no remote and keeps working (the connect/clone action itself is #330;
// only its position is built here).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(__dirname, '../screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const API = process.env.E2E_API_BASE || 'http://localhost:4000';

test.describe.serial('Git screen: no-remote empty state (#374)', () => {
  let repo;
  let originalDir;

  test.beforeAll(async ({ request }) => {
    originalDir = (await (await request.get(`${API}/api/settings`)).json()).projectDir;
    ({ repo } = makeReviewRepo('og374-connect-'));
    await request.post(`${API}/api/settings`, { data: { projectDir: repo } });
  });

  test.afterAll(async ({ request }) => {
    if (originalDir) await request.post(`${API}/api/settings`, { data: { projectDir: originalDir } });
    fs.rmSync(repo, { recursive: true, force: true });
  });

  test('PRs shows "Connect remote" / "Clone a repository" when the project has no remote', async ({ page }) => {
    await gotoCockpit(page, '/review');
    await expect(page.getByTestId('review-row')).toHaveCount(2, { timeout: 30_000 });
    await expect(page.getByTestId('review-analysing')).toHaveCount(0, { timeout: 60_000 });

    await page.getByRole('tab', { name: 'PRs' }).click();
    const empty = page.getByTestId('review-no-remote');
    await expect(empty).toBeVisible();
    await expect(empty).toContainText('This project has no remote yet');
    await expect(empty.getByTestId('review-connect-remote')).toBeVisible();
    await expect(empty.getByTestId('review-connect-remote')).toBeDisabled();
    await expect(empty.getByTestId('review-clone-repository')).toBeVisible();
    await expect(empty.getByTestId('review-clone-repository')).toBeDisabled();
    await page.screenshot({ path: path.join(SHOTS, '374-git-connect-empty-state.png') });

    // The local branch list is unaffected by the missing remote: switching back to Branches still works.
    await page.getByRole('tab', { name: 'Branches' }).click();
    await expect(page.getByTestId('review-row')).toHaveCount(2);
  });
});
