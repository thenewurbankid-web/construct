import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gotoCockpit } from '../tests/support/cockpit.js';
import { openProject } from '../tests/support/browseProject.js';

// cu3 UAT walk (docs/line/review.md "cu3", To try it in Cockpit), as a non-technical owner: every Cockpit change is
// one tool of Line's one registry. A change to project files waits in the Plan panel for your approval and nothing is
// written before you approve; a change to Line's own settings (the workspace folder) happens at once, without asking.
// Browser only (opening the sample project is the only setup); any console error or 4xx/5xx answer fails the walk.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = path.resolve(__dirname, '../../../examples/line-sample');
const API = process.env.E2E_API_BASE || 'http://localhost:4000';

test.describe.serial('UAT cu3: one tool registry, project writes wait for approval', () => {
  let base;
  let restore;
  const problems = [];

  test.beforeAll(async () => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(process.env.E2E_WORKSPACE_ROOT ?? os.tmpdir(), 'uat-cu3-')));
    fs.cpSync(SAMPLE, base, { recursive: true });
    restore = await openProject(API, base);
  });
  test.afterAll(async () => {
    await restore?.();
    if (base) fs.rmSync(base, { recursive: true, force: true });
  });
  test.beforeEach(async ({ page }) => {
    problems.length = 0;
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
    page.on('response', (r) => { if (r.status() >= 400) problems.push(`${r.status()} ${r.request().method()} ${r.url()}`); });
  });
  test.afterEach(() => {
    expect(problems, 'no console errors and no 4xx/5xx answers during the walk').toEqual([]);
  });

  test('1-3: Base on a library item waits for my approval, nothing is written until I approve, then it is saved', async ({ page }) => {
    await gotoCockpit(page, '/components');
    const plan = page.getByTestId('line-plan');
    await expect(plan).toContainText('No steps yet', { timeout: 30_000 });

    const card = page.getByTestId('ll-card').filter({ has: page.getByText('Badge', { exact: true }) });
    await card.getByRole('button', { name: 'Base on this: Badge' }).click({ timeout: 30_000 });
    const form = card.getByRole('form', { name: 'Base a new component on Badge' });
    await form.getByLabel('Feature').selectOption('orders');
    await form.getByLabel('Name').fill('StatusBadge');
    await form.getByRole('button', { name: 'Create' }).click();

    const step = plan.getByTestId('plan-step').first();
    await expect(step.getByTestId('plan-step-sentence')).toHaveText('Waiting for your approval: Creates StatusBadge in feature orders, based on the library Badge.');
    const file = path.join(base, 'features/orders/components/StatusBadge.tsx');
    expect(fs.existsSync(file), 'nothing is written before I approve').toBe(false);

    await step.getByRole('button', { name: 'Approve step 1' }).click();
    await expect(step.getByTestId('plan-step-sentence')).toHaveText('Saved: Creates StatusBadge in feature orders, based on the library Badge.');
    expect(fs.existsSync(file)).toBe(true);
  });

  test('4: changing the workspace folder (Line\'s own setting) happens at once, with no approval step', async ({ page }) => {
    await gotoCockpit(page, '/components');
    const plan = page.getByTestId('line-plan');
    await expect(plan.getByTestId('plan-step')).toHaveCount(1, { timeout: 30_000 });
    await page.getByTestId('project-switcher').click();
    const popover = page.getByRole('dialog', { name: 'Switch project' });
    await popover.getByTestId('change-workspace').click();
    const picker = popover.getByRole('region', { name: 'Pick the workspace folder' });
    await picker.getByRole('button', { name: 'features/', exact: true }).click();
    await picker.getByRole('button', { name: 'Use features/orders' }).click();
    await expect(page.getByTestId('project-workspace')).toHaveText('features/orders', { timeout: 30_000 });
    await page.keyboard.press('Escape');
    // No new step: a Line setting is not a project change, so nothing waits for approval.
    await expect(plan.getByTestId('plan-step')).toHaveCount(1);
    expect(fs.readFileSync(path.join(base, 'line/log/tools.jsonl'), 'utf8')).toContain('"tool":"line.setWorkspace"');
  });
});
