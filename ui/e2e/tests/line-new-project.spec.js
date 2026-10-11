import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { runAxe, isBlocking, format } from './support/axe.js';

// Line cu7 -- New project -> Line on the Open-a-project screen: a name and a first feature become a Line project
// (starter library, one empty feature, `preset: line`) written through Construct's writer, opened, and shown on the
// Features screen. Real server, nothing stubbed. Runs under playwright.workspace.config.js (a narrow workspace of its
// own, no project preloaded):
//   E2E_CLIENT_PORT=3347 E2E_SERVER_PORT=4357 npx playwright test -c playwright.workspace.config.js --workers=1 line-new-project
const API = process.env.E2E_API_BASE || 'http://localhost:4000';
const WS = process.env.E2E_WORKSPACE_ROOT;

const closeProject = (request) => request.post(`${API}/api/settings`, { data: { closeProject: true } });
const clearWorkspace = () => {
  for (const name of fs.readdirSync(WS)) fs.rmSync(path.join(WS, name), { recursive: true, force: true });
};

test.describe.serial('Line cu7: New project -> Line', () => {
  // Any console error while the New project screen is up fails the test (UAT found an infinite render loop in
  // useNewProject's useSyncExternalStore snapshot; React reports that as a console error). Collection stops once the
  // new project is open (`leftNewProjectScreen`): the screens after it are covered by their own specs.
  let consoleErrors;
  let onNewProjectScreen;
  // The one console line a test may expect: the browser's network note for a refusal it provoked on purpose.
  let allowRefusalOf = null;
  test.beforeEach(async ({ page, request }) => {
    clearWorkspace();
    expect((await closeProject(request)).ok()).toBeTruthy();
    consoleErrors = [];
    onNewProjectScreen = true;
    allowRefusalOf = null;
    page.on('console', (m) => {
      if (!onNewProjectScreen || m.type() !== 'error') return;
      const expected = allowRefusalOf && m.text() === `Failed to load resource: the server responded with a status of ${allowRefusalOf.status} (${allowRefusalOf.statusText})` && m.location().url.endsWith('/api/line/new-project');
      if (!expected) consoleErrors.push(`${m.text()} ${m.location().url}`);
    });
    page.on('pageerror', (e) => { if (onNewProjectScreen) consoleErrors.push(String(e)); });
  });
  test.afterEach(() => {
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
  });
  test.afterAll(async ({ request }) => {
    await closeProject(request);
    clearWorkspace();
  });

  test('Line, "shop", feature "catalog": the project is made, opened and lands on Features', async ({ page }) => {
    await page.goto('/');
    const panel = page.getByTestId('new-project');
    await panel.getByTestId('new-project-framework').selectOption('line');
    await expect(panel.getByTestId('new-project-line-intro')).toContainText('starts with a small library');
    await panel.getByTestId('new-project-name').fill('shop');
    await expect(panel.getByTestId('new-project-create')).toBeDisabled(); // no first feature yet
    await panel.getByTestId('new-project-feature').fill('catalog');
    await expect(panel.getByTestId('new-project-preview')).toContainText(path.join(WS, 'shop'));

    const found = await runAxe(page, { include: '[data-testid="new-project"]' });
    expect(found.filter(isBlocking), format(found.filter(isBlocking))).toEqual([]);

    await panel.getByTestId('new-project-create').click();

    // Opened, on Features, with the one empty feature fine.
    await expect(page.getByRole('heading', { name: 'Open a project' })).toHaveCount(0);
    onNewProjectScreen = false;
    await expect(page.getByTestId('line-features')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('navigation', { name: 'Screens', exact: true }).getByRole('link', { name: 'Features' })).toHaveAttribute('aria-current', 'page');
    const card = page.getByRole('list', { name: 'Features' }).getByTestId('lf-feature');
    await expect(card).toHaveCount(1);
    await expect(card).toContainText('catalog');
    await expect(card).toContainText('All fine');

    await card.click();
    await expect(page.getByText('Feature: catalog')).toBeVisible();
    await expect(page.getByTestId('lf-coverage')).toHaveText('0 of 1 acceptance point is covered.');
    await expect(page.getByTestId('lf-story')).toContainText('Story 1');

    const onFeatures = await runAxe(page, { include: '[data-testid="line-features"]' });
    expect(onFeatures.filter(isBlocking), format(onFeatures.filter(isBlocking))).toEqual([]);

    const dir = path.join(WS, 'shop');
    expect(fs.readFileSync(path.join(dir, 'architecture.yml'), 'utf8')).toMatch(/^preset: line$/m);
    for (const f of ['library/components/Button.tsx', 'library/components/TextField.tsx', 'library/components/Card.tsx', 'library/pages/ListPage.tsx', 'library/fixtures/item.json', 'features/catalog/spec.md', 'features/catalog/pages/.gitkeep']) {
      expect(fs.existsSync(path.join(dir, f)), f).toBe(true);
    }
  });

  test('a taken name is refused in one sentence and the folder there is left alone', async ({ page }) => {
    fs.mkdirSync(path.join(WS, 'shop'));
    fs.writeFileSync(path.join(WS, 'shop', 'keep.txt'), 'mine');
    allowRefusalOf = { status: 409, statusText: 'Conflict' };
    await page.goto('/');
    const panel = page.getByTestId('new-project');
    await panel.getByTestId('new-project-framework').selectOption('line');
    await panel.getByTestId('new-project-name').fill('shop');
    await panel.getByTestId('new-project-feature').fill('catalog');
    await panel.getByTestId('new-project-create').click();
    await expect(panel.getByTestId('new-project-error')).toHaveText('There is already something called "shop" in that folder; choose another name.');
    await expect(page.getByRole('heading', { name: 'Open a project' })).toBeVisible();
    expect(fs.readdirSync(path.join(WS, 'shop'))).toEqual(['keep.txt']);
  });

  test('a bad feature name or a folder outside the workspace is explained and cannot be sent', async ({ page }) => {
    await page.goto('/');
    const panel = page.getByTestId('new-project');
    await panel.getByTestId('new-project-framework').selectOption('line');
    await panel.getByTestId('new-project-name').fill('shop');
    await panel.getByTestId('new-project-feature').fill('a/b');
    await expect(panel).toContainText('A feature name uses letters, digits');
    await expect(panel.getByTestId('new-project-create')).toBeDisabled();
    await panel.getByTestId('new-project-feature').fill('catalog');
    await panel.getByTestId('new-project-parent').fill('../elsewhere');
    await expect(panel).toContainText('Pick a folder inside your workspace');
    await expect(panel.getByTestId('new-project-create')).toBeDisabled();
    expect(fs.readdirSync(WS)).toEqual([]);
  });
});
