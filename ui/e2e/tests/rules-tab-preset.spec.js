import { test, expect } from '@playwright/test';
import { gotoCockpit } from './support/cockpit.js';
import { makeBrowseProject, openProject } from './support/browseProject.js';

// #395 slice 6 (#770, part of the Rules composer epic): switching to a preset (today, just `strict-nextjs`)
// previews a per-rule severity diff before anything is written, then Confirm commits it and the affected
// rows' severities update. Never a silent bulk apply.
const API = process.env.E2E_API_BASE || 'http://localhost:4000';
const browserTabs = (page) => page.getByRole('tablist', { name: 'Browser' });
const list = (page) => page.getByTestId('rules-list');
const row = (page, id) => list(page).locator(`[data-rule="${id}"]`);

test.describe.serial('Rules tab: preset picker as a diff/confirm flow (#395 slice 6)', () => {
  let project;
  let restore;

  test.beforeAll(async () => {
    project = makeBrowseProject('og395-6-rules-');
    restore = await openProject(API, project.repo);
  });
  test.afterAll(async () => {
    await restore?.();
    project?.remove();
  });

  test('names the active preset, and Change preset previews a per-rule diff before Confirm commits it', async ({ page }) => {
    await gotoCockpit(page, '/');
    await browserTabs(page).getByRole('tab', { name: 'Rules' }).click();
    await expect(list(page).getByTestId('rule-row').first()).toBeVisible();

    await expect(list(page).getByTestId('preset-active')).toContainText('strict-nextjs');

    const target = row(page, 'PAGE-004');
    await expect(target).toBeVisible();
    await target.getByTestId('rule-severity-picker').selectOption('off');
    await target.getByTestId('rule-edit-save').click();
    await expect(target.getByTestId('rule-severity')).toHaveText('Off');

    await list(page).getByTestId('preset-change').click();
    const diff = list(page).getByTestId('preset-edit-diff');
    await expect(diff).toBeVisible();
    await expect(diff).toContainText('PAGE-004');

    await list(page).getByTestId('preset-edit-save').click();
    await expect(list(page).getByTestId('preset-edit')).not.toBeVisible();
    await expect(target.getByTestId('rule-severity')).toHaveText('Error');
  });

  test('Cancel discards the pending preset switch without saving anything', async ({ page }) => {
    await gotoCockpit(page, '/');
    await browserTabs(page).getByRole('tab', { name: 'Rules' }).click();
    await expect(list(page).getByTestId('preset-active')).toBeVisible();

    await list(page).getByTestId('preset-change').click();
    await expect(list(page).getByTestId('preset-edit')).toBeVisible();
    await list(page).getByTestId('preset-edit-cancel').click();
    await expect(list(page).getByTestId('preset-edit')).not.toBeVisible();
    await expect(list(page).getByTestId('preset-line')).toBeVisible();
  });
});
