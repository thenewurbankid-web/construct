import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gotoCockpit } from './support/cockpit.js';
import { openProject } from './support/browseProject.js';
import { runAxe, isBlocking, format } from './support/axe.js';

// cd1: Cockpit in Trace's style. In a Line project, Features opens as a full-screen chat with predefined options
// (create, open, what is missing, import, explain), options picked by stable id. Picking a feature opens its page and
// the chat moves to a side panel with that feature's options. Read options answer from the read routes; create and
// fix add a plan step that waits for approval in the Plan panel under the chat. Real server, a copy of line-sample.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = path.resolve(__dirname, '../../../examples/line-sample');
const API = process.env.E2E_API_BASE || 'http://localhost:4000';

const entry = (page) => page.getByTestId('lf-chat-entry');
const option = (page, id) => page.locator(`[data-option-id="${id}"]`);
const lastLine = (page) => page.locator('[data-testid="ln-msg"][data-from="line"]').last();
const pick = (page, id) => page.locator(`[data-testid="ln-pick"][data-item="${id}"]`).last();

async function axeClean(page, theme) {
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
  // Buttons ease their colours over 0.15s; let the theme switch finish before axe samples them.
  await page.waitForTimeout(500);
  const found = await runAxe(page, { include: '[data-testid="line-features"]' });
  expect(found.filter(isBlocking), `${theme}: ${format(found.filter(isBlocking))}`).toEqual([]);
}

test.describe.serial('Line: Features as a chat entry, in Trace style (Line sample, real server)', () => {
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

  test('Features opens as a full-screen chat: the five options by id and every feature to pick; axe clean in light and dark', async ({ page }) => {
    await gotoCockpit(page, '/');
    await expect(entry(page)).toHaveAttribute('data-layout', 'full', { timeout: 30_000 });
    await expect(page.getByRole('heading', { level: 1, name: 'Features' })).toBeVisible();
    await expect(page.getByTestId('ln-option')).toHaveCount(5);
    for (const id of ['features.open', 'features.missing', 'features.create', 'features.import', 'features.explain']) await expect(option(page, id)).toBeVisible();
    await expect(page.getByTestId('ln-msg-text').first()).toHaveText('Your project has 2 features. Pick one to open it, or choose what to do below.');
    await expect(pick(page, 'billing').getByTestId('ln-pick-status')).toHaveText('Needs attention');
    await expect(pick(page, 'orders').getByTestId('ln-pick-status')).toHaveText('All fine');
    // The old stage (impact report, stage actions) is replaced; the Cockpit frame (navigation) stays.
    await expect(page.getByRole('navigation', { name: 'Screens', exact: true }).getByRole('link', { name: 'Features' })).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('.pl-lede')).toHaveCount(0);
    await expect(page.locator('.ln')).toHaveCSS('font-family', /Inter|ui-sans-serif|system-ui/);
    await axeClean(page, 'light');
    await expect(page.locator('.ln-chat-entry')).toHaveCSS('background-color', 'rgb(243, 239, 230)');
    await axeClean(page, 'dark');
    await expect(page.locator('.ln-chat-entry')).toHaveCSS('background-color', 'rgb(23, 22, 19)');
  });

  test('read options answer in plain English, with the rule and file:line only under a collapsed Details', async ({ page }) => {
    await gotoCockpit(page, '/');
    await option(page, 'features.missing').click({ timeout: 30_000 });
    const missing = lastLine(page);
    await expect(missing.getByTestId('ln-msg-text')).toHaveText(/^billing needs attention \(2 items\)\. .*Open one to see what to do\.$/);
    await expect(missing.getByTestId('ln-msg-details').locator('li').first()).toBeHidden();
    await missing.getByText('Details', { exact: true }).click();
    await expect(missing.getByTestId('ln-msg-details')).toContainText('LINE-DIR features/billing/pages/InvoicesPage.tsx:');

    await option(page, 'features.explain').click();
    await expect(lastLine(page).getByTestId('ln-msg-text')).toContainText('every one of them is based on exactly one library item');
    await option(page, 'features.import').click();
    await expect(lastLine(page).getByTestId('ln-msg-link')).toHaveAttribute('href', '/import');
  });

  test('picking a feature opens its page with the chat as a side panel and that feature\'s options; axe clean in light and dark', async ({ page }) => {
    await gotoCockpit(page, '/');
    await pick(page, 'orders').click({ timeout: 30_000 });
    await expect(page).toHaveURL(/[?&]feature=orders/);
    await expect(entry(page)).toHaveAttribute('data-layout', 'side');
    await expect(page.getByRole('heading', { level: 1, name: 'orders' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Ask about orders' })).toBeVisible();
    await expect(page.getByTestId('lf-item')).toHaveCount(4);
    await expect(page.getByTestId('ln-option')).toHaveCount(5);
    await expect(option(page, 'feature.fix')).toBeDisabled();
    await expect(option(page, 'feature.fix')).toHaveAttribute('title', 'Nothing here has a fix Construct can apply.');
    await option(page, 'feature.missing').click();
    await expect(lastLine(page).getByTestId('ln-msg-text')).toContainText('Not covered yet:');
    await expect(page.getByTestId('line-plan')).toBeVisible();
    await axeClean(page, 'light');
    await axeClean(page, 'dark');
    await option(page, 'feature.back').click();
    await expect(entry(page)).toHaveAttribute('data-layout', 'full');
  });

  test('Add from the library is a plan step: nothing is written until Approve, then the new item is on the page', async ({ page }) => {
    await gotoCockpit(page, '/?feature=orders');
    await option(page, 'feature.add').click({ timeout: 30_000 });
    await expect(pick(page, 'components/Dialog')).toContainText('the new one is called OrdersDialog.');
    // Two clicks: Add from the library, then the library item (the suggested name is used).
    await pick(page, 'components/Dialog').click();
    await expect(lastLine(page).getByTestId('ln-msg-text')).toHaveText('Waiting for your approval: Creates OrdersDialog in feature orders, based on the library Dialog. Approve it in the Plan below.');
    const file = path.join(base, 'features/orders/components/OrdersDialog.tsx');
    expect(fs.existsSync(file)).toBe(false);
    const step = page.getByTestId('plan-step').first();
    await expect(step).toHaveAttribute('data-state', 'waiting');
    await step.getByRole('button', { name: /^Approve step/ }).click();
    await expect(step).toHaveAttribute('data-state', 'done', { timeout: 60_000 });
    expect(fs.existsSync(file)).toBe(true);
    await expect(page.locator('[data-testid="lf-item"][data-item="OrdersDialog"]')).toBeVisible({ timeout: 30_000 });
  });

  test('a taken name is refused in one sentence (code under Details), and the chat asks for another name', async ({ page }) => {
    await gotoCockpit(page, '/?feature=orders');
    await option(page, 'feature.add').click({ timeout: 30_000 });
    await pick(page, 'components/Dialog').click();
    const refusal = lastLine(page);
    await expect(refusal).toHaveAttribute('data-tone', 'refusal');
    await expect(refusal.getByTestId('ln-msg-text')).toHaveText('Feature "orders" already has a component named OrdersDialog; pick another name.');
    await refusal.getByText('Details', { exact: true }).click();
    await expect(refusal.getByTestId('ln-msg-details')).toContainText('code: NAME_TAKEN');
    const ask = page.getByRole('form', { name: 'What should the new component be called?' });
    await ask.getByLabel('What should the new component be called?').fill('OrdersConfirm');
    await ask.getByRole('button', { name: 'Add to plan' }).click();
    await expect(lastLine(page).getByTestId('ln-msg-text')).toHaveText('Waiting for your approval: Creates OrdersConfirm in feature orders, based on the library Dialog. Approve it in the Plan below.');
  });

  test('Fix what is wrong adds the recommended fix as a line.fix plan step', async ({ page }) => {
    await gotoCockpit(page, '/?feature=billing');
    await option(page, 'feature.fix').click({ timeout: 30_000 });
    await page.locator('[data-testid="ln-pick"]').filter({ hasText: 'Recommended fix' }).first().click();
    await expect(lastLine(page).getByTestId('ln-msg-text')).toHaveText(/^Waiting for your approval: .* Approve it in the Plan below\.$/);
    const step = page.getByTestId('plan-step').first();
    await expect(step).toHaveAttribute('data-state', 'waiting');
    await step.getByText('Details', { exact: true }).click();
    await expect(step.getByTestId('plan-step-call')).toHaveText(/^line\.fix\(\{"findingKey":"LINE-/);
  });

  test('Create something from the full-screen chat picks the feature, opens it and asks what to base the new item on', async ({ page }) => {
    await gotoCockpit(page, '/');
    await option(page, 'features.create').click({ timeout: 30_000 });
    await pick(page, 'orders').click();
    await expect(entry(page)).toHaveAttribute('data-layout', 'side');
    await expect(lastLine(page).getByTestId('ln-msg-text')).toHaveText('Which library item should the new item in orders be based on? It waits in the Plan for your approval.');
  });

  test('on the contract mock (?line=mock) the chat still reads, and a change says it is not saved in mock mode', async ({ page }) => {
    await gotoCockpit(page, '/?line=mock&feature=orders');
    await option(page, 'feature.add').click({ timeout: 30_000 });
    await pick(page, 'components/Button').click();
    await expect(lastLine(page).getByTestId('ln-msg-text')).toHaveText('Changes are not saved in mock mode; open the project on the server to add plan steps.');
  });
});
