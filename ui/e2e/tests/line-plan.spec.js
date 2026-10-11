import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gotoCockpit } from './support/cockpit.js';
import { openProject } from './support/browseProject.js';
import { runAxe, isBlocking, format } from './support/axe.js';
import { failOnConsoleErrors } from './support/consoleGuard.js';

// cp1: every Cockpit Line action is a step of the project's plan. "Base on this" adds a step that waits in the Plan
// panel ("Waiting for your approval: ..."), with what is already there; nothing is written before Approve; Approve runs
// it through Construct's writer and the plan is kept in the project's line/plans/. A step whose checks fail needs the
// person: the panel lists the failing checks and offers Try again and Leave as it is, and a retry that passes no more
// checks stops instead of looping.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = path.resolve(__dirname, '../../../examples/line-sample');
const API = process.env.E2E_API_BASE || 'http://localhost:4000';
const CLIENT_ORIGIN = `http://localhost:${Number(process.env.E2E_CLIENT_PORT) || 3000}`;

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

test.describe.serial('Line: the Plan panel (Line sample project)', () => {
  failOnConsoleErrors(test);
  let base;
  let restore;

  test.beforeAll(async () => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'line-sample-')));
    fs.cpSync(SAMPLE, base, { recursive: true });
    restore = await openProject(API, base);
  });
  test.afterAll(async () => {
    await restore?.();
    if (base) fs.rmSync(base, { recursive: true, force: true });
  });

  test('Base on adds a waiting step, nothing is written before Approve, Approve writes the file, the plan is in line/plans', async ({ page }) => {
    await gotoCockpit(page, '/components');
    const plan = page.getByTestId('line-plan');
    await expect(plan).toContainText('No steps yet', { timeout: 30_000 });
    await baseOn(page, 'Badge', 'StatusBadge');

    const step = plan.getByTestId('plan-step').first();
    await expect(step).toHaveAttribute('data-state', 'waiting');
    await expect(step.getByTestId('plan-step-sentence')).toHaveText('Waiting for your approval: Creates StatusBadge in feature orders, based on the library Badge.');
    await expect(step.getByTestId('plan-step-gap')).toContainText('To do: write StatusBadge.tsx.');
    // The tool call is under Details, collapsed.
    await expect(step.getByTestId('plan-step-call')).toBeHidden();
    await step.getByText('Details', { exact: true }).click();
    await expect(step.getByTestId('plan-step-call')).toHaveText('line.baseOn({"libraryId":"components/Badge","feature":"orders","name":"StatusBadge"})');

    const file = path.join(base, 'features/orders/components/StatusBadge.tsx');
    expect(fs.existsSync(file)).toBe(false);
    const planFile = path.join(base, 'line/plans/ses-cockpit.json');
    expect(fs.existsSync(planFile)).toBe(true);

    const found = await runAxe(page, { include: '[data-testid="line-plan"]' });
    expect(found.filter(isBlocking), format(found.filter(isBlocking))).toEqual([]);

    await step.getByRole('button', { name: 'Approve step 1' }).click();
    await expect(step).toHaveAttribute('data-state', 'done');
    await expect(step.getByTestId('plan-step-sentence')).toHaveText('Saved: Creates StatusBadge in feature orders, based on the library Badge.');
    await expect(page.getByTestId('ll-notice')).toContainText('Saved. Creates StatusBadge');
    expect(fs.readFileSync(file, 'utf8').split('\n')[0]).toBe('// @line-base components/Badge');
    const saved = JSON.parse(fs.readFileSync(planFile, 'utf8'));
    expect(saved.plans[0].steps[0]).toMatchObject({ tool: 'line.baseOn', status: 'done', approval: 'given' });
    expect(saved.plans[0].steps[0].result.passed).toBe(2);
  });

  test('a step whose checks fail needs you: failing checks in plain English, Try again stops when it does not improve', async ({ page }) => {
    await gotoCockpit(page, '/components');
    const plan = page.getByTestId('line-plan');
    await baseOn(page, 'Card', 'PlanCard');
    await expect(plan.getByTestId('plan-step').first()).toHaveAttribute('data-state', 'waiting');
    // Someone else writes that file before the person approves: the step can no longer be made as planned.
    const file = path.join(base, 'features/orders/components/PlanCard.tsx');
    const theirs = '// @line-base components/Card\nexport const PlanCard = 1;\n';
    fs.writeFileSync(file, theirs);
    await page.reload();
    await expect(plan.getByTestId('plan-step').first().getByTestId('plan-step-gap')).toContainText('cannot run as it stands', { timeout: 30_000 });
    await plan.getByRole('button', { name: /^Approve step/ }).first().click();

    const needs = plan.getByTestId('plan-step').first();
    await expect(needs).toHaveAttribute('data-state', 'needs-you');
    await expect(needs.getByTestId('plan-step-sentence')).toHaveText(/^This needs you: 0 of 2 checks passed\./);
    await expect(needs.getByTestId('plan-step-failing')).toContainText('The planned files were not written, because the change could not be planned.');
    expect(fs.readFileSync(file, 'utf8')).toBe(theirs);

    await needs.getByRole('button', { name: 'Try again' }).click();
    const retry = plan.getByTestId('plan-step').first();
    await expect(retry.getByTestId('plan-step-sentence')).toHaveText(/no more than before, so Line stopped and needs you/);
    await expect(retry.getByRole('button', { name: 'Try again' })).toHaveCount(0);
    await retry.getByRole('button', { name: 'Leave as it is' }).click();
    await expect(plan.getByTestId('plan-step').first()).toHaveAttribute('data-state', 'done');
    await expect(plan.locator('[data-testid="plan-step"][data-state="needs-you"]')).toHaveCount(0);
    expect(fs.readFileSync(file, 'utf8')).toBe(theirs);

    const found = await runAxe(page, { include: '[data-testid="line-plan"]' });
    expect(found.filter(isBlocking), format(found.filter(isBlocking))).toEqual([]);
  });
  test('a refused step whose recommended fix lands is checked again and waits for approval; approving it lands it (c)', async ({ page, request }) => {
    // Promote InvoicesPage: Construct refuses it (the library copy would use orders' OrderButton). Added over the API,
    // the way an agent adds a step; the person approves and fixes it in the Plan panel.
    const added = await request.post(`${API}/api/line/plan/step`, { data: { tool: 'line.promote', args: { featureItemId: 'billing/pages/InvoicesPage' } } });
    expect(added.status()).toBe(200);
    await gotoCockpit(page, '/components');
    const plan = page.getByTestId('line-plan');
    const first = plan.getByTestId('plan-step').first();
    await expect(first).toHaveAttribute('data-state', 'waiting', { timeout: 30_000 });
    await first.getByRole('button', { name: /^Approve step/ }).click();
    const refused = plan.locator('[data-testid="plan-step"][data-state="needs-fix"]');
    await expect(refused).toHaveCount(1);
    await expect(refused.getByTestId('plan-step-fixes')).toContainText('Move OrderButton.tsx from feature orders into the library');
    expect(fs.existsSync(path.join(base, 'library/pages/InvoicesPage.tsx'))).toBe(false);

    await refused.getByRole('button', { name: 'Apply recommended fix' }).click();
    await expect(plan.getByTestId('plan-recheck')).toHaveText(/^The fix landed, and step \d+ plans clean now: it waits for your approval again\.$/);
    const again = plan.getByTestId('plan-step').first();
    await expect(again).toHaveAttribute('data-state', 'waiting');
    await expect(again.getByTestId('plan-step-sentence')).toHaveText(/^Waiting for your approval: Try step \d+ again: moves InvoicesPage from feature billing into the library/);
    await expect(plan.locator('[data-testid="plan-step"][data-state="needs-fix"]')).toHaveCount(0);
    expect(fs.existsSync(path.join(base, 'library/components/OrderButton.tsx'))).toBe(true);
    expect(fs.existsSync(path.join(base, 'library/pages/InvoicesPage.tsx'))).toBe(false);

    await again.getByRole('button', { name: /^Approve step/ }).click();
    await expect(plan.getByTestId('plan-step').first()).toHaveAttribute('data-state', 'done');
    expect(fs.existsSync(path.join(base, 'library/pages/InvoicesPage.tsx'))).toBe(true);
    const found = await runAxe(page, { include: '[data-testid="line-plan"]' });
    expect(found.filter(isBlocking), format(found.filter(isBlocking))).toEqual([]);
  });

  test('approving needs the Cockpit page: a request with no Origin, or without the approval token, is refused', async ({ request }) => {
    const added = await (await request.post(`${API}/api/line/plan/step`, { data: { tool: 'line.baseOn', args: { libraryId: 'components/Badge', feature: 'orders', name: 'TokenBadge' } } })).json();
    const noOrigin = await request.post(`${API}/api/line/plan/approve`, { data: { stepId: added.stepId } });
    expect(noOrigin.status()).toBe(403);
    expect((await noOrigin.json()).code).toBe('NOT_COCKPIT');
    const noToken = await request.post(`${API}/api/line/plan/approve`, { data: { stepId: added.stepId }, headers: { origin: CLIENT_ORIGIN } });
    expect(noToken.status()).toBe(403);
    expect((await noToken.json()).code).toBe('NO_APPROVAL');
    const view = await (await request.get(`${API}/api/line/plan`)).json();
    expect(view.steps.find((s) => s.id === added.stepId).state).toBe('waiting');
  });
});
