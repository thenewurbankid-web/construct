import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gotoCockpit } from './support/cockpit.js';
import { openProject } from './support/browseProject.js';
import { runAxe, isBlocking, format } from './support/axe.js';
import { failOnConsoleErrors } from './support/consoleGuard.js';

// Two modes (owner, 2026-10-12): every Cockpit screen in Chat mode (a full-screen chat with the screen's own options,
// a breadcrumb of where you are; a pick opens the item with the chat beside it) and Under the hood (the regular screen
// with the chat as a helper). One global switch in the shell, remembered per user. Real server, a copy of
// examples/line-sample. Contract: ui/client/lib/lineModes.ts; providers in each screen's domain folder.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = path.resolve(__dirname, '../../../examples/line-sample');
const API = process.env.E2E_API_BASE || 'http://localhost:4000';

const screen = (page) => page.getByTestId('lm-screen');
const crumbs = (page) => page.getByTestId('lm-crumb');
const option = (page, id) => page.locator(`[data-option-id="${id}"]`);
const pick = (page, id) => page.getByTestId('ln-pick').and(page.locator(`[data-item="${id}"]`)).last();

async function toMode(page, mode) {
  await expect(screen(page)).toBeVisible({ timeout: 30_000 });
  await page.getByTestId(mode === 'chat' ? 'lm-mode-chat' : 'lm-mode-hood').click();
  await expect(screen(page)).toHaveAttribute('data-mode', mode);
}

async function axeClean(page, label) {
  // The screen in its mode, and the shell's switch (its pressed button must reach 4.5:1 in both themes).
  for (const include of ['[data-testid="lm-screen"]', '[data-testid="lm-switch"]']) {
    const found = await runAxe(page, { include });
    expect(found.filter(isBlocking), `${label} (${include}): ${format(found.filter(isBlocking))}`).toEqual([]);
  }
}

test.describe.serial('Two modes on every screen (Line sample project, real server)', () => {
  failOnConsoleErrors(test);
  let base;
  let restore;

  test.beforeAll(async () => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'line-modes-')));
    fs.cpSync(SAMPLE, base, { recursive: true });
    restore = await openProject(API, base);
  });
  test.afterAll(async () => {
    await restore?.();
    if (base) fs.rmSync(base, { recursive: true, force: true });
  });
  // Each test starts with no mode picked (each screen's default) and the chat helper shown.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      if (sessionStorage.getItem('lm-test-started')) return;
      sessionStorage.setItem('lm-test-started', '1');
      for (const k of Object.keys(localStorage)) if (k.startsWith('cockpit.mode')) localStorage.removeItem(k);
    });
  });

  test('Features: chat first; in chat, open orders → OrdersPage, click "orders": Under the hood shows Features with orders open', async ({ page }) => {
    await gotoCockpit(page, '/');
    await expect(screen(page)).toHaveAttribute('data-mode', 'chat', { timeout: 30_000 });
    await expect(page.getByTestId('lm-mode-chat')).toHaveAttribute('aria-pressed', 'true');
    await expect(crumbs(page)).toHaveText(['Features']);
    await pick(page, 'orders').click();
    await expect(crumbs(page)).toHaveText(['Features', 'orders']);
    await option(page, 'feature.items').click();
    await pick(page, 'OrdersPage').click();
    await expect(crumbs(page)).toHaveText(['Features', 'orders', 'OrdersPage']);
    await expect(page).toHaveURL(/\?feature=orders&item=OrdersPage$/);
    await option(page, 'feature.parts').click();
    await pick(page, 'title').click();
    await expect(crumbs(page)).toHaveText(['Features', 'orders', 'OrdersPage', 'title']);
    await expect(crumbs(page).last()).toHaveAttribute('aria-current', 'location');
    await axeClean(page, 'Features chat, side panel');

    await crumbs(page).filter({ hasText: /^orders$/ }).click();
    await expect(screen(page)).toHaveAttribute('data-mode', 'hood');
    await expect(page.getByTestId('lm-mode-hood')).toHaveAttribute('aria-pressed', 'true');
    await expect(page).toHaveURL(/\?feature=orders$/);
    await expect(page.getByTestId('lf-detail')).toContainText('Feature: orders');
    await expect(page.locator('[data-testid="lf-item"][data-open]')).toHaveCount(0);
    await axeClean(page, 'Features under the hood');

    // The mode is remembered: a reload stays under the hood, at the same place.
    await page.reload();
    await expect(screen(page)).toHaveAttribute('data-mode', 'hood', { timeout: 30_000 });
    await expect(page.getByTestId('lf-detail')).toContainText('Feature: orders');
    // The chat helper hides and shows.
    await page.getByTestId('lm-chat-toggle').click();
    await expect(page.getByTestId('lf-chat-entry').getByTestId('ln-chat')).toBeHidden();
    await page.getByTestId('lm-chat-toggle').click();
    await expect(page.getByTestId('lf-chat-entry').getByTestId('ln-chat')).toBeVisible();
  });

  test('Features: an item crumb lands under the hood with that item marked; with no feature, Under the hood is the feature cards', async ({ page }) => {
    await gotoCockpit(page, '/?feature=orders&item=OrdersPage');
    await toMode(page, 'chat');
    await expect(crumbs(page)).toHaveText(['Features', 'orders', 'OrdersPage'], { timeout: 30_000 });
    await crumbs(page).filter({ hasText: 'OrdersPage' }).click();
    await expect(screen(page)).toHaveAttribute('data-mode', 'hood');
    await expect(page.locator('[data-testid="lf-item"][data-open]')).toHaveAttribute('data-item', 'OrdersPage');
    await toMode(page, 'chat');
    await crumbs(page).first().click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId('lf-feature')).toHaveCount(2);
  });

  test('live stage: in chat, OrdersPage shows as the focused block and is outlined beside the chat; an approved step shows as done', async ({ page }) => {
    const stage = page.getByTestId('lm-stage');
    const block = (id) => stage.locator(`[data-testid="lm-stage-block"][data-block="${id}"]`);
    await gotoCockpit(page, '/');
    await expect(screen(page)).toHaveAttribute('data-mode', 'chat', { timeout: 30_000 });
    await pick(page, 'orders').click();
    await option(page, 'feature.items').click();
    await pick(page, 'OrdersPage').click();
    await expect(block('item:OrdersPage')).toHaveAttribute('data-focus', 'true');
    await expect(block('item:OrdersPage')).toHaveAttribute('data-kind', 'page');
    await expect(block('item:OrdersPage')).toContainText('Based on ListPage');
    await expect(block('feature:orders')).toContainText('All fine');
    // The part in focus is outlined in the view beside the chat (static ladder: its data-item id).
    await expect(page.locator('[data-testid="lf-item"][data-item="OrdersPage"]')).toHaveAttribute('data-lm-focus', 'line-id');
    await axeClean(page, 'Live stage');

    // Back to orders, add a step from the library: it waits on the stage, then shows as done once approved.
    await option(page, 'features.up').click();
    await expect(block('item:OrdersPage')).toHaveCount(0);
    await option(page, 'feature.add').click();
    await pick(page, 'components/Card').click({ timeout: 30_000 });
    const waiting = stage.locator('[data-testid="lm-stage-block"][data-kind="step"][data-status="wait"]');
    await expect(waiting).toContainText('Waiting for your approval');
    await expect(waiting.getByTestId('lm-stage-state').first()).toBeVisible();
    const step = page.getByTestId('plan-step').first();
    await step.getByRole('button', { name: /^Approve step/ }).click();
    await expect(step).toHaveAttribute('data-state', 'done', { timeout: 60_000 });
    await expect(stage.locator('[data-testid="lm-stage-block"][data-kind="step"][data-status="fit"]')).toHaveCount(1);
    await expect(waiting).toHaveCount(0);
    // Folded, the stage keeps only its button.
    await page.getByTestId('lm-stage-toggle').click();
    await expect(stage.getByTestId('lm-stage-block').first()).toBeHidden();
  });

  test('Workflows: opens in Chat; open orders and its workflow, and its crumb opens the diagram', async ({ page }) => {
    await gotoCockpit(page, '/workflows');
    await expect(screen(page)).toHaveAttribute('data-mode', 'chat', { timeout: 30_000 });
    await expect(crumbs(page)).toHaveText(['Workflows']);
    await expect(option(page, 'workflows.open')).toBeEnabled({ timeout: 15_000 });
    await option(page, 'workflows.open').click();
    await pick(page, 'orders').click();
    await expect(crumbs(page)).toHaveText(['Workflows', 'orders']);
    await expect(option(page, 'workflows.up')).toHaveText(/Back to Workflows/);
    // Offered once orders' workflow files are read.
    await expect(option(page, 'workflows.open-file')).toBeEnabled({ timeout: 15_000 });
    await option(page, 'workflows.open-file').click();
    const file = page.getByTestId('ln-pick').last();
    const name = await file.getAttribute('data-item');
    await file.click();
    await expect(crumbs(page)).toHaveText(['Workflows', 'orders', name]);
    await axeClean(page, 'Workflows chat');
    await crumbs(page).last().click();
    await expect(screen(page)).toHaveAttribute('data-mode', 'hood');
    await expect(page.getByTestId('wf-crumbs')).toContainText(name);
    await axeClean(page, 'Workflows under the hood');
  });

  test('Import and the Import agent: both modes; Import\'s folder pick opens it beside the chat', async ({ page }) => {
    await gotoCockpit(page, '/import');
    await expect(screen(page)).toHaveAttribute('data-mode', 'chat', { timeout: 30_000 });
    await expect(crumbs(page)).toHaveText(['Import']);
    await expect(option(page, 'import.agent')).toBeVisible();
    // Offered once the project's folders are read; the sample may have none to import, and then the chat says so.
    await expect(option(page, 'import.folder')).toBeEnabled({ timeout: 15_000 });
    await option(page, 'import.folder').click();
    const answer = page.getByTestId('ln-msg').last();
    await expect(answer.getByTestId('ln-msg-text')).toHaveText(/^(Which folder do you want to bring into Line\?|Line found no folder it can import in this project\.)$/);
    if ((await answer.getByTestId('ln-pick').count()) > 0) {
      const folder = answer.getByTestId('ln-pick').last();
      const name = await folder.getAttribute('data-item');
      await folder.click();
      await expect(crumbs(page)).toHaveText(['Import', name]);
      await expect(page.getByTestId('line-import')).toBeVisible();
    }
    await axeClean(page, 'Import chat');

    await page.goto('/import/agent');
    await expect(screen(page)).toHaveAttribute('data-mode', 'chat', { timeout: 30_000 });
    await expect(crumbs(page)).toHaveText(['Import agent']);
    await option(page, 'import-agent.status').click();
    await expect(page.getByTestId('ln-msg-text').last()).toHaveText(/The import has not started|The agent|Review|Done/);
    await toMode(page, 'hood');
    await expect(page.getByTestId('line-import-agent')).toBeVisible();
    await axeClean(page, 'Import agent under the hood');
  });

  test('Settings and Train Line: a section crumb lands under the hood with that section marked', async ({ page }) => {
    await gotoCockpit(page, '/settings');
    await expect(screen(page)).toHaveAttribute('data-mode', 'chat', { timeout: 30_000 });
    await option(page, 'settings.open').click();
    await pick(page, 'git').click();
    await expect(crumbs(page)).toHaveText(['Settings', 'Saving to git']);
    await crumbs(page).last().click();
    await expect(screen(page)).toHaveAttribute('data-mode', 'hood');
    await expect(page.locator('#settings-git')).toHaveAttribute('data-lm-open', 'true');
    await axeClean(page, 'Settings under the hood');

    await page.goto('/train');
    await expect(screen(page)).toHaveAttribute('data-mode', 'hood', { timeout: 30_000 });
    // The crumb above switched to Under the hood, and that pick is remembered; back to Chat for Train.
    await toMode(page, 'chat');
    await option(page, 'train.open').click();
    await pick(page, 'teach').click();
    await expect(crumbs(page)).toHaveText(['Train Line', 'Teach a new request']);
    await axeClean(page, 'Train chat');
    await crumbs(page).last().click();
    await expect(page.locator('#ltr-teach-head')).toHaveAttribute('data-lm-open', 'true');
  });

  test('phone width (375): the switch, the breadcrumb and both modes are usable and clean', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await gotoCockpit(page, '/?feature=orders');
    await expect(screen(page)).toHaveAttribute('data-mode', 'chat', { timeout: 30_000 });
    await expect(page.getByTestId('lm-switch')).toBeVisible();
    await expect(crumbs(page)).toHaveText(['Features', 'orders']);
    await axeClean(page, 'Features chat at 375');
    await crumbs(page).last().click();
    await expect(screen(page)).toHaveAttribute('data-mode', 'hood');
    await axeClean(page, 'Features under the hood at 375');
    await page.goto('/settings');
    await toMode(page, 'chat');
    await axeClean(page, 'Settings chat at 375');
    // Screens-B's screens at phone width, in Chat (remembered) and Under the hood.
    for (const route of ['/components', '/pages']) {
      await page.goto(route);
      await expect(screen(page)).toHaveAttribute('data-mode', 'chat', { timeout: 30_000 });
      await axeClean(page, `${route} chat at 375`);
      await toMode(page, 'hood');
      await axeClean(page, `${route} under the hood at 375`);
      await toMode(page, 'chat');
    }
  });

  test('Open a project: with no project open, both modes on the gate; picking New project opens it beside the chat', async ({ page, request }) => {
    await request.post(`${API}/api/settings`, { data: { closeProject: true } });
    try {
      await page.goto('/');
      await expect(screen(page)).toHaveAttribute('data-mode', 'chat', { timeout: 30_000 });
      await expect(crumbs(page)).toHaveText(['Open a project']);
      await option(page, 'open.start').click();
      await pick(page, 'new').click();
      await expect(crumbs(page)).toHaveText(['Open a project', 'New project']);
      await expect(page.getByTestId('no-project')).toBeVisible();
      await axeClean(page, 'Open a project chat');
      await crumbs(page).first().click();
      await expect(screen(page)).toHaveAttribute('data-mode', 'hood');
      await axeClean(page, 'Open a project under the hood');
    } finally {
      await openProject(API, base);
    }
  });
});
