import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gotoCockpit } from './support/cockpit.js';
import { openProject } from './support/browseProject.js';
import { failOnConsoleErrors } from './support/consoleGuard.js';
import { crumb, crumbLabels, expectAxeClean, lmScreen, option, pick, toMode } from './support/lineModes.js';

// Two modes on Components (Line sample project, real server). Under the hood is the library screen with the chat as a
// helper; Chat is the full-screen chat with the Components options. In chat, open a component, then click its feature
// crumb: Under the hood shows that feature selected, at exactly the crumb's URL.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = path.resolve(__dirname, '../../../examples/line-sample');
const API = process.env.E2E_API_BASE || 'http://localhost:4000';

test.describe.serial('Two modes: Components (Line sample project)', () => {
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

  test('Chat is the default; Under the hood is the library with the chat as a helper you can hide', async ({ page }) => {
    await gotoCockpit(page, '/components');
    await expect(lmScreen(page)).toHaveAttribute('data-mode', 'chat', { timeout: 30_000 });
    await toMode(page, 'hood');
    await expect(page.getByTestId('line-library')).toBeVisible();
    await expect(lmScreen(page)).toHaveAttribute('data-screen', 'components');
    await expect(option(page, 'components.open-feature')).toBeVisible();
    await expectAxeClean(page);
    await page.getByTestId('lm-chat-toggle').click();
    await expect(lmScreen(page)).toHaveAttribute('data-chat', 'hidden');
    await expect(option(page, 'components.open-feature')).toBeHidden();
    await expect(page.getByTestId('line-library')).toBeVisible();
  });

  test('Chat: open a component, then click its feature crumb; Under the hood shows that feature', async ({ page }) => {
    await gotoCockpit(page, '/components');
    await expect(lmScreen(page)).toBeVisible({ timeout: 30_000 });
    await toMode(page, 'chat');
    // Full-screen chat: the breadcrumb, the Components options, no library yet.
    await expect(page.getByTestId('line-library')).toHaveCount(0);
    expect(await crumbLabels(page)).toEqual(['Components']);
    await expectAxeClean(page);

    await option(page, 'components.open-feature').click();
    await pick(page, 'orders').click();
    expect(await crumbLabels(page)).toEqual(['Components', 'orders']);
    await option(page, 'components.open-component').click();
    await pick(page, 'OrderButton').click();
    expect(await crumbLabels(page)).toEqual(['Components', 'orders', 'OrderButton']);
    await expect(page).toHaveURL(/\/components\?feature=orders&component=OrderButton$/);
    // The component is open beside the chat (the chat is a side panel), selected.
    await expect(page.locator('[data-testid="ll-feature-row"][data-selected="true"]')).toContainText('OrderButton');
    await option(page, 'components.explain').click();
    await expect(page.getByTestId('ln-msg-text').last()).toContainText('OrderButton is in feature orders.');
    await expectAxeClean(page);

    await crumb(page, 'feature:orders').click();
    await expect(lmScreen(page)).toHaveAttribute('data-mode', 'hood');
    await expect(page.getByTestId('lm-switch')).toHaveAttribute('data-mode', 'hood');
    await expect(page).toHaveURL(/\/components\?feature=orders$/);
    await expect(page.locator('[data-testid="ll-feature"][data-selected="true"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="ll-feature"][data-selected="true"]')).toContainText('orders');
    await expect(page.locator('[data-testid="ll-feature-row"][data-selected="true"]')).toHaveCount(0);
  });

  test('the mode is remembered: after a reload the screen opens in Chat again', async ({ page }) => {
    await gotoCockpit(page, '/components');
    await expect(lmScreen(page)).toBeVisible({ timeout: 30_000 });
    await toMode(page, 'chat');
    await page.reload();
    await expect(lmScreen(page)).toHaveAttribute('data-mode', 'chat', { timeout: 30_000 });
    await toMode(page, 'hood');
  });
});
