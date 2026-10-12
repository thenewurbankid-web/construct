import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gotoCockpit } from '../tests/support/cockpit.js';
import { openProject } from '../tests/support/browseProject.js';
import { startUnderTheHood } from '../tests/support/lineModes.js';

startUnderTheHood(test);

// UAT walk, Expressions (System 1 groundwork), as a non-technical owner: in Cockpit, Base on adds a step; Approve runs
// it and Line keeps a training record of it that holds no project name. Then a second step is added, the project
// changes under it (its library item is removed), and on Approve the step's pre (what must hold before it runs) refuses
// it: the Plan panel says in one plain sentence why, and nothing is written. No API shortcuts: every action is a click.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = path.resolve(__dirname, '../../../examples/line-sample');
const API = process.env.E2E_API_BASE || `http://localhost:${process.env.E2E_SERVER_PORT || 4000}`;

const card = (page, name) => page.getByTestId('ll-card').filter({ has: page.getByText(name, { exact: true }) });

async function baseOn(page, library, name) {
  const c = card(page, library);
  await c.getByRole('button', { name: `Base on this: ${library}` }).click({ timeout: 30_000 });
  const form = c.getByRole('form', { name: `Base a new component on ${library}` });
  await form.getByLabel('Feature').selectOption('orders');
  await form.getByLabel('Name').fill(name);
  await form.getByRole('button', { name: 'Create' }).click();
  await expect(form).toHaveCount(0);
}

test.describe.serial('UAT: expressions decide a step (Line sample project)', () => {
  let base;
  let restore;
  const problems = [];

  test.beforeAll(async () => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(process.env.E2E_WORKSPACE_ROOT ?? os.tmpdir(), 'line-expr-uat-')));
    fs.cpSync(SAMPLE, base, { recursive: true });
    restore = await openProject(API, base);
  });
  test.afterAll(async () => {
    await restore?.();
    if (base) fs.rmSync(base, { recursive: true, force: true });
  });
  test.beforeEach(async ({ page }) => {
    // "Failed to load resource" console lines repeat a response that the response listener already reports by URL.
    page.on('console', (m) => { if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) problems.push(`console: ${m.text()}`); });
    page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('/_next/')) problems.push(`${r.status()} ${r.url()}`); });
  });

  test('an approved step is checked by its expressions and kept as a training record with no project name', async ({ page }) => {
    await gotoCockpit(page, '/components');
    const plan = page.getByTestId('line-plan');
    await baseOn(page, 'Badge', 'StatusBadge');
    const step = plan.getByTestId('plan-step').first();
    await step.getByRole('button', { name: 'Approve step 1' }).click();
    await expect(step).toHaveAttribute('data-state', 'done', { timeout: 30_000 });
    await expect(step.getByTestId('plan-step-sentence')).toHaveText('Saved: Creates StatusBadge in feature orders, based on the library Badge.');
    const records = fs.readFileSync(path.join(base, 'line/records/plans.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ approved: true, repaired: false, passed: 2 });
    expect(records[0].checks.every((c) => c.expr !== null)).toBe(true);
    const raw = JSON.stringify(records);
    for (const name of ['StatusBadge', 'Badge', 'orders', 'billing', 'OrderButton']) expect(raw).not.toMatch(new RegExp(`(?<![A-Za-z])${name}(?![A-Za-z])`));
    expect(problems).toEqual([]);
  });

  test('a step whose pre no longer holds is refused at Approve in one plain sentence, and nothing is written', async ({ page }) => {
    await gotoCockpit(page, '/components');
    const plan = page.getByTestId('line-plan');
    await baseOn(page, 'Card', 'ExprCard');
    const step = plan.locator('[data-testid="plan-step"][data-state="waiting"]').first();
    await expect(step).toBeVisible({ timeout: 30_000 });
    // Someone removes the library item the step is based on, before the person approves.
    fs.rmSync(path.join(base, 'library/components/Card.tsx'));
    await page.reload();
    await plan.getByRole('button', { name: /^Approve step/ }).first().click();
    const needs = plan.locator('[data-testid="plan-step"][data-state="needs-you"]').first();
    await expect(needs).toBeVisible({ timeout: 30_000 });
    await expect(needs.getByTestId('plan-step-failing')).toContainText('cannot run as the project stands: library item components/Card does not exist yet.');
    expect(fs.existsSync(path.join(base, 'features/orders/components/ExprCard.tsx'))).toBe(false);
    // Two clicks at most to carry on: Leave as it is.
    await needs.getByRole('button', { name: 'Leave as it is' }).click();
    await expect(plan.locator('[data-testid="plan-step"][data-state="needs-you"]')).toHaveCount(0);
    expect(problems.filter((p) => !/\/api\/line\/(render|page-tree|fragments)/.test(p))).toEqual([]);
  });
});
