import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { noDevBadge, shot, makeProject, cleanup, startPreviewServer, PROFILE_PAGE } from './cockpit-fixture.mjs';
import { setTheme } from '../support/cockpit.js';

// Cockpit guide, stories 1-4: find a page, click-to-source, see what an agent
// changed on disk, understand how props flow. Real UI, real files.
const PREVIEW_PORT = Number(process.env.E2E_PREVIEW_PORT) || 5136;

async function openProfile(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/pages');
  await page.locator('.pages-browser select').selectOption('people');
  await page.getByRole('button', { name: 'ProfilePage.tsx' }).click();
  await expect(page.locator('.tree-panel')).toBeVisible();
}

async function loadPreview(page) {
  await page.getByLabel('Preview URL').fill(`http://127.0.0.1:${PREVIEW_PORT}/`);
  await page.getByRole('button', { name: 'Load preview' }).click();
  const frame = page.frameLocator('iframe[title="Live app preview"]');
  await expect(frame.locator('h1')).toBeVisible();
  return frame;
}

test.describe.serial('Cockpit demo: browse, preview, diff and prop flow', () => {
  let proj;
  test.beforeEach(async ({ page }) => { await noDevBadge(page); });
  let preview;

  test.beforeAll(async ({ request }) => {
    proj = await makeProject(request);
    preview = await startPreviewServer(PREVIEW_PORT);
  });
  test.afterAll(async ({ request }) => {
    preview?.close();
    await cleanup(request, proj);
  });

  test('1. find a page in the Browser and open it; the hero shows all three panes (dark, then light)', async ({ page }) => {
    await openProfile(page);
    // Tools opens by default on an editor screen; open it if not.
    if (!(await page.getByRole('complementary', { name: 'Tools' }).isVisible())) await page.getByTestId('toggle-right').click();
    await expect(page.getByRole('complementary', { name: 'Tools' })).toBeVisible();
    await loadPreview(page);
    await page.screenshot({ path: shot('cockpit-1-hero-dark.png') });
    await setTheme(page, 'light');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.screenshot({ path: shot('cockpit-hero-light.png') });
    await setTheme(page, 'dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('2. click an element in the live preview and jump to its code', async ({ page }) => {
    await openProfile(page);
    const frame = await loadPreview(page);
    await frame.locator('p').click();
    await expect(page.locator('.tree-panel .tree-node.selected')).toContainText('p');
    await expect(page.getByRole('status')).toContainText('ProfilePage.tsx:11:7');
    // The status line pushes the preview down under the pointer; hover the clicked element so its outline is the one shown.
    await frame.locator('p').hover();
    await page.waitForTimeout(400);
    await page.screenshot({ path: shot('cockpit-2-click-to-source.png') });
  });

  test('3. see what an agent changed on disk', async ({ page }) => {
    await openProfile(page);
    fs.writeFileSync(path.join(proj.dir, 'features/people/pages/ProfilePage.tsx'),
      PROFILE_PAGE.replace('<p>Welcome back</p>', '<p className="lede">Welcome back, Priya</p>'));
    const diffTab = page.getByRole('tab', { name: /^Diff/ });
    await expect(diffTab.locator('.sh-badge')).toBeVisible({ timeout: 10_000 });
    await diffTab.click();
    const notice = page.locator('.external-change-notice');
    await expect(notice).toContainText('ProfilePage.tsx changed outside the editor', { timeout: 10_000 });
    await expect(notice).toContainText('Welcome back, Priya', { timeout: 10_000 });
    await page.screenshot({ path: shot('cockpit-3-agent-change-diff.png') });
    await notice.getByRole('button', { name: 'Reload from disk' }).click();
    fs.writeFileSync(path.join(proj.dir, 'features/people/pages/ProfilePage.tsx'), PROFILE_PAGE);
  });

  test('4. understand how props flow into a component', async ({ page }) => {
    await openProfile(page);
    await page.locator('.tree-panel').getByText('<Card>', { exact: true }).click();
    await page.getByRole('tab', { name: 'Scope' }).click();
    const panel = page.locator('.scope-panel');
    await expect(panel.locator('path.scope-edge[data-from="count"][data-to="total"]')).toHaveCount(1);
    await expect(panel.locator('.scope-flag-warn', { hasText: 'Unbound prop "open"' })).toBeVisible();
    await page.screenshot({ path: shot('cockpit-4-prop-flow.png') });
  });
});
