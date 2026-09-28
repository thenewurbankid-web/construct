import { test, expect } from '@playwright/test';
import { gotoCockpit } from './support/cockpit.js';
import { makeBrowseProject, openProject } from './support/browseProject.js';

// #393 -- the Features screen shows a feature as a hierarchy: routes nested under it, then its layers.
// This slice covers the two pieces of the mock that stand on today's data (no new analysis, no Tree/Flow
// toggle yet -- those are follow-ups filed on #393): the "Not mapped to a route yet" note with its Map to
// a route action, and a missing layer shown with its own Add action, both wired to the existing stage
// actions (Import / Create) the two only meet on the page, same as the empty feature list's Create action.
const API = process.env.E2E_API_BASE || 'http://localhost:4000';
const details = (page) => page.getByTestId('fc-details');

test.describe.serial('Feature structure: routes and layers as a hierarchy (#393)', () => {
  let project;
  let restore;

  test.beforeAll(async () => {
    project = makeBrowseProject('og393-feature-structure-');
    restore = await openProject(API, project.repo);
  });
  test.afterAll(async () => {
    await restore?.();
    project?.remove();
  });

  test('a feature with a route shows the route and layer counts', async ({ page }) => {
    await gotoCockpit(page, '/?feature=billing');
    await expect(details(page).getByRole('heading', { name: /^Routes \(1\)$/ })).toBeVisible();
    await expect(details(page).getByRole('heading', { name: /^Layers \(\d+ of \d+\)$/ })).toBeVisible();
    await expect(details(page).getByTestId('fc-no-routes')).toHaveCount(0);
  });

  test('a feature with no route shows the calm note and Map to a route opens Import', async ({ page }) => {
    await gotoCockpit(page, '/?feature=shared');
    const note = details(page).getByTestId('fc-no-routes');
    await expect(note).toContainText('Not mapped to a route yet.');
    await expect(note).toContainText('That is fine for a shared kit, or a feature you imported first.');
    await expect(page.getByTestId('stage-action-panel')).toHaveCount(0);
    await note.getByTestId('fc-map-route').click();
    await expect(page.getByTestId('stage-action-panel')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Import' })).toBeVisible();
  });

  test('a missing layer is shown dashed with its own Add action, which opens Create', async ({ page }) => {
    await gotoCockpit(page, '/?feature=shared');
    const missing = details(page).getByTestId('fc-layer-missing');
    await expect(missing.first()).toBeVisible();
    expect(await missing.count()).toBeGreaterThan(0);
    await expect(missing.first()).toContainText('missing');
    await missing.first().getByTestId('fc-add-layer').click();
    await expect(page.getByTestId('stage-action-panel')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Create' })).toBeVisible();
  });
});
