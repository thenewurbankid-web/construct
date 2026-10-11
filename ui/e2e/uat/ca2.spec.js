import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { clearWorkspace, clicker, closeProject, expectPlainEnglish, freshProject, openFromGate, screen, watchPage } from './support.js';

// Owner walk, ca2 (review.md "ca2 screen" UAT): open the sample, Components -> InvoiceCard -> Apply (expect "Saved." and
// 1 problem); Pages -> billing -> InvoicesPage -> Apply (expect "Fine", no problems). Each fix is a plan step the click
// approved, so the Plan panel shows it done.
test('ca2: Apply the recommended fix on Components and on Pages, one click each', async ({ page }) => {
  clearWorkspace();
  const dir = freshProject('line-sample', 'line-sample');
  const watch = watchPage(page);
  const me = clicker();
  await openFromGate(page, me, 'line-sample');
  const status = page.getByTestId('status-validate');

  let act = me.action('go to Components');
  await me.click(screen(page, 'Components'));
  act.done();
  await expect(status).toContainText('2 problems', { timeout: 30_000 });
  const card = page.getByTestId('ll-feature-row').filter({ has: page.getByText('InvoiceCard', { exact: true }) });
  const fix = card.getByTestId('line-fix');
  await expect(fix).toContainText('Base InvoiceCard.tsx on the library component Card, which it already uses.');
  await expectPlainEnglish(page.getByTestId('line-library'));

  act = me.action('Apply the fix on InvoiceCard');
  await me.click(fix.getByRole('button', { name: /^Apply: / }));
  act.done();
  await expect(page.getByTestId('ll-notice')).toContainText('Saved.');
  await expect(status).toContainText('1 problem', { timeout: 30_000 });
  await expect(page.getByTestId('line-plan').getByTestId('plan-step').first()).toHaveAttribute('data-state', 'done');
  expect(fs.readFileSync(path.join(dir, 'features/billing/components/InvoiceCard.tsx'), 'utf8')).toContain('@line-base components/Card');

  act = me.action('go to Pages, billing');
  await me.click(screen(page, 'Pages'));
  await me.click(page.getByRole('button', { name: 'billing', exact: true }));
  act.done();
  const row = page.locator('[data-testid="lp-page"][data-page="InvoicesPage"]');
  await expect(row.getByTestId('lp-page-status')).toHaveText('Needs attention', { timeout: 30_000 });
  await expectPlainEnglish(page.getByTestId('line-pages'));

  act = me.action('Apply the fix on InvoicesPage');
  await me.click(row.getByTestId('line-fix').getByRole('button', { name: /^Apply: / }));
  act.done();
  await expect(page.getByTestId('line-pages').getByTestId('lf-notice')).toContainText('Saved.');
  await expect(row.getByTestId('lp-page-status')).toHaveText('Fine', { timeout: 30_000 });
  await expect(status).toContainText('no problems', { timeout: 30_000 });

  await closeProject(page);
  watch.check();
});
