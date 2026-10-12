import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { WS, clearWorkspace, clicker, closeProject, expectPlainEnglish, screen, watchPage } from './support/uat.js';
import { startUnderTheHood } from '../tests/support/lineModes.js';

startUnderTheHood(test);

// Owner walk, new Line project (cu7): from "Your projects", New project tab -> name "shop" -> Next -> Line project
// (chosen), first feature "catalog" under More options -> Next -> Create. Expect it opened on Features with catalog "All fine", then a first change through the plan:
// Components -> Button -> Base on this -> catalog / BuyButton -> Create -> Approve.
test('new Line project: create it, land on Features, make a first change through the plan', async ({ page }) => {
  clearWorkspace();
  const watch = watchPage(page);
  const me = clicker();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your projects', level: 1 })).toBeVisible({ timeout: 30_000 });
  const panel = page.getByTestId('new-project');
  // A fresh workspace opens on the New project tab.
  await expect(page.getByRole('tab', { name: 'New project' })).toHaveAttribute('aria-selected', 'true');
  await panel.getByTestId('new-project-name').fill('shop');
  let act = me.action('Next');
  await me.click(panel.getByTestId('new-project-next'));
  act.done();
  await panel.getByTestId('new-project-more').locator('summary').click();
  await panel.getByTestId('new-project-feature').fill('catalog');
  await expectPlainEnglish(panel);
  act = me.action('Next');
  await me.click(panel.getByTestId('new-project-next'));
  act.done();

  act = me.action('Create');
  await me.click(panel.getByTestId('new-project-create'));
  act.done();
  await expect(page.getByTestId('line-features')).toBeVisible({ timeout: 30_000 });
  const card = page.getByRole('list', { name: 'Features' }).getByTestId('ln-pick');
  await expect(card).toContainText('catalog');
  await expect(card).toContainText('All fine');
  await expectPlainEnglish(page.getByTestId('line-features'));

  act = me.action('go to Components');
  await me.click(screen(page, 'Components'));
  act.done();
  act = me.action('Base on Button');
  const button = page.getByTestId('ll-card').filter({ has: page.getByText('Button', { exact: true }) });
  await me.click(button.getByRole('button', { name: 'Base on this: Button' }));
  const form = button.getByRole('form', { name: 'Base a new component on Button' });
  await form.getByLabel('Feature').selectOption('catalog');
  await form.getByLabel('Name').fill('BuyButton');
  await me.click(form.getByRole('button', { name: 'Create' }));
  act.done();
  act = me.action('Approve');
  await me.click(page.getByTestId('line-plan').getByRole('button', { name: /^Approve step/ }).first());
  act.done();
  await expect(page.getByTestId('ll-notice')).toContainText('Saved. Creates BuyButton in feature catalog');
  expect(fs.existsSync(path.join(WS, 'shop/features/catalog/components/BuyButton.tsx'))).toBe(true);

  await closeProject(page);
  watch.check();
});
