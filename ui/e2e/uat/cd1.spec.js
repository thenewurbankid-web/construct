import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gotoCockpit } from '../tests/support/cockpit.js';
import { openProject } from '../tests/support/browseProject.js';

// cd1 UAT walk (docs/line/review.md "cd1"): the owner's how-to, clicked through as a non-technical person would. Only
// clicks and keys on the screen; the project is opened the way the other Line specs open it. Fails on any console
// error and on any 4xx/5xx answer. Each decision takes at most two clicks (Approve is the approval gate itself).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = path.resolve(__dirname, '../../../examples/line-sample');
const API = process.env.E2E_API_BASE || 'http://localhost:4000';

test.describe.serial('UAT cd1: Features as a chat in Trace style', () => {
  let base;
  let restore;
  test.beforeAll(async () => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(process.env.E2E_WORKSPACE_ROOT ?? os.tmpdir(), 'line-sample-')));
    fs.cpSync(SAMPLE, base, { recursive: true });
    restore = await openProject(API, base);
  });
  test.afterAll(async () => {
    await restore?.();
    if (base) fs.rmSync(base, { recursive: true, force: true });
  });

  test('walk: open Features, ask what is missing, open billing, fix it, add a component to orders, switch theme', async ({ page }) => {
    test.setTimeout(180_000);
    const problems = [];
    // No exceptions: /api/review/branches answers 200 for a project that is not a repository (integrator fix).
    const known = () => false;
    let lastBad = '';
    page.on('response', (r) => {
      if (r.status() >= 400 && known(r.url())) lastBad = r.url();
      if (r.status() >= 400 && !known(r.url())) problems.push(`${r.status()} ${r.request().method()} ${r.url()}`);
    });
    page.on('console', (m) => {
      const fromKnown = m.text().startsWith('Failed to load resource') && known(m.location()?.url ?? lastBad);
      if (m.type() === 'error' && !fromKnown) problems.push(`console: ${m.text()}`);
    });
    const say = (text) => page.locator('[data-testid="ln-msg"][data-from="line"]').last().getByTestId('ln-msg-text').filter({ hasText: text });
    const button = (name) => page.getByRole('button', { name: new RegExp(`^${name}`) });

    // 1. Features opens as a full-screen chat.
    await gotoCockpit(page, '/');
    await expect(page.getByText('Your project has 2 features. Pick one to open it, or choose what to do below.')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('heading', { level: 1, name: 'Features' })).toBeVisible();

    // 2. One click: what is missing, in plain English.
    await button('What is missing\\?').click();
    await expect(say('billing needs attention')).toBeVisible();

    // 3. One click: open billing; the chat moves beside its page.
    await page.getByRole('list', { name: 'Features', exact: true }).getByRole('button', { name: /^billing/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'billing' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Ask about billing' })).toBeVisible();

    // 4. Two clicks: Fix what is wrong, the recommended fix; then Approve in the Plan.
    await button('Fix what is wrong').click();
    await page.getByRole('button', { name: /^Recommended fix/ }).first().click();
    await expect(say('Approve it in the Plan below.')).toBeVisible();
    await page.getByRole('button', { name: /^Approve step/ }).first().click();
    await expect(page.getByTestId('plan-step').first()).toHaveAttribute('data-state', /done|needs-you/, { timeout: 60_000 });

    // 5. Back to all features, open orders, two clicks to add a component from the library, then Approve.
    await button('All features').click();
    await page.getByRole('list', { name: 'Features', exact: true }).getByRole('button', { name: /^orders/ }).click();
    await button('Add from the library').click();
    await page.getByRole('list', { name: 'Library items' }).getByRole('button', { name: /^Badge/ }).click();
    await expect(say('Creates OrdersBadge in feature orders')).toBeVisible();
    await page.getByRole('button', { name: /^Approve step/ }).first().click();
    await expect(page.locator('[data-testid="lf-item"][data-item="OrdersBadge"]')).toBeVisible({ timeout: 60_000 });

    // 6. Judge the look in both themes: the command palette's theme switch (Ctrl+K, "theme", Enter).
    for (let i = 0; i < 2; i += 1) {
      await page.keyboard.press('Control+k');
      await page.keyboard.type('theme');
      await page.keyboard.press('Enter');
      await expect(page.getByRole('heading', { level: 1, name: 'orders' })).toBeVisible();
    }

    expect(problems, problems.join('\n')).toEqual([]);
  });
});
