import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.resolve(__dirname, '../screenshots');
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

const API_BASE = 'http://localhost:4000';

// #162 — the Help page dumped the entire CLI reference as one long,
// always-expanded wall of text. Each CLI topic (CliTopic.tsx) is now a
// native <details>, collapsed by default; the 4 top-level topics
// (HelpPage.tsx) are <details open> so the page still reads exactly as
// before on first load (unchanged from existing walkthrough.spec.js's
// #getting-started/#cli-reference visibility assertions), but are now
// individually collapsible. All existing content is unchanged — this only
// verifies the new collapse/expand behavior, not content.
test.describe('Help page collapsible sections (#162)', () => {
  test.beforeAll(async ({ request }) => {
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir: path.resolve(__dirname, '../../..') } });
  });

  test('1. help-topics-collapsed.png — CLI reference topics start collapsed, individually expandable', async ({ page }) => {
    await page.goto('/help');
    await expect(page.locator('h1')).toHaveText('Help');
    const cliSection = page.locator('#cli-reference');
    await expect(cliSection.getByText('Top-level overview')).toBeVisible({ timeout: 10_000 });

    // Collapsed by default: a topic's <details> exists and is visible as a
    // row (the <summary>), but its <pre> body is not.
    const firstTopic = page.locator('.help-topic').first();
    await firstTopic.scrollIntoViewIfNeeded();
    await expect(firstTopic).toBeVisible();
    await expect(firstTopic.locator('summary')).toBeVisible();
    await expect(firstTopic.locator('pre')).not.toBeVisible();
    const isOpenBefore = await firstTopic.evaluate((el) => el.hasAttribute('open'));
    expect(isOpenBefore).toBe(false);

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'help-topics-collapsed.png') });

    // Click to expand — content appears, nothing else about the page changes.
    await firstTopic.locator('summary').click();
    await expect(firstTopic.locator('pre')).toBeVisible();
    const isOpenAfter = await firstTopic.evaluate((el) => el.hasAttribute('open'));
    expect(isOpenAfter).toBe(true);

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'help-topics-expanded.png') });
  });

  test('2. top-level sections default open and stay individually collapsible', async ({ page }) => {
    await page.goto('/help');
    const gettingStarted = page.locator('#getting-started');
    await expect(gettingStarted).toBeVisible();
    await expect(gettingStarted).toContainText('Create your first feature');
    const openByDefault = await gettingStarted.evaluate((el) => el.hasAttribute('open'));
    expect(openByDefault).toBe(true);

    // Collapsing one section doesn't hide the others.
    await gettingStarted.locator('> summary').click();
    await expect(gettingStarted.getByText('Create your first feature')).not.toBeVisible();
    await expect(page.locator('#attribution')).toBeVisible();
    await expect(page.locator('#attribution')).toContainText('tool');
  });
});
