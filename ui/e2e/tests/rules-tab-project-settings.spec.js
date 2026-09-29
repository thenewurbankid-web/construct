import { test, expect } from '@playwright/test';
import { gotoCockpit } from './support/cockpit.js';
import { makeBrowseProject, openProject } from './support/browseProject.js';

// #395 slice 5 (part of the Rules composer epic, after slices A-D): features.root + project.framework (route
// adapter), inside the "Advanced" disclosure alongside nonLayer/frozen. Changing either previews the
// architecture.yml diff, then Save commits it, same per-artifact approval as the rest of the Rules tab.
const API = process.env.E2E_API_BASE || 'http://localhost:4000';
const browserTabs = (page) => page.getByRole('tablist', { name: 'Browser' });
const advanced = (page) => page.getByTestId('advanced-panel');

test.describe.serial('Rules tab: project settings, Advanced disclosure (#395 slice 5)', () => {
  let project;
  let restore;

  test.beforeAll(async () => {
    project = makeBrowseProject('og395five-rules-');
    restore = await openProject(API, project.repo);
  });
  test.afterAll(async () => {
    await restore?.();
    project?.remove();
  });

  test('the Advanced disclosure shows the current framework and features.root', async ({ page }) => {
    await gotoCockpit(page, '/');
    await browserTabs(page).getByRole('tab', { name: 'Rules' }).click();
    await advanced(page).locator('summary').click();

    const settings = advanced(page).getByTestId('project-settings');
    await expect(settings).toBeVisible();
    await expect(settings.getByTestId('project-framework-picker')).toHaveValue('nextjs');
    await expect(settings.getByTestId('project-features-root-input')).toHaveValue('features');
  });

  test('changing features.root previews the diff, Save commits it, and it is readable back', async ({ page }) => {
    await gotoCockpit(page, '/');
    await browserTabs(page).getByRole('tab', { name: 'Rules' }).click();
    await advanced(page).locator('summary').click();

    const settings = advanced(page).getByTestId('project-settings');
    await settings.getByTestId('project-features-root-input').fill('src/features');
    await settings.getByTestId('project-features-root-submit').click();

    const diff = settings.getByTestId('project-settings-edit-diff');
    await expect(diff).toBeVisible();
    await expect(diff).toContainText('src/features');

    await settings.getByTestId('project-settings-edit-save').click();
    await expect(settings.getByTestId('project-settings-edit')).not.toBeVisible();
    await expect(settings.getByTestId('project-features-root-input')).toHaveValue('src/features');
  });

  test('changing framework previews the diff and Save commits it', async ({ page }) => {
    await gotoCockpit(page, '/');
    await browserTabs(page).getByRole('tab', { name: 'Rules' }).click();
    await advanced(page).locator('summary').click();

    const settings = advanced(page).getByTestId('project-settings');
    await settings.getByTestId('project-framework-picker').selectOption('react-spa');

    const diff = settings.getByTestId('project-settings-edit-diff');
    await expect(diff).toBeVisible();
    await expect(diff).toContainText('react-spa');

    await settings.getByTestId('project-settings-edit-save').click();
    await expect(settings.getByTestId('project-settings-edit')).not.toBeVisible();
    await expect(settings.getByTestId('project-framework-picker')).toHaveValue('react-spa');
  });
});
