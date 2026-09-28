import { test, expect } from '@playwright/test';
import { gotoCockpit } from './support/cockpit.js';
import { makeBrowseProject, openProject } from './support/browseProject.js';

// #395 slice C (part of the Rules composer epic, after slice A #781 and slice B): adding or removing a scoped,
// time-boxed exception previews the architecture.yml diff it would make, then Save commits it.
const API = process.env.E2E_API_BASE || 'http://localhost:4000';
const browserTabs = (page) => page.getByRole('tablist', { name: 'Browser' });
const panel = (page) => page.getByTestId('exceptions-panel');

test.describe.serial('Rules tab: exceptions add/remove as a reviewable diff (#395 slice C)', () => {
  let project;
  let restore;

  test.beforeAll(async () => {
    project = makeBrowseProject('og395c-rules-');
    restore = await openProject(API, project.repo);
  });
  test.afterAll(async () => {
    await restore?.();
    project?.remove();
  });

  test('adding an exception previews the diff, Save commits it, and it appears in the list', async ({ page }) => {
    await gotoCockpit(page, '/');
    await browserTabs(page).getByRole('tab', { name: 'Rules' }).click();
    await expect(panel(page)).toBeVisible();

    await panel(page).getByTestId('exception-path-input').fill('features/legacy/**');
    await panel(page).getByTestId('exception-rule-select').selectOption('PAGE-004');
    await panel(page).getByTestId('exception-reason-input').fill('migrating off PAGE-004');
    await panel(page).getByTestId('exception-add-submit').click();

    const diff = panel(page).getByTestId('exception-edit-diff');
    await expect(diff).toBeVisible();
    await expect(diff).toContainText('features/legacy/**');

    await panel(page).getByTestId('exception-edit-save').click();
    await expect(panel(page).getByTestId('exception-edit')).not.toBeVisible();
    const row = panel(page).getByTestId('exception-row');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('features/legacy/**');
    await expect(row).toContainText('PAGE-004');
  });

  test('removing an exception previews the diff, Save commits it, and the list empties', async ({ page }) => {
    await gotoCockpit(page, '/');
    await browserTabs(page).getByRole('tab', { name: 'Rules' }).click();
    const row = panel(page).getByTestId('exception-row');
    await expect(row).toHaveCount(1);

    await row.getByTestId('exception-remove').click();
    await expect(panel(page).getByTestId('exception-edit-diff')).toBeVisible();
    await panel(page).getByTestId('exception-edit-save').click();
    await expect(panel(page).getByTestId('exception-edit')).not.toBeVisible();
    await expect(row).toHaveCount(0);
  });
});
