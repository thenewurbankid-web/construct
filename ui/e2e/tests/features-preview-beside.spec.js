import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gotoCockpit } from './support/cockpit.js';
import { makeBrowseProject, openProject } from './support/browseProject.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(__dirname, '../screenshots');
const API = process.env.E2E_API_BASE || 'http://localhost:4000';

// #840 (design 8's "Preview beside" on the Features screen), end to end: a real project, the toggle off by
// default, and the shared `@/features/live-preview` panel (#837) rendered beside the feature structure.
test.describe.serial('"Preview beside" on the Features screen (#840)', () => {
  let project;
  let restore;

  test.beforeAll(async () => {
    project = makeBrowseProject('og840-preview-beside-');
    restore = await openProject(API, project.repo);
  });
  test.afterAll(async () => {
    await restore?.();
    project?.remove();
  });

  test('off by default; toggling it on shows the shared live-preview panel beside the structure, off again hides it', async ({ page }) => {
    await gotoCockpit(page, '/');
    await page.getByRole('option', { name: /^billing/ }).click();
    await expect(page.getByTestId('fc-structure')).toBeVisible();

    const toggle = page.getByTestId('fc-preview-toggle');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('fc-preview-beside')).toHaveCount(0);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    const beside = page.getByTestId('fc-preview-beside');
    await expect(beside).toBeVisible();
    await expect(beside.getByRole('heading')).toContainText('Live app preview');
    await expect(beside.locator('input[aria-label="Preview URL"]')).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, '840-preview-beside.png') });

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('fc-preview-beside')).toHaveCount(0);
  });
});
