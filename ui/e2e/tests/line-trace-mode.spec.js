import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gotoCockpit } from './support/cockpit.js';
import { openProject } from './support/browseProject.js';
import { startUnderTheHood } from './support/lineModes.js';

// Two modes: this spec checks the screen's regular view, so it starts Under the hood (screens open in Chat by default).
startUnderTheHood(test);

// ct1: Auto and Trace are Line's two modes. Trace alone lights the controls and the person acts. Auto plus Trace: a
// simulated cursor goes to each control, clicks and types, with a caption per move; pause, one step, speed, replay.
// Auto alone runs the moves without the show. Either way the change is a plan step: Auto stops at Approve for the
// person unless they let Auto approve in this session, and the plan runner makes the change.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = path.resolve(__dirname, '../../../examples/line-sample');
const API = process.env.E2E_API_BASE || 'http://localhost:4000';

async function modes(page, { trace, auto, request }) {
  const bar = page.getByTestId('line-trace');
  await expect(bar).toBeVisible({ timeout: 30_000 });
  if (trace) await bar.getByTestId('trace-toggle').click();
  if (auto) await bar.getByTestId('auto-toggle').click();
  if (request) {
    await bar.getByLabel('What do you want to do?').fill(request);
    await expect(bar.getByTestId('trace-sentence')).toContainText(request.split(' ')[3]);
  }
  await bar.getByLabel('Speed').selectOption('2');
  return bar;
}

test.describe.serial('Line: Auto and Trace modes (Line sample project)', () => {
  test.describe.configure({ timeout: 90_000 });
  let base;
  let restore;
  const file = (name) => path.join(base, `features/orders/components/${name}.tsx`);

  test.beforeAll(async () => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'line-sample-')));
    fs.cpSync(SAMPLE, base, { recursive: true });
    restore = await openProject(API, base);
  });
  test.afterAll(async () => {
    await restore?.();
    if (base) fs.rmSync(base, { recursive: true, force: true });
  });

  test('Trace alone: controls light up, Auto offers nothing to run', async ({ page }) => {
    await gotoCockpit(page, '/components');
    const bar = page.getByTestId('line-trace');
    await bar.getByTestId('trace-toggle').click({ timeout: 30_000 });
    await bar.getByLabel('What do you want to do?').fill('Base a new AloneBadge on Badge in orders');
    await expect(page.locator('[data-line-control="components.baseOn"][data-line-target="Badge"]')).toHaveAttribute('data-line-lit', 'request');
    await expect(bar.getByTestId('auto-controls')).toHaveCount(0);
  });

  test('Auto + Trace: the cursor clicks and types with a caption per move, then waits for the person at Approve', async ({ page }) => {
    await gotoCockpit(page, '/components');
    const bar = await modes(page, { trace: true, auto: true, request: 'Base a new ShowBadge on Badge in orders' });
    await bar.getByTestId('auto-run').click();
    await expect(page.getByTestId('auto-cursor')).toBeVisible();
    const caption = bar.getByTestId('auto-caption');
    await expect(caption).toHaveText('Type the name ShowBadge.', { timeout: 15_000 });
    await expect(caption).toHaveText('Waiting for you: click Approve to run the change. Auto does not approve unless you let it in this session.', { timeout: 15_000 });
    const step = page.getByTestId('plan-step').first();
    await expect(step).toHaveAttribute('data-state', 'waiting');
    await expect(step.getByTestId('plan-step-sentence')).toHaveText('Waiting for your approval: Creates ShowBadge in feature orders, based on the library Badge.');
    expect(fs.existsSync(file('ShowBadge'))).toBe(false);
    await step.getByRole('button', { name: /^Approve step/ }).click();
    await expect(step).toHaveAttribute('data-state', 'done');
    await expect(caption).toHaveText('You approved it; the plan runner runs the change.');
    expect(fs.readFileSync(file('ShowBadge'), 'utf8').split('\n')[0]).toBe('// @line-base components/Badge');
  });

  test('pause, one step, go on and stop; replay from the earlier runs changes nothing', async ({ page }) => {
    await gotoCockpit(page, '/components');
    const bar = await modes(page, { trace: true, auto: true, request: 'Base a new StepBadge on Badge in orders' });
    await bar.getByTestId('auto-run').click();
    await bar.getByTestId('auto-pause').click();
    const caption = bar.getByTestId('auto-caption');
    await expect(caption).toHaveText(/^Paused\. Next: /);
    const state = bar.getByTestId('auto-run-state');
    await expect(state).toHaveAttribute('data-status', 'paused');
    const before = await caption.textContent();
    await bar.getByTestId('auto-step').click();
    await expect(caption).not.toHaveText(before ?? '', { timeout: 10_000 });
    await expect(state).toHaveAttribute('data-status', 'paused');
    await bar.getByTestId('auto-stop').click();
    await expect(state).toHaveAttribute('data-status', 'stopped');
    await expect(caption).toHaveText('Auto stopped; nothing more will be clicked.');
    const steps = await page.getByTestId('plan-step').count();
    await bar.getByText('Earlier runs').click();
    await bar.getByRole('button', { name: 'Replay: Base a new StepBadge on Badge in orders' }).click();
    await expect(caption).toHaveText(/^Replay: /);
    await expect(caption).toHaveText('Replay finished; nothing was changed.', { timeout: 20_000 });
    await expect(page.getByTestId('plan-step')).toHaveCount(steps);
    expect(fs.existsSync(file('StepBadge'))).toBe(false);
  });

  test('Auto alone, allowed to approve in this session: no show, the step runs through the plan runner', async ({ page }) => {
    await gotoCockpit(page, '/components');
    const bar = await modes(page, { auto: true, request: 'Base a new QuietBadge on Badge in orders' });
    await expect(bar.getByTestId('auto-approve')).not.toBeChecked();
    await bar.getByTestId('auto-approve').check();
    await bar.getByRole('button', { name: 'Do it' }).click();
    await expect(bar.getByTestId('auto-caption')).toHaveText('Auto finished; the plan shows what ran.', { timeout: 20_000 });
    await expect(page.getByTestId('auto-cursor')).toHaveCount(0);
    const step = page.getByTestId('plan-step').first();
    await expect(step).toHaveAttribute('data-state', 'done');
    await expect(step.getByTestId('plan-step-sentence')).toHaveText('Saved: Creates QuietBadge in feature orders, based on the library Badge.');
    expect(fs.existsSync(file('QuietBadge'))).toBe(true);
    const saved = JSON.parse(fs.readFileSync(path.join(base, 'line/plans/ses-cockpit.json'), 'utf8'));
    expect(saved.plans[0].steps.at(-1)).toMatchObject({ tool: 'line.baseOn', status: 'done', approval: 'given' });
  });

  test('Auto + Trace goes to the screen a move is on: a page change asked on Components runs on Pages', async ({ page }) => {
    await gotoCockpit(page, '/components');
    const bar = await modes(page, { trace: true, auto: true, request: 'Change the title of OrdersPage to My orders' });
    await bar.getByTestId('auto-run').click();
    await expect(page).toHaveURL(/\/pages/, { timeout: 15_000 });
    const pagesBar = page.getByTestId('line-trace');
    await expect(pagesBar.getByTestId('auto-caption')).toHaveText(/^Waiting for you: click Approve/, { timeout: 30_000 });
    const step = page.getByTestId('plan-step').first();
    await expect(step).toHaveAttribute('data-state', 'waiting');
    await expect(step.getByTestId('plan-step-sentence')).toContainText('title');
    expect(fs.readFileSync(path.join(base, 'features/orders/pages/OrdersPage.tsx'), 'utf8')).toContain('title="Orders"');
  });
});
