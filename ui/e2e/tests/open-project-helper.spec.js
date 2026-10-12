import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAxe, isBlocking, format } from './support/axe.js';

// The Your projects screen's chat helper with Trace and Auto (owner, 2026-10-12): plain requests fill the question
// series through Auto's moves on the real controls, Trace lights the controls, Auto stops at Create for the person,
// opening a project is one click on a card inside the answer, and an access token is never typed by Auto or chat.
// Real server, nothing stubbed. Runs under playwright.workspace.config.js:
//   E2E_CLIENT_PORT=3397 E2E_SERVER_PORT=4397 npx playwright test -c playwright.workspace.config.js --workers=1 open-project-helper
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API = process.env.E2E_API_BASE || 'http://localhost:4000';
const WS = process.env.E2E_WORKSPACE_ROOT;
const BIN = path.resolve(__dirname, '../../../packages/cli/construct.mjs');
const TOKEN = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';

const closeProject = (request) => request.post(`${API}/api/settings`, { data: { closeProject: true } });
const clearWorkspace = () => {
  for (const name of fs.readdirSync(WS)) fs.rmSync(path.join(WS, name), { recursive: true, force: true });
};
const makeProject = (name) => {
  fs.mkdirSync(path.join(WS, name), { recursive: true });
  execFileSync(process.execPath, [BIN, 'init', path.join(WS, name)], { stdio: 'ignore' });
};

async function ask(page, text) {
  const box = page.getByTestId('ln-request-input');
  await box.fill(text);
  await box.press('Enter');
}

test.describe.serial('Your projects: the chat helper, Trace and Auto', () => {
  test.beforeEach(async ({ request, page }) => {
    clearWorkspace();
    expect((await closeProject(request)).ok()).toBeTruthy();
    await page.addInitScript(() => window.sessionStorage.removeItem('cockpit.line-trace'));
  });
  test.afterAll(async ({ request }) => {
    await closeProject(request);
    clearWorkspace();
  });

  test('collapsed by default; "start a shop called acme-store" fills the questions, Trace lights Create, Auto stops there, the person clicks it', async ({ page }) => {
    makeProject('shop');
    await page.goto('/');
    await expect(page.getByTestId('open-helper')).toHaveText('Ask for help');
    await expect(page.getByTestId('open-helper-panel')).toHaveCount(0);
    await page.getByTestId('open-helper').click();
    const panel = page.getByTestId('open-helper-panel');
    await expect(panel.getByTestId('ln-option')).toHaveCount(4);
    await panel.getByTestId('trace-toggle').click();
    await ask(page, 'start a shop called acme-store');
    await expect(panel.getByTestId('ln-msg').last()).toContainText('I am filling in a new Line project called acme-store.');
    await expect(panel.getByTestId('ln-msg').last().getByTestId('ln-msg-text')).toHaveAttribute('data-motion', 'animated');
    // Auto fills the series on the real controls and stops at Create, which Trace lights.
    const series = page.getByTestId('new-project');
    const create = series.getByTestId('new-project-create');
    await expect(create).toBeVisible({ timeout: 30_000 });
    await expect(series.getByTestId('new-project-summary')).toContainText('acme-store, a Line project.');
    await expect(create).toHaveAttribute('data-line-lit', 'request');
    await expect(page.getByRole('tab', { name: 'New project' })).toHaveAttribute('data-line-lit', 'request');
    await expect(panel.getByTestId('trace-sentence')).toContainText('Start a new project.');
    await page.waitForTimeout(1500);
    expect(fs.existsSync(path.join(WS, 'acme-store')), 'Auto did not press Create').toBe(false);
    const found = (await runAxe(page)).filter(isBlocking);
    expect(found, format(found)).toEqual([]);
    // The person clicks Create; the project opens.
    await create.click();
    await expect(page.getByTestId('project-switcher')).toContainText('acme-store', { timeout: 30_000 });
    expect(fs.readFileSync(path.join(WS, 'acme-store', 'architecture.yml'), 'utf8')).toMatch(/^preset: line$/m);
  });

  test('a project card inside the answer opens the project in one click', async ({ page }) => {
    makeProject('shop');
    makeProject('notes');
    // With reduced motion the answer is not animated.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await page.getByTestId('open-helper').click();
    await ask(page, 'show my projects');
    const answer = page.getByTestId('open-helper-panel').getByTestId('ln-msg').last();
    await expect(answer).toContainText('Here are your projects:');
    await expect(answer).toContainText('One click opens one.');
    await expect(answer.getByTestId('ln-msg-text')).toHaveAttribute('data-motion', 'still');
    const card = answer.getByTestId('chat-project-card').filter({ hasText: 'notes' });
    await expect(answer.getByTestId('chat-project-card')).toHaveCount(2);
    await card.click();
    await expect(page.getByTestId('project-switcher')).toContainText('notes', { timeout: 30_000 });
  });

  test('an access token is never typed by Auto or chat, never shown in the chat and never kept', async ({ page }) => {
    const sent = [];
    page.on('request', (r) => sent.push(`${r.method()} ${r.url()} ${r.postData() ?? ''}`));
    await page.goto('/');
    await page.getByTestId('open-helper').click();
    const panel = page.getByTestId('open-helper-panel');
    await ask(page, `bring in octocat/Hello-World, my token is ${TOKEN}`);
    await expect(panel.getByTestId('ln-msg').last()).toContainText('I did not keep it');
    await expect(panel).not.toContainText(TOKEN);
    expect(await page.evaluate(() => window.sessionStorage.getItem('cockpit.line-trace') ?? '')).not.toContain(TOKEN);
    // A request without a token: Auto fills the link and waits for the person at "Is it private?".
    await ask(page, 'bring in octocat/Hello-World');
    await expect(page.getByTestId('clone-private')).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1500);
    await expect(page.getByTestId('clone-start')).toHaveCount(0); // Auto waits for the person here
    await page.getByTestId('clone-private-yes').click();
    await expect(page.getByTestId('clone-start')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('clone-q-back').click();
    await expect(page.getByTestId('clone-token')).toHaveValue('');
    expect(sent.join('\n')).not.toContain(TOKEN);
    expect(sent.some((s) => /^POST \S*\/api\/clone /.test(s)), 'nothing was brought in').toBe(false);
  });
});
