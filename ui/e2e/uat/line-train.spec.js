import { test, expect } from '@playwright/test';
import { waitForCockpitReady } from '../tests/support/cockpit.js';

// Pre-UAT walk of docs/line/review.md "Train Line", the way a non-technical owner does it: only clicks and typing in
// the browser, no API calls. Fails on any console error or failed request, and on a correction that takes more than
// two clicks. Run under playwright.line-train.config.js (a training root of its own).
//   1. Open Train Line from the profile menu.
//   2. Review 5 of Claude's cases: agree with four, disagree with one (with a note).
//   3. Type one new request (pick a suggested one).
//   4. Correct the draft: change the feature (two clicks), Try it, save.
//   5. Run eval and read the scoreboard.
test('UAT walk: Train Line', async ({ page }) => {
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400) problems.push(`${r.status()} ${r.url()}`); });

  // 1. Open Train Line from the profile menu.
  await page.goto('/');
  await waitForCockpitReady(page);
  await page.getByTestId('user-menu-trigger').click();
  await page.getByTestId('profile-train').click();
  await expect(page).toHaveURL(/\/train$/);
  await expect(page.getByRole('heading', { name: 'Train Line', level: 1 })).toBeVisible();

  // 2. Review 5 of Claude's cases.
  const cases = page.getByTestId('train-case');
  await expect(cases).toHaveCount(5, { timeout: 30_000 });
  for (let i = 0; i < 4; i += 1) {
    const c = cases.nth(i);
    await expect(c).toContainText('Proposed by Claude');
    await c.getByRole('button', { name: 'Agree', exact: true }).click();
    await expect(c.getByTestId('train-case-status')).toHaveText('You agreed.', { timeout: 30_000 });
  }
  const last = cases.nth(4);
  await last.getByRole('button', { name: 'Disagree' }).click();
  await last.getByLabel('What is wrong with it? (optional)').fill('I would keep this inside the feature.');
  await last.getByRole('button', { name: 'Send disagreement' }).click();
  await expect(last.getByTestId('train-case-status')).toHaveText('You disagreed: I would keep this inside the feature.', { timeout: 30_000 });

  // 3. Type one new request: a suggested one, one click.
  const teach = page.getByTestId('train-teach');
  await teach.getByTestId('train-suggestion').first().click();
  const draft = page.getByTestId('train-draft');
  await expect(draft.getByTestId('train-draft-request')).toHaveText('Make StatusBadge in billing, based on Badge.');
  await expect(draft.getByTestId('train-route').first()).toContainText('Make StatusBadge in billing, based on the library Badge.');

  // 4. Correct it: the feature, in two clicks (open the list, pick). selectOption is the pick; the click opens it.
  const feature = draft.getByTestId('train-slot-F1');
  await feature.click();
  await feature.selectOption({ label: 'orders' });
  await expect(draft.getByTestId('train-draft-request')).toHaveText('Make StatusBadge in orders, based on Badge.');
  const route = draft.getByTestId('train-route').first();
  await route.getByRole('button', { name: 'Try it' }).click();
  await expect(route.getByTestId('train-try')).toContainText('It works in a scratch copy', { timeout: 30_000 });
  await draft.getByRole('button', { name: 'Save as a training case' }).click();
  await expect(draft.getByTestId('train-saved')).toContainText('Saved as a training case', { timeout: 30_000 });

  // 5. Run eval and read the scoreboard.
  const board = page.getByTestId('train-scoreboard');
  await board.getByRole('button', { name: 'Run eval' }).click();
  await expect(board.getByTestId('train-last-run')).toContainText('Last run', { timeout: 60_000 });
  await expect(board.getByTestId('train-score-sentence')).toContainText('of the valid routes found');
  await expect(board.getByTestId('train-score-family').getByRole('row', { name: /Fix a problem/ })).toContainText('%');

  expect(problems, problems.join('\n')).toEqual([]);
});
