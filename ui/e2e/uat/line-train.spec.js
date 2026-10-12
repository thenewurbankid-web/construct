import fs from 'node:fs';
import path from 'node:path';
import { test, expect, freshSample, openSampleFromPicker, expectAxeClean, expectLayoutFits } from './support/uat.js';

// UAT walk for Train Line (docs/line/review.md, "Train Line: the owner and Claude train Line's drafter", UAT 5 minutes),
// as the owner walks it: clicks only, from the shell, Under the hood (the fixture's default). Profile menu -> Train Line.
// Review: five of Claude's cases, each with its routes; Agree with one, Disagree with another and say why (both logged
// as the owner). Teach: click a suggested request, correct its feature in the closed list (billing -> orders), Try it
// on a route ("It works in a scratch copy"), Save as a training case (saved without project words). Run eval: the
// scoreboard reads per tool family, and "All cases" counts the owner's 1 agreement of 2. Axe clean and no sideways
// scroll at 1280 and 375 px on the screen. The server saves into the sandbox's training root (playwright.uat.config.js,
// LINE_TRAIN_ROOT), never the repo's line/train. The regular spec is tests/line-train.spec.js.
const TRAIN = '[data-testid="line-train"]';
const ROOT = process.env.E2E_TRAIN_ROOT;
if (!ROOT || path.resolve(ROOT).startsWith(path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../line'))) {
  throw new Error('E2E_TRAIN_ROOT must be the UAT sandbox, never the repo\'s line/.');
}
const lines = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

test('Train Line UAT: review Claude\'s cases, teach a suggested request, Try it, Save, Run eval', async ({ page }, testInfo) => {
  freshSample();
  await page.setViewportSize({ width: 1280, height: 900 });
  await openSampleFromPicker(page);

  // 1. Profile menu -> Train Line.
  await page.getByTestId('user-menu-trigger').click();
  await page.getByTestId('profile-train').click();
  await expect(page).toHaveURL(/\/train$/);
  await expect(page.getByRole('heading', { name: 'Train Line', level: 1 })).toBeVisible({ timeout: 30_000 });

  // 2. Review five of Claude's cases: each reads "Proposed by Claude" with its routes. Agree with the first; Disagree
  // with the second and say why. Both are logged as the owner.
  const cases = page.getByTestId('train-case');
  await expect(cases).toHaveCount(5, { timeout: 30_000 });
  for (let i = 0; i < 5; i += 1) {
    await expect(cases.nth(i)).toContainText('Proposed by Claude');
    await expect(cases.nth(i).getByTestId('train-route').first()).toBeVisible();
  }
  await expectAxeClean(page, TRAIN);
  await expectLayoutFits(page, TRAIN, testInfo, 'train-review');
  await page.setViewportSize({ width: 375, height: 812 });
  await expectAxeClean(page, TRAIN);
  await page.setViewportSize({ width: 1280, height: 900 });

  const first = cases.nth(0);
  await first.getByRole('button', { name: 'Agree', exact: true }).click();
  await expect(first.getByTestId('train-case-status')).toHaveText('You agreed.', { timeout: 30_000 });
  const second = cases.nth(1);
  await second.getByRole('button', { name: 'Disagree' }).click();
  await second.getByLabel('What is wrong with it? (optional)').fill('The preferred route should stay inside the feature.');
  await second.getByRole('button', { name: 'Send disagreement' }).click();
  await expect(second.getByTestId('train-case-status')).toHaveText('You disagreed: The preferred route should stay inside the feature.', { timeout: 30_000 });
  expect(lines('train/log.jsonl').slice(-2).map((l) => [l.by, l.action])).toEqual([['owner', 'agree'], ['owner', 'disagree']]);

  // 3. Teach a new request: one click on a suggested request drafts it.
  const teach = page.getByTestId('train-teach');
  await teach.getByTestId('train-suggestion').first().click();
  const draft = page.getByTestId('train-draft');
  await expect(draft.getByTestId('train-draft-request')).toHaveText('Make StatusBadge in billing, based on Badge.', { timeout: 30_000 });
  await expect(draft.getByTestId('train-intent').locator('option:checked')).toHaveText('Add a component');

  // 4. Correct the draft: the feature in its closed list (two clicks), the request and the route follow. Try it on the
  // route: it works in a scratch copy. Save as a training case: stored without the project's words.
  const feature = draft.getByTestId('train-slot-F1');
  await feature.click();
  await feature.selectOption({ label: 'orders' });
  await expect(draft.getByTestId('train-draft-request')).toHaveText('Make StatusBadge in orders, based on Badge.');
  const route = draft.getByTestId('train-route').first();
  await expect(route).toContainText('Make StatusBadge in orders, based on the library Badge.');
  await expect(route).toContainText('Validate shows no new problems.');
  await route.getByRole('button', { name: 'Try it' }).click();
  await expect(route.getByTestId('train-try')).toHaveAttribute('data-ok', 'true', { timeout: 30_000 });
  await expect(route.getByTestId('train-try')).toContainText('It works in a scratch copy');
  await draft.getByRole('button', { name: 'Save as a training case' }).click();
  await expect(draft.getByTestId('train-saved')).toContainText('Saved as a training case', { timeout: 30_000 });
  const saved = fs.readFileSync(path.join(ROOT, 'train/cases.jsonl'), 'utf8').trim().split('\n').at(-1);
  expect(JSON.parse(saved).labelledBy).toBe('owner');
  expect(saved).not.toMatch(/orders|StatusBadge|Badge/);
  await expectAxeClean(page, '[data-testid="train-teach"]');

  // 5. Run eval and read the scoreboard: per tool family, and the owner's agreement on Claude's cases (1 of 2).
  const board = page.getByTestId('train-scoreboard');
  await board.getByRole('button', { name: 'Run eval' }).click();
  await expect(board.getByTestId('train-last-run')).toContainText('Last run', { timeout: 60_000 });
  await expect(board.getByTestId('train-score-sentence')).toContainText('held-out cases');
  const family = board.getByTestId('train-score-family');
  await expect(family.getByRole('row', { name: /Make from the library/ })).toContainText('%');
  await expect(family.getByRole('row', { name: /All cases/ })).toContainText('1 of 2');
  await expectAxeClean(page, TRAIN);
  await expectLayoutFits(page, TRAIN, testInfo, 'train-scoreboard');
  await page.setViewportSize({ width: 375, height: 812 });
  await expectAxeClean(page, TRAIN);
});
