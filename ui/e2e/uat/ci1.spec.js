import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { clearWorkspace, clicker, closeProject, expectPlainEnglish, freshProject, openFromGate, watchPage } from './support/uat.js';
import { startUnderTheHood } from '../tests/support/lineModes.js';

startUnderTheHood(test);

// Owner walk, ci1 (review.md "ci1" UAT, on examples/import-sample instead of a max-ai-ui copy): open the app (it has
// only `version: 1` as its architecture.yml), find Import from the Features screen, folder src/alerts, Read folder,
// Show the plan, Apply. Expect the folder brought into Line through the plan, and nothing outside it changed.
test('ci1: Import one folder from the Features screen, through the plan, nothing outside it changes', async ({ page }) => {
  clearWorkspace();
  const dir = freshProject('import-sample', 'alerts-app');
  fs.writeFileSync(path.join(dir, 'architecture.yml'), 'version: 1\n');
  const app = fs.readFileSync(path.join(dir, 'src/App.tsx'));
  const watch = watchPage(page);
  const me = clicker();
  await openFromGate(page, me, 'alerts-app');

  let act = me.action('find Import');
  await me.click(page.getByTestId('lf-import-offer').getByRole('link', { name: 'Bring one folder of it into Line' }));
  act.done();
  const imp = page.getByTestId('line-import');
  await expect(imp).toBeVisible({ timeout: 30_000 });

  act = me.action('Read folder');
  await imp.getByLabel('Folder to bring into Line').fill('src/alerts');
  await me.click(imp.getByRole('button', { name: 'Read folder' }));
  act.done();
  await expect(imp.getByTestId('li-scan-summary')).toHaveText('Line found 6 items in src/alerts; it needs your answer to one question.', { timeout: 30_000 });
  await expectPlainEnglish(imp);

  act = me.action('Show the plan');
  await me.click(imp.getByRole('button', { name: 'Show the plan' }));
  act.done();
  await expect(imp.getByTestId('li-step').first()).toContainText('Marks src/alerts as a Line folder');
  await expectPlainEnglish(imp);

  act = me.action('Apply');
  await me.click(imp.getByRole('button', { name: 'Apply' }));
  act.done();
  await expect(imp.getByTestId('li-notice')).toContainText('Saved. Brings 6 items of src/alerts into Line', { timeout: 60_000 });
  expect(fs.existsSync(path.join(dir, 'src/alerts/architecture.yml'))).toBe(true);
  expect(fs.readFileSync(path.join(dir, 'src/App.tsx')).equals(app)).toBe(true);
  await expectPlainEnglish(imp);

  await closeProject(page);
  watch.check();
});
