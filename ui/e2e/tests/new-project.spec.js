import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { runAxe, isBlocking, format } from './support/axe.js';
import { setTheme } from './support/cockpit.js';

// #445 -- "New project" on the Open-a-project screen: a name becomes an empty folder in the workspace, initialised
// with the same `construct init` as everything else, and opened. Nothing is stubbed and no model is involved.
// Runs under playwright.workspace.config.js (a narrow workspace of its own, no project preloaded):
//   E2E_CLIENT_PORT=3200 E2E_SERVER_PORT=4200 npx playwright test -c playwright.workspace.config.js --workers=1 new-project
const API = process.env.E2E_API_BASE || 'http://localhost:4000';
const WS = process.env.E2E_WORKSPACE_ROOT;

const closeProject = (request) => request.post(`${API}/api/settings`, { data: { closeProject: true } });
const clearWorkspace = () => {
  for (const name of fs.readdirSync(WS)) fs.rmSync(path.join(WS, name), { recursive: true, force: true });
};
const entries = () => fs.readdirSync(WS).sort();

test.describe.serial('#445 New project', () => {
  test.beforeEach(async ({ request }) => {
    clearWorkspace();
    expect((await closeProject(request)).ok()).toBeTruthy();
  });
  test.afterAll(async ({ request }) => {
    await closeProject(request);
    clearWorkspace();
  });

  test('a name makes an initialised project in the workspace and opens it', async ({ page, request }) => {
    await page.goto('/?tab=new');
    const panel = page.getByTestId('new-project');
    await expect(panel.getByText('What should we call it?')).toBeVisible();
    await expect(panel.getByTestId('new-project-next')).toBeDisabled();

    await panel.getByTestId('new-project-name').fill('my-shop');
    await panel.getByTestId('new-project-next').click();
    // The second question: a Line project is recommended and chosen; a plain website sits under More options.
    await expect(panel.getByText('What kind of project?')).toBeVisible();
    await expect(panel.getByTestId('new-project-kind-line').getByRole('radio')).toBeChecked();
    await panel.getByTestId('new-project-more').locator('summary').click();
    await panel.getByTestId('new-project-kind-nextjs').click();
    await panel.getByTestId('new-project-next').click();
    await expect(panel.getByTestId('new-project-summary')).toContainText('my-shop, a Website (Next.js).');
    await panel.getByText('Details').click();
    await expect(panel.getByTestId('new-project-preview')).toContainText(path.join(WS, 'my-shop'));
    await expect(panel.getByTestId('new-project-create')).toHaveText('Create');
    await panel.getByTestId('new-project-create').click();

    // The screen reloads into the new project: the gate is gone and the switcher names it.
    await expect(page.getByRole('heading', { name: 'Your projects', level: 1 })).toHaveCount(0);
    await expect(page.getByTestId('project-switcher')).toContainText('my-shop');

    const dir = path.join(WS, 'my-shop');
    for (const f of ['architecture.yml', 'AGENTS.md', 'package.json', 'app/page.tsx']) expect(fs.existsSync(path.join(dir, f)), f).toBe(true);
    const settings = await (await request.get(`${API}/api/settings`)).json();
    expect(settings.projectRelative).toBe('my-shop');
    expect(settings.valid).toBe(true);
  });

  test('the keyboard is enough: type a name, Enter through the questions; the other kinds are offered', async ({ page }) => {
    await page.goto('/?tab=new');
    const panel = page.getByTestId('new-project');
    await panel.getByTestId('new-project-name').fill('spa-app');
    await panel.getByTestId('new-project-name').press('Enter');
    await panel.getByTestId('new-project-more').locator('summary').click();
    await panel.getByTestId('new-project-kind-react-spa').getByRole('radio').check();
    await page.keyboard.press('Enter');
    await expect(panel.getByTestId('new-project-summary')).toContainText('spa-app, a React app.');
    await panel.getByTestId('new-project-create').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Your projects', level: 1 })).toHaveCount(0);
    expect(fs.readFileSync(path.join(WS, 'spa-app', 'architecture.yml'), 'utf8')).toContain('framework: react-spa');
    expect(fs.existsSync(path.join(WS, 'spa-app', 'src', 'App.tsx'))).toBe(true);
  });

  test('Back keeps the answers, and the answers are kept when switching tabs', async ({ page }) => {
    await page.goto('/?tab=new');
    const panel = page.getByTestId('new-project');
    await panel.getByTestId('new-project-name').fill('keep-me');
    await panel.getByTestId('new-project-next').click();
    await page.getByRole('tab', { name: 'From GitHub' }).click();
    await expect(page).toHaveURL(/tab=github/);
    await page.getByRole('tab', { name: 'New project' }).click();
    await expect(panel.getByText('What kind of project?')).toBeVisible();
    await panel.getByTestId('new-project-q-back').click();
    await expect(panel.getByTestId('new-project-name')).toHaveValue('keep-me');
    expect(entries()).toEqual([]);
  });

  test('a bad name is explained as you type and cannot be sent; nothing is created', async ({ page }) => {
    await page.goto('/?tab=new');
    const panel = page.getByTestId('new-project');
    for (const [bad, hint] of [['../evil', /no slashes/], ['a/b', /no slashes/], ['/etc/passwd', /no slashes/], ['my shop', /no spaces/], ['..', /Use letters/], ['.hidden', /Use letters/]]) {
      await panel.getByTestId('new-project-name').fill(bad);
      await expect(panel, bad).toContainText(hint);
      await expect(panel.getByTestId('new-project-next'), bad).toBeDisabled();
      await panel.getByTestId('new-project-name').press('Enter');
      await expect(panel.getByText('What should we call it?'), bad).toBeVisible();
    }
    await expect(page.getByRole('heading', { name: 'Your projects', level: 1 })).toBeVisible();
    expect(entries()).toEqual([]);
  });

  test('a taken name is answered in plain words by the server on the name question, and the folder is left alone', async ({ page }) => {
    fs.mkdirSync(path.join(WS, 'taken'));
    fs.writeFileSync(path.join(WS, 'taken', 'keep.txt'), 'mine');
    await page.goto('/?tab=new');
    const panel = page.getByTestId('new-project');
    await panel.getByTestId('new-project-name').fill('taken');
    await panel.getByTestId('new-project-name').press('Enter');
    await panel.getByTestId('new-project-more').locator('summary').click();
    await panel.getByTestId('new-project-kind-nextjs').click();
    await panel.getByTestId('new-project-next').click();
    await panel.getByTestId('new-project-create').click();
    await expect(panel.getByTestId('new-project-error')).toContainText('There is already something called "taken"');
    // The refusal is shown on the question it belongs to: the name.
    await expect(panel.getByText('What should we call it?')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your projects', level: 1 })).toBeVisible();
    expect(fs.readdirSync(path.join(WS, 'taken'))).toEqual(['keep.txt']);
    // Typing another name clears the refusal.
    await panel.getByTestId('new-project-name').fill('taken-2');
    await expect(panel.getByTestId('new-project-error')).toHaveCount(0);
  });

  test('hostile names sent straight to the API are refused and create nothing outside or inside the workspace', async ({ request }) => {
    const outside = path.resolve(WS, '..');
    const outsideBefore = fs.readdirSync(outside).sort();
    for (const name of ['../escape', '..', 'a/b', '/tmp/abs', '.hidden', 'x.', 'with space', '']) {
      const res = await request.post(`${API}/api/projects`, { data: { name } });
      expect(res.status(), JSON.stringify(name)).toBe(400);
    }
    expect((await request.post(`${API}/api/projects`, { data: { name: 'ok', framework: 'rails' } })).status()).toBe(400);
    expect((await request.post(`${API}/api/projects`, { data: { name: 'evil' }, headers: { origin: 'https://evil.example' } })).status()).toBe(403);
    expect(entries()).toEqual([]);
    expect(fs.readdirSync(outside).sort()).toEqual(outsideBefore);
  });

  test('at 390px the questions fit, and it passes the accessibility scan in both themes', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    for (const theme of ['light', 'dark']) {
      await page.goto('/?tab=new');
      await expect(page.getByTestId('new-project')).toBeVisible();
      await setTheme(page, theme);
      await page.getByTestId('new-project-name').fill('narrow');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no horizontal scroll').toBe(true);
      const found = await runAxe(page);
      expect(found.filter(isBlocking), format(found)).toEqual([]);
    }
  });
});
