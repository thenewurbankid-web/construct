import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { clearWorkspace, clicker, closeProject, expectPlainEnglish, freshProject, openFromGate, screen, watchPage } from './support/uat.js';
import { startUnderTheHood } from '../tests/support/lineModes.js';

startUnderTheHood(test);

// Owner walk, cp1 (every Line write is a plan step): open the Line sample, Components -> Badge -> Base on this ->
// orders / StatusBadge -> Create; the Plan panel says it waits for approval and nothing is written; Approve saves it.
// Then a name orders already has is refused in one sentence and the plan is unchanged.
test('cp1: Base on this waits in the Plan panel, Approve saves it, a taken name is one sentence', async ({ page }) => {
  clearWorkspace();
  const dir = freshProject('line-sample', 'line-sample');
  // The taken-name refusal below is provoked on purpose: its 400 is the plan saying no.
  const watch = watchPage(page, { allow: [/http 400: POST .*\/api\/line\/plan\/step$/, /console: Failed to load resource: .* 400 .*\/api\/line\/plan\/step/] });
  const me = clicker();
  await openFromGate(page, me, 'line-sample');

  let act = me.action('go to Components');
  await me.click(screen(page, 'Components'));
  act.done();
  const plan = page.getByTestId('line-plan');
  await expect(plan).toContainText('No steps yet', { timeout: 30_000 });

  act = me.action('Base on Badge');
  const badge = page.getByTestId('ll-card').filter({ has: page.getByText('Badge', { exact: true }) });
  await me.click(badge.getByRole('button', { name: 'Base on this: Badge' }));
  const form = badge.getByRole('form', { name: 'Base a new component on Badge' });
  await form.getByLabel('Feature').selectOption('orders');
  await form.getByLabel('Name').fill('StatusBadge');
  await me.click(form.getByRole('button', { name: 'Create' }));
  act.done();
  const step = plan.getByTestId('plan-step').first();
  await expect(step.getByTestId('plan-step-sentence')).toHaveText('Waiting for your approval: Creates StatusBadge in feature orders, based on the library Badge.', { timeout: 30_000 });
  expect(fs.existsSync(path.join(dir, 'features/orders/components/StatusBadge.tsx'))).toBe(false);
  await expectPlainEnglish(plan);

  act = me.action('Approve');
  await me.click(step.getByRole('button', { name: 'Approve step 1' }));
  act.done();
  await expect(step).toHaveAttribute('data-state', 'done');
  await expect(page.getByTestId('ll-notice')).toContainText('Saved. Creates StatusBadge in feature orders, based on the library Badge.');
  expect(fs.existsSync(path.join(dir, 'features/orders/components/StatusBadge.tsx'))).toBe(true);
  await expectPlainEnglish(page.getByTestId('line-library'));

  act = me.action('Base on Button with a taken name');
  const button = page.getByTestId('ll-card').filter({ has: page.getByText('Button', { exact: true }) });
  await me.click(button.getByRole('button', { name: 'Base on this: Button' }));
  const again = button.getByRole('form', { name: 'Base a new component on Button' });
  await again.getByLabel('Feature').selectOption('orders');
  await again.getByLabel('Name').fill('OrderButton');
  await me.click(again.getByRole('button', { name: 'Create' }));
  act.done();
  await expect(again.getByRole('alert')).toHaveText(/^.+[.?!]$/);
  await expect(again.getByRole('alert')).toContainText('OrderButton');
  await expect(plan.getByTestId('plan-step')).toHaveCount(1);

  await closeProject(page);
  watch.check();
});
