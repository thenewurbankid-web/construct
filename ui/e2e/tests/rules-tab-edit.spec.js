import { test, expect } from '@playwright/test';
import { gotoCockpit } from './support/cockpit.js';
import { makeBrowseProject, openProject } from './support/browseProject.js';

// #395 slice B (part of the Rules composer epic, after #781's read-only slice A): picking a new severity for a
// rule previews the architecture.yml diff it would make, then Save commits it -- the row's own severity and live
// violation count reflect the change afterwards.
const API = process.env.E2E_API_BASE || 'http://localhost:4000';
const browserTabs = (page) => page.getByRole('tablist', { name: 'Browser' });
const list = (page) => page.getByTestId('rules-list');
const row = (page, id) => list(page).locator(`[data-rule="${id}"]`);

test.describe.serial('Rules tab: severity edit as a reviewable diff (#395 slice B)', () => {
  let project;
  let restore;

  test.beforeAll(async () => {
    project = makeBrowseProject('og395b-rules-');
    restore = await openProject(API, project.repo);
  });
  test.afterAll(async () => {
    await restore?.();
    project?.remove();
  });

  test('picking a severity previews the diff, then Save commits it and the row updates', async ({ page }) => {
    await gotoCockpit(page, '/');
    await browserTabs(page).getByRole('tab', { name: 'Rules' }).click();
    await expect(list(page).getByTestId('rule-row').first()).toBeVisible();

    const target = row(page, 'PAGE-004');
    await expect(target).toBeVisible();
    await expect(target.getByTestId('rule-severity')).toHaveText('Error');

    await target.getByTestId('rule-severity-picker').selectOption('off');
    const diff = target.getByTestId('rule-edit-diff');
    await expect(diff).toBeVisible();
    await expect(diff).toContainText('PAGE-004');

    await target.getByTestId('rule-edit-save').click();
    await expect(target.getByTestId('rule-edit')).not.toBeVisible();
    await expect(target.getByTestId('rule-severity')).toHaveText('Off');
  });

  test('Cancel discards the pending edit without saving anything', async ({ page }) => {
    await gotoCockpit(page, '/');
    await browserTabs(page).getByRole('tab', { name: 'Rules' }).click();
    const target = row(page, 'PAGE-005');
    await expect(target).toBeVisible();
    const before = await target.getByTestId('rule-severity').textContent();

    await target.getByTestId('rule-severity-picker').selectOption('off');
    await expect(target.getByTestId('rule-edit-diff')).toBeVisible();
    await target.getByTestId('rule-edit-cancel').click();
    await expect(target.getByTestId('rule-edit')).not.toBeVisible();
    await expect(target.getByTestId('rule-severity')).toHaveText(before ?? '');
  });
});
