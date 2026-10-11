import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { gotoCockpit } from './support/cockpit.js';
import { runAxe, isBlocking, format } from './support/axe.js';

// Train Line on the real server (run under playwright.line-train.config.js, which gives the server a training root of
// its own, seeded from the repo's line/train). Claude's cases are reviewed, a typed request is drafted, corrected with
// one closed choice, tried in a scratch copy and saved without project words; a near-miss word is answered once and
// becomes a synonym; Run eval fills the scoreboard. No console error, no failed request, axe clean.
const ROOT = process.env.E2E_TRAIN_ROOT;
const lines = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

test.describe.serial('Train Line', () => {
  /** @type {string[]} */
  let problems = [];
  test.beforeEach(async ({ page }) => {
    problems = [];
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
    page.on('response', (r) => { if (r.url().includes('/api/line/train') && r.status() >= 400) problems.push(`${r.status()} ${r.url()}`); });
  });
  test.afterEach(() => { expect(problems, problems.join('\n')).toEqual([]); });

  test('review: five of Claude\'s cases with their routes; Agree, and Disagree with a note, are logged as the owner', async ({ page }) => {
    await gotoCockpit(page, '/train');
    const cases = page.getByTestId('train-case');
    await expect(cases).toHaveCount(5, { timeout: 30_000 });
    await expect(cases.first()).toContainText('Proposed by Claude');
    await expect(cases.first().getByTestId('train-route').first()).toBeVisible();
    await expect(cases.first().getByTestId('train-route-calls').first()).toBeHidden();
    const found = await runAxe(page, { include: '[data-testid="line-train"]' });
    expect(found.filter(isBlocking), format(found.filter(isBlocking))).toEqual([]);

    const first = cases.nth(0);
    await first.getByRole('button', { name: 'Agree', exact: true }).click();
    await expect(first.getByTestId('train-case-status')).toHaveText('You agreed.', { timeout: 30_000 });
    const second = cases.nth(1);
    await second.getByRole('button', { name: 'Disagree' }).click();
    await second.getByLabel('What is wrong with it? (optional)').fill('The preferred route should stay inside the feature.');
    await second.getByRole('button', { name: 'Send disagreement' }).click();
    await expect(second.getByTestId('train-case-status')).toHaveText('You disagreed: The preferred route should stay inside the feature.', { timeout: 30_000 });
    expect(lines('train/log.jsonl').slice(-2).map((l) => [l.by, l.action])).toEqual([['owner', 'agree'], ['owner', 'disagree']]);
  });

  test('teach: draft a request, correct the feature with one closed choice, Try it in a scratch copy, save without project words', async ({ page }) => {
    await gotoCockpit(page, '/train');
    const teach = page.getByTestId('train-teach');
    await teach.getByLabel('What should Line do?').fill('Make StatusBadge in orders, based on Badge.');
    await teach.getByRole('button', { name: 'Draft' }).click();
    const draft = page.getByTestId('train-draft');
    await expect(draft.getByTestId('train-draft-request')).toHaveText('Make StatusBadge in orders, based on Badge.');
    await expect(draft.getByTestId('train-intent').locator('option:checked')).toHaveText('Add a component to a feature');
    const route = draft.getByTestId('train-route').first();
    await expect(route).toContainText('Make StatusBadge in orders, based on the library Badge.');
    await expect(route).toContainText('Validate shows no new problems.');

    await draft.getByTestId('train-slot-F1').selectOption({ label: 'billing' });
    await expect(draft.getByTestId('train-draft-request')).toHaveText('Make StatusBadge in billing, based on Badge.');
    await expect(route).toContainText('Make StatusBadge in billing, based on the library Badge.');
    await route.getByRole('button', { name: 'Try it' }).click();
    await expect(route.getByTestId('train-try')).toHaveAttribute('data-ok', 'true', { timeout: 30_000 });
    await expect(route.getByTestId('train-try')).toContainText('It works in a scratch copy');

    await draft.getByRole('button', { name: 'Save as a training case' }).click();
    await expect(draft.getByTestId('train-saved')).toContainText('Saved as a training case with 1 valid route', { timeout: 30_000 });
    const saved = fs.readFileSync(path.join(ROOT, 'train/cases.jsonl'), 'utf8').trim().split('\n').at(-1);
    expect(JSON.parse(saved).labelledBy).toBe('owner');
    expect(saved).not.toMatch(/billing|StatusBadge|Badge/);
    const found = await runAxe(page, { include: '[data-testid="train-teach"]' });
    expect(found.filter(isBlocking), format(found.filter(isBlocking))).toEqual([]);
  });

  test('a word Line does not know: "Did you mean orders?" in one click, kept as a synonym of that project', async ({ page }) => {
    await gotoCockpit(page, '/train');
    const teach = page.getByTestId('train-teach');
    await teach.getByLabel('What should Line do?').fill('Add a Badge to ordrs.');
    await teach.getByRole('button', { name: 'Draft' }).click();
    const ask = teach.getByTestId('train-did-you-mean');
    await expect(ask).toContainText('Line does not know "ordrs". Did you mean');
    await ask.getByRole('button', { name: 'orders' }).click();
    await expect(page.getByTestId('train-draft-request')).toHaveText('Add a Badge to orders.');
    await expect(teach.getByTestId('train-did-you-mean')).toHaveCount(0);
    expect(JSON.parse(fs.readFileSync(path.join(ROOT, 'train/maps/sample.json'), 'utf8'))).toEqual({ ordrs: 'feature#1' });
    await page.getByTestId('train-domain-map').locator('summary').click();
    await expect(page.getByTestId('train-domain-map')).toContainText('ordrs');
  });

  test('scoreboard: Run eval scores the held-out projects per tool family and per kind of request', async ({ page }) => {
    await gotoCockpit(page, '/train');
    const board = page.getByTestId('train-scoreboard');
    await expect(board.getByTestId('train-last-run')).toHaveText('Eval has not run yet.');
    await board.getByRole('button', { name: 'Run eval' }).click();
    await expect(board.getByTestId('train-last-run')).toContainText('Last run', { timeout: 60_000 });
    await expect(board.getByTestId('train-score-sentence')).toContainText('held-out cases');
    const family = board.getByTestId('train-score-family');
    await expect(family.getByRole('row', { name: /Make from the library/ })).toContainText('%');
    await expect(family.getByRole('row', { name: /All cases/ })).toContainText('1 of 2');
    await board.locator('summary', { hasText: 'By kind of request' }).click();
    await expect(board.getByTestId('train-score-intent')).toContainText('Add a component to a feature');
    const found = await runAxe(page, { include: '[data-testid="train-scoreboard"]' });
    expect(found.filter(isBlocking), format(found.filter(isBlocking))).toEqual([]);
  });
});
