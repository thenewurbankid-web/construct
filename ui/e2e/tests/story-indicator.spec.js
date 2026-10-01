import { test, expect } from '@playwright/test';
import { gotoCockpit } from './support/cockpit.js';
import { makeBrowseProject, openProject } from './support/browseProject.js';

// #385 -- the Story indicator on the Features screen's feature rows: a quiet mark (never an action button, #385's
// "no story-dependent UI when no story.md exists" bullet) that reads `GET /api/stories/:feature` once per listed
// feature and renders through the exact same pure view as the Story tab header (`StoryIndicatorState`/`StoryIndicatorView`).
const API = process.env.E2E_API_BASE || 'http://localhost:4000';
const list = (page) => page.getByRole('complementary', { name: 'Left panel: Browse' }).getByRole('listbox', { name: 'Features' });
const row = (page, name) => list(page).getByRole('option').filter({ hasText: name });

test.describe.serial('Story indicator on Features rows (#385)', () => {
  let project;
  let restore;

  test.beforeAll(async () => {
    project = makeBrowseProject('og385-story-');
    restore = await openProject(API, project.repo);
  });
  test.afterAll(async () => {
    await restore?.();
    project?.remove();
  });

  test('a feature with no story.md shows no indicator at all', async ({ page }) => {
    await gotoCockpit(page, '/');
    await expect(row(page, 'billing')).toBeVisible();
    await expect(row(page, 'billing').getByTestId('story-indicator')).toHaveCount(0);
  });

  test('adding a story shows "may be out of date" until it is reviewed, then "matched"', async ({ page, request }) => {
    const add = await request.post(`${API}/api/stories/billing`);
    expect(add.ok()).toBe(true);

    await gotoCockpit(page, '/');
    const indicator = row(page, 'billing').getByTestId('story-indicator');
    await expect(indicator).toBeVisible();
    await expect(indicator.getByTestId('story-indicator-text')).toHaveText('may be out of date');
    // The row is quiet: no action button, even though the Story tab header would offer "mark reviewed" for the same state.
    await expect(indicator.getByTestId(/story-indicator-action-/)).toHaveCount(0);

    const view = await (await request.get(`${API}/api/stories/billing`)).json();
    const reviewed = await request.post(`${API}/api/stories/billing/reviewed`, { data: { driftHash: view.driftHash } });
    expect(reviewed.ok()).toBe(true);

    await gotoCockpit(page, '/');
    await expect(row(page, 'billing').getByTestId('story-indicator-text')).toHaveText('0/0 matched');
  });
});
