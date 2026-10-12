import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gotoCockpit } from './support/cockpit.js';
import { openProject } from './support/browseProject.js';
import { failOnConsoleErrors } from './support/consoleGuard.js';
import { expectAxeClean, lmScreen, option, toMode } from './support/lineModes.js';

// Two modes on the Plan (the panel on Components and Pages; its options join each screen's chat as "<screen>.plan.*").
// A step waits for approval: in Chat, "What is in the plan?" says so and "Approve step 1" runs it through the checked
// writer, exactly as the panel's Approve does; Under the hood, the panel shows the step done.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = path.resolve(__dirname, '../../../examples/line-sample');
const API = process.env.E2E_API_BASE || 'http://localhost:4000';
const card = (page, name) => page.getByTestId('ll-card').filter({ has: page.getByText(name, { exact: true }) });

/** "Base on this" on a library card, as the person does it: the step joins the plan and waits for approval. */
async function baseOn(page, library, name) {
  const c = card(page, library);
  await c.getByRole('button', { name: `Base on this: ${library}` }).click({ timeout: 30_000 });
  const form = c.getByRole('form', { name: `Base a new component on ${library}` });
  await form.getByLabel('Feature').selectOption('orders');
  await form.getByLabel('Name').fill(name);
  await form.getByRole('button', { name: 'Create' }).click();
  await expect(form).toHaveCount(0, { timeout: 30_000 });
}

test.describe.serial('Two modes: Plan (Line sample project)', () => {
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

  test('Chat approves a waiting step; Under the hood the Plan panel shows it done', async ({ page }) => {
    const file = path.join(base, 'features/orders/components/StatusBadge.tsx');
    await gotoCockpit(page, '/components');
    await expect(lmScreen(page)).toBeVisible({ timeout: 30_000 });
    await expect(option(page, 'components.plan.steps')).toBeVisible();
    await baseOn(page, 'Badge', 'StatusBadge');
    // Under the hood: the panel's step waits, and the chat helper offers the same decision.
    await expect(page.getByTestId('plan-step').first()).toHaveAttribute('data-state', 'waiting');
    await expect(option(page, 'components.plan.approve.step-1')).toBeVisible();
    await expectAxeClean(page);

    await toMode(page, 'chat');
    await expect(page.getByTestId('line-plan')).toHaveCount(0);
    await option(page, 'components.plan.steps').click();
    await expect(page.getByTestId('ln-msg-text').last()).toContainText('Step 1: Waiting for your approval: Creates StatusBadge in feature orders');
    await expectAxeClean(page);
    expect(fs.existsSync(file)).toBe(false);
    await option(page, 'components.plan.approve.step-1').click();
    await expect(option(page, 'components.plan.approve.step-1')).toHaveCount(0, { timeout: 30_000 });
    await expect.poll(() => fs.existsSync(file)).toBe(true);

    await toMode(page, 'hood');
    await expect(page.getByTestId('plan-step').first()).toHaveAttribute('data-state', 'done');
    await expect(page.getByTestId('ll-notice')).toContainText('Saved. Creates StatusBadge');
  });

  test('the Plan options are on Pages too, in both modes', async ({ page }) => {
    await gotoCockpit(page, '/pages');
    await expect(lmScreen(page)).toBeVisible({ timeout: 30_000 });
    await expect(option(page, 'pages.plan.steps')).toBeVisible();
    await toMode(page, 'chat');
    await option(page, 'pages.plan.steps').click();
    await expect(page.getByTestId('ln-msg-text').last()).toContainText('The plan has one step, and none waits for you.');
    await toMode(page, 'hood');
  });
});
