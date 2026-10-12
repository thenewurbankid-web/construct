import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gotoCockpit } from './support/cockpit.js';
import { openProject } from './support/browseProject.js';
import { failOnConsoleErrors } from './support/consoleGuard.js';
import { crumb, crumbLabels, expectAxeClean, lmScreen, option, toMode } from './support/lineModes.js';

// Two modes on Pages (Line sample project, real server). In chat, open orders and then OrdersPage (its parts beside the
// chat), then click the "orders" crumb: Under the hood shows Pages with orders selected and no page open.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = path.resolve(__dirname, '../../../examples/line-sample');
const API = process.env.E2E_API_BASE || 'http://localhost:4000';

const pickNamed = (page, name) => page.getByTestId('ln-pick').filter({ hasText: name }).last();

test.describe.serial('Two modes: Pages (Line sample project)', () => {
  failOnConsoleErrors(test);
  let base;
  let restore;

  test.beforeAll(async () => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'line-sample-')));
    fs.cpSync(SAMPLE, base, { recursive: true });
    restore = await openProject(API, base);
  });
  test.afterAll(async () => {
    await restore?.();
    if (base) fs.rmSync(base, { recursive: true, force: true });
  });

  test('Chat is the default; Under the hood is the Pages screen with the chat as a helper', async ({ page }) => {
    await gotoCockpit(page, '/pages');
    await expect(lmScreen(page)).toHaveAttribute('data-mode', 'chat', { timeout: 30_000 });
    await toMode(page, 'hood');
    await expect(page.getByTestId('line-pages')).toBeVisible();
    await expect(lmScreen(page)).toHaveAttribute('data-screen', 'pages');
    await expect(option(page, 'pages.open-feature')).toBeVisible();
    await expect(option(page, 'pages.plan.steps')).toBeVisible();
    await expectAxeClean(page);
  });

  test('Chat: open a page, then click its feature crumb; Under the hood shows Pages with that feature selected', async ({ page }) => {
    await gotoCockpit(page, '/pages');
    await expect(lmScreen(page)).toBeVisible({ timeout: 30_000 });
    await toMode(page, 'chat');
    await expect(page.getByTestId('line-pages')).toHaveCount(0);
    expect(await crumbLabels(page)).toEqual(['Pages']);
    await option(page, 'pages.attention').click();
    await expect(page.getByTestId('ln-msg-text').last()).toContainText('InvoicesPage in billing');
    await expectAxeClean(page);

    await option(page, 'pages.open-feature').click();
    await pickNamed(page, 'orders').click();
    await option(page, 'pages.open-page').click();
    await pickNamed(page, 'OrdersPage').click();
    expect(await crumbLabels(page)).toEqual(['Pages', 'orders', 'OrdersPage']);
    await expect(page).toHaveURL(/\/pages\?feature=orders&page=/);
    // The page is open beside the chat: its parts.
    await expect(page.getByTestId('line-pages')).toBeVisible();
    await expect(page.locator('.lp-eyebrow')).toHaveText('Feature: orders');
    await expect(page.locator('[data-testid="lp-part"]').first()).toBeVisible({ timeout: 30_000 });
    await expectAxeClean(page);

    await crumb(page, 'feature:orders').click();
    await expect(lmScreen(page)).toHaveAttribute('data-mode', 'hood');
    await expect(page).toHaveURL(/\/pages\?feature=orders$/);
    await expect(page.locator('.lp-eyebrow')).toHaveText('Feature: orders');
    await expect(page.locator('.lp-pick-hint')).toBeVisible();
    await expect(page.locator('[data-testid="lp-part"]')).toHaveCount(0);
  });
});
