import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gotoCockpit } from '../tests/support/cockpit.js';
import { openProject } from '../tests/support/browseProject.js';
import { checkSentence, splitSentences } from '../../../packages/summarize/index.mjs';
import { startUnderTheHood } from '../tests/support/lineModes.js';

startUnderTheHood(test);

// cs1 owner UAT (docs/line/review.md, "cs1", "To try it in Cockpit"), walked as a non-technical owner: open the Line
// sample, base a new component on a library item, read the Plan panel (plain English first, technical part under a
// collapsed Details), Approve, and read the Features screen's summary. Clicks only; the one API call is opening the
// sample project, which the owner does from the project picker. Fails on any console error or 4xx/5xx answer.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = path.resolve(__dirname, '../../../examples/line-sample');
const API = process.env.E2E_API_BASE || 'http://localhost:4000';

/** Every console error and every 4xx/5xx answer the walk meets. */
function watch(page) {
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  page.on('response', (r) => { if (r.status() >= 400) problems.push(`${r.status()} ${r.request().method()} ${r.url()}`); });
  return problems;
}

async function expectPlain(locator, names) {
  for (const text of await locator.allInnerTexts()) for (const s of splitSentences(text)) expect(checkSentence(s, { names }).problems, s).toEqual([]);
}

test.describe.serial('cs1 UAT: plain English first', () => {
  let base;
  let restore;

  test.beforeAll(async () => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(process.env.E2E_WORKSPACE_ROOT ?? os.tmpdir(), 'line-sample-uat-')));
    fs.cpSync(SAMPLE, base, { recursive: true });
    restore = await openProject(API, base);
  });
  test.afterAll(async () => {
    await restore?.();
    if (base) fs.rmSync(base, { recursive: true, force: true });
  });

  test('step 1-3: base a component on Badge, read the plan step in plain English, open Details, Approve (one click)', async ({ page }) => {
    const problems = watch(page);
    await gotoCockpit(page, '/components');
    const badge = page.getByTestId('ll-card').filter({ has: page.getByText('Badge', { exact: true }) });
    await badge.getByRole('button', { name: 'Base on this: Badge' }).click({ timeout: 30_000 });
    const form = badge.getByRole('form', { name: 'Base a new component on Badge' });
    await form.getByLabel('Feature').selectOption('orders');
    await form.getByLabel('Name').fill('StatusBadge');
    await form.getByRole('button', { name: 'Create' }).click();

    const plan = page.getByTestId('line-plan');
    const step = plan.getByTestId('plan-step').first();
    await expect(step.getByTestId('plan-step-sentence')).toHaveText('Waiting for your approval: Creates StatusBadge in feature orders, based on the library Badge.');
    await expect(step.getByTestId('plan-step-call')).toBeHidden();
    await expectPlain(plan.locator('[data-plain-first]'), ['StatusBadge']);
    await step.getByText('Details', { exact: true }).click();
    await expect(step.getByTestId('plan-step-call')).toBeVisible();

    await step.getByRole('button', { name: 'Approve step 1' }).click();
    await expect(step.getByTestId('plan-step-sentence')).toHaveText('Saved: Creates StatusBadge in feature orders, based on the library Badge.');
    await expectPlain(plan.locator('[data-plain-first]'), ['StatusBadge']);
    expect(fs.existsSync(path.join(base, 'features/orders/components/StatusBadge.tsx'))).toBe(true);
    expect(problems).toEqual([]);
  });

  test('step 3: the Features screen summary of orders reads as full sentences, names as written', async ({ page }) => {
    const problems = watch(page);
    await gotoCockpit(page, '/?feature=orders');
    const summary = page.getByTestId('lf-summary').locator('.lf-summary-text');
    await expect(summary).toContainText('Everything in orders passes the checks.', { timeout: 30_000 });
    await expectPlain(summary, ['orders', 'orderCheckout', 'OrdersPage', 'OrderButton', 'OrderCard', 'StatusBadge']);
    expect(problems).toEqual([]);
  });
});
