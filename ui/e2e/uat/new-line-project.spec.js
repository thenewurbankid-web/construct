import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { WS, clearWorkspace, clicker, closeProject, expectPlainEnglish, screen, watchPage } from './support/uat.js';

// Owner walk, new Line project (cu7): from "Open a project", New project -> Line project, name "shop", first feature
// "catalog" -> Create. Expect it opened on Features with catalog "All fine", then a first change through the plan:
// Components -> Button -> Base on this -> catalog / BuyButton -> Create -> Approve.
test('new Line project: create it, land on Features, make a first change through the plan', async ({ page }) => {
  clearWorkspace();
  const watch = watchPage(page);
  const me = clicker();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Open a project' })).toBeVisible({ timeout: 30_000 });
  const panel = page.getByTestId('new-project');
  await panel.getByTestId('new-project-framework').selectOption('line');
  await panel.getByTestId('new-project-name').fill('shop');
  await panel.getByTestId('new-project-feature').fill('catalog');
  await expectPlainEnglish(panel);

  let act = me.action('Create');
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
