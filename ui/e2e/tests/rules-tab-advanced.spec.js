import { test, expect } from '@playwright/test';
import { gotoCockpit } from './support/cockpit.js';
import { makeBrowseProject, openProject } from './support/browseProject.js';

// #395 slice D (part of the Rules composer epic, after slices A/B/C): nonLayer/frozen glob lists behind an
// "Advanced" disclosure. Adding or removing a glob previews the architecture.yml diff, then Save commits it.
const API = process.env.E2E_API_BASE || 'http://localhost:4000';
const browserTabs = (page) => page.getByRole('tablist', { name: 'Browser' });
const advanced = (page) => page.getByTestId('advanced-panel');

test.describe.serial('Rules tab: nonLayer/frozen globs, Advanced disclosure (#395 slice D)', () => {
  let project;
  let restore;

  test.beforeAll(async () => {
    project = makeBrowseProject('og395d-rules-');
    restore = await openProject(API, project.repo);
  });
  test.afterAll(async () => {
    await restore?.();
    project?.remove();
  });

  test('the disclosure is collapsed by default and expands to show both glob lists', async ({ page }) => {
    await gotoCockpit(page, '/');
    await browserTabs(page).getByRole('tab', { name: 'Rules' }).click();
    await expect(advanced(page)).toBeVisible();
    await expect(advanced(page).getByTestId('nonlayer')).not.toBeVisible();
    await advanced(page).locator('summary').click();
    await expect(advanced(page).getByTestId('nonlayer')).toBeVisible();
    await expect(advanced(page).getByTestId('frozen')).toBeVisible();
  });

  test('adding a nonLayer glob previews the diff, Save commits it, and it appears in the list', async ({ page }) => {
    await gotoCockpit(page, '/');
    await browserTabs(page).getByRole('tab', { name: 'Rules' }).click();
    await advanced(page).locator('summary').click();

    const nonLayer = advanced(page).getByTestId('nonlayer');
    await nonLayer.getByTestId('nonlayer-input').fill('features/*/tests/**');
    await nonLayer.getByTestId('nonlayer-add-submit').click();

    const diff = nonLayer.getByTestId('nonlayer-edit-diff');
    await expect(diff).toBeVisible();
    await expect(diff).toContainText('features/*/tests/**');

    await nonLayer.getByTestId('nonlayer-edit-save').click();
    await expect(nonLayer.getByTestId('nonlayer-edit')).not.toBeVisible();
    const row = nonLayer.getByTestId('nonlayer-row');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('features/*/tests/**');
  });

  test('removing a nonLayer glob previews the diff, Save commits it, and the list empties', async ({ page }) => {
    await gotoCockpit(page, '/');
    await browserTabs(page).getByRole('tab', { name: 'Rules' }).click();
    await advanced(page).locator('summary').click();

    const nonLayer = advanced(page).getByTestId('nonlayer');
    const row = nonLayer.getByTestId('nonlayer-row');
    await expect(row).toHaveCount(1);
    await row.getByTestId('nonlayer-remove').click();
    await expect(nonLayer.getByTestId('nonlayer-edit-diff')).toBeVisible();
    await nonLayer.getByTestId('nonlayer-edit-save').click();
    await expect(nonLayer.getByTestId('nonlayer-edit')).not.toBeVisible();
    await expect(row).toHaveCount(0);
  });
});
