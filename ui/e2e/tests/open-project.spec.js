import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAxe, isBlocking, format } from './support/axe.js';
import { setTheme } from './support/cockpit.js';

// The Open-a-project screen, simple for a beginner (owner UAT 2026-10-12): projects first as cards, one tab per
// workflow kept in the URL, a series of questions instead of a form, plain words. Real server, nothing stubbed.
// Runs under playwright.workspace.config.js (a narrow workspace of its own, no project preloaded):
//   E2E_CLIENT_PORT=3397 E2E_SERVER_PORT=4397 npx playwright test -c playwright.workspace.config.js --workers=1 open-project
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API = process.env.E2E_API_BASE || 'http://localhost:4000';
const WS = process.env.E2E_WORKSPACE_ROOT;
const BIN = path.resolve(__dirname, '../../../packages/cli/construct.mjs');

const closeProject = (request) => request.post(`${API}/api/settings`, { data: { closeProject: true } });
const clearWorkspace = () => {
  for (const name of fs.readdirSync(WS)) fs.rmSync(path.join(WS, name), { recursive: true, force: true });
};
const makeProject = (name) => {
  fs.mkdirSync(path.join(WS, name), { recursive: true });
  execFileSync(process.execPath, [BIN, 'init', path.join(WS, name)], { stdio: 'ignore' });
};

/** Counts the person's clicks: every click goes through here. */
function clicks() {
  let n = 0;
  return { click: async (locator) => { n += 1; await locator.click(); }, get count() { return n; } };
}

test.describe.serial('Open a project, simple', () => {
  test.beforeEach(async ({ request }) => {
    clearWorkspace();
    expect((await closeProject(request)).ok()).toBeTruthy();
  });
  test.afterAll(async ({ request }) => {
    await closeProject(request);
    clearWorkspace();
  });

  test('a fresh workspace: an empty projects tab says so, and a Line project takes 2 clicks plus the name and Enter', async ({ page }) => {
    await page.goto('/');
    // With no projects the screen opens on New project; Your projects says there are none yet.
    await expect(page.getByRole('tab', { name: 'New project' })).toHaveAttribute('aria-selected', 'true');
    const me = clicks();
    const panel = page.getByTestId('new-project');
    await panel.getByTestId('new-project-name').fill('acme-store');
    await panel.getByTestId('new-project-name').press('Enter');
    await expect(panel.getByTestId('new-project-kind-line').getByRole('radio')).toBeChecked();
    await me.click(panel.getByTestId('new-project-next'));
    await me.click(panel.getByTestId('new-project-create'));
    await expect(page.getByTestId('project-switcher')).toContainText('acme-store', { timeout: 30_000 });
    expect(me.count, 'clicks to create a Line project from a fresh workspace').toBeLessThanOrEqual(2);
    expect(fs.readFileSync(path.join(WS, 'acme-store', 'architecture.yml'), 'utf8')).toMatch(/^preset: line$/m);

    await page.request.post(`${API}/api/settings`, { data: { closeProject: true } });
    clearWorkspace();
    await page.goto('/?tab=projects');
    await expect(page.getByTestId('projects-empty')).toContainText('No projects yet. Start one in a click.');
    await page.getByTestId('projects-empty-new').click();
    await expect(page.getByRole('tab', { name: 'New project' })).toHaveAttribute('aria-selected', 'true');
  });

  test('projects come first as cards; one click opens one', async ({ page }) => {
    makeProject('shop');
    fs.mkdirSync(path.join(WS, 'notes'));
    await page.goto('/');
    await expect(page.getByRole('tab', { name: 'Your projects' })).toHaveAttribute('aria-selected', 'true');
    const cards = page.getByRole('region', { name: 'Your projects' });
    await expect(cards.getByRole('button', { name: 'Open shop', exact: true }).getByTestId('project-card-status')).toHaveText('Ready');
    await expect(cards.getByRole('button', { name: 'Open notes', exact: true }).getByTestId('project-card-status')).toHaveText('Needs setup');
    const me = clicks();
    await me.click(cards.getByRole('button', { name: 'Open shop', exact: true }));
    await expect(page.getByTestId('project-switcher')).toContainText('shop', { timeout: 30_000 });
    expect(me.count, 'clicks to open an existing project').toBe(1);
  });

  test('the tab is in the URL, the keyboard moves between tabs, answers are kept, and the words are plain', async ({ page }) => {
    makeProject('shop');
    await page.goto('/?tab=github');
    await expect(page.getByRole('tab', { name: 'From GitHub' })).toHaveAttribute('aria-selected', 'true');
    await page.getByTestId('clone-url').fill('octocat/Hello-World');
    await page.getByRole('tab', { name: 'From GitHub' }).focus();
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByRole('tab', { name: 'New project' })).toBeFocused();
    await expect(page).toHaveURL(/tab=new/);
    await page.keyboard.press('Home');
    await expect(page.getByRole('tab', { name: 'Your projects' })).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('End');
    await expect(page.getByTestId('clone-url')).toHaveValue('octocat/Hello-World');
    await page.reload();
    await expect(page.getByRole('tab', { name: 'From GitHub' })).toHaveAttribute('aria-selected', 'true');
    // Plain words on every tab; the workspace folder only under Details.
    for (const tab of ['Your projects', 'New project', 'From GitHub']) {
      await page.getByRole('tab', { name: tab }).click();
      const text = await page.getByTestId('no-project').innerText();
      for (const jargon of [/Construct project/i, /repositor/i, /single-page/i, /\bclone\b/i, /\btoken\b/i]) expect(text, `${tab}: ${jargon}`).not.toMatch(jargon);
      expect(text).not.toContain(WS);
    }
    await page.getByTestId('workspace-details').locator('summary').click();
    await expect(page.getByTestId('workspace-details')).toContainText(WS);
  });

  for (const [label, size] of [['1280', { width: 1280, height: 800 }], ['375', { width: 375, height: 812 }]]) {
    test(`axe and layout at ${label}px: every tab, both themes, no horizontal scroll`, async ({ page }) => {
      makeProject('shop');
      makeProject('acme-store');
      fs.mkdirSync(path.join(WS, 'notes'));
      await page.setViewportSize(size);
      for (const theme of ['dark', 'light']) {
        await page.goto('/');
        await expect(page.getByRole('region', { name: 'Your projects' }).getByTestId('project-card')).toHaveCount(3);
        await setTheme(page, theme);
        for (const tab of ['Your projects', 'New project', 'From GitHub']) {
          await page.getByRole('tab', { name: tab }).click();
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${tab} ${theme}: no horizontal scroll`).toBe(true);
          const found = (await runAxe(page)).filter(isBlocking);
          expect(found, `${tab} ${theme} ${label}\n${format(found)}`).toEqual([]);
        }
      }
    });
  }
});
