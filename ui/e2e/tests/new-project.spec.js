import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { runAxe, isBlocking, format } from './support/axe.js';
import { setTheme } from './support/cockpit.js';
import { startUnderTheHood } from './support/lineModes.js';

// Two modes: this spec checks the screen's regular view, so it starts Under the hood (screens open in Chat by default).
startUnderTheHood(test);

// #445 -- "New project" on the Open-a-project screen: a name becomes an empty folder in the workspace, initialised
// with the same `construct init` as everything else, and opened. Nothing is stubbed and no model is involved.
// Line cu7 (merged here from line-new-project.spec.js): New project -> Line, a name and a first feature become a Line
// project (starter library, one empty feature, `preset: line`) written through Construct's writer, opened on Features.
// The keystroke check of the old UAT walk (new-project.uat.spec.js: typing used to loop React forever) is in "a bad name".
// Runs under playwright.workspace.config.js (a narrow workspace of its own, no project preloaded):
//   E2E_CLIENT_PORT=3200 E2E_SERVER_PORT=4200 npx playwright test -c playwright.workspace.config.js --workers=1 new-project
const API = process.env.E2E_API_BASE || 'http://localhost:4000';
const WS = process.env.E2E_WORKSPACE_ROOT;

const closeProject = (request) => request.post(`${API}/api/settings`, { data: { closeProject: true } });
const clearWorkspace = () => {
  for (const name of fs.readdirSync(WS)) fs.rmSync(path.join(WS, name), { recursive: true, force: true });
};
const entries = () => fs.readdirSync(WS).sort();

/** The New project questions for a Line project: the name, then the kind (Line, chosen to start with) with its first
 * feature (and folder) under More options. Leaves the series on the kind question. */
async function answerLine(panel, { name, feature, parent }) {
  await panel.getByTestId('new-project-name').fill(name);
  await panel.getByTestId('new-project-next').click();
  await expect(panel.getByTestId('new-project-kind-line').getByRole('radio')).toBeChecked();
  await panel.getByTestId('new-project-more').locator('summary').click();
  if (feature !== undefined) await panel.getByTestId('new-project-feature').fill(feature);
  if (parent !== undefined) await panel.getByTestId('new-project-parent').fill(parent);
}


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
    // Typed key by key, as a person does: every letter stays (the render loop showed on the first keystroke).
    await panel.getByTestId('new-project-name').pressSequentially('my shop');
    await expect(panel.getByTestId('new-project-name')).toHaveValue('my shop');
    await expect(panel.getByText('A project name has no spaces. Use "-" or "_" instead.')).toBeVisible();
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
    // A fresh workspace opens on New project.
    await expect(page.getByRole('tab', { name: 'New project' })).toHaveAttribute('aria-selected', 'true');
    const panel = page.getByTestId('new-project');
    await answerLine(panel, { name: 'shop', feature: '' });
    await expect(panel.getByTestId('new-project-next')).toBeDisabled(); // no first feature
    await panel.getByTestId('new-project-feature').fill('catalog');
    await expect(panel.getByTestId('new-project-kind-line')).toContainText('Starts with a small library');
    await panel.getByTestId('new-project-next').click();
    await expect(panel.getByTestId('new-project-summary')).toContainText('shop, a Line project.');
    await expect(panel.getByTestId('new-project-summary')).toContainText('one empty part called catalog');
    await panel.getByText('Details').click();
    await expect(panel.getByTestId('new-project-preview')).toContainText(path.join(WS, 'shop'));

    const found = await runAxe(page, { include: '[data-testid="new-project"]' });
    expect(found.filter(isBlocking), format(found.filter(isBlocking))).toEqual([]);

    await panel.getByTestId('new-project-create').click();

    // Opened, on Features, with the one empty feature fine.
    await expect(page.getByRole('heading', { name: 'Your projects', level: 1 })).toHaveCount(0);
    onNewProjectScreen = false;
    await expect(page.getByTestId('line-features')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('navigation', { name: 'Screens', exact: true }).getByRole('link', { name: 'Features' })).toHaveAttribute('aria-current', 'page');
    const card = page.getByRole('list', { name: 'Features' }).getByTestId('ln-pick');
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
    await page.goto('/?tab=new');
    const panel = page.getByTestId('new-project');
    await answerLine(panel, { name: 'shop', feature: 'catalog' });
    await panel.getByTestId('new-project-next').click();
    await panel.getByTestId('new-project-create').click();
    await expect(panel.getByTestId('new-project-error')).toHaveText('There is already something called "shop" in that folder; choose another name.');
    await expect(panel.getByTestId('new-project-name')).toBeVisible(); // shown on the name question
    await expect(page.getByRole('heading', { name: 'Your projects', level: 1 })).toBeVisible();
    expect(fs.readdirSync(path.join(WS, 'shop'))).toEqual(['keep.txt']);
  });

  test('a bad feature name or a folder outside the workspace is explained and cannot be sent', async ({ page }) => {
    await page.goto('/?tab=new');
    const panel = page.getByTestId('new-project');
    await answerLine(panel, { name: 'shop', feature: 'a/b' });
    await expect(panel).toContainText('A feature name uses letters, digits');
    await expect(panel.getByTestId('new-project-next')).toBeDisabled();
    await panel.getByTestId('new-project-feature').fill('catalog');
    await panel.getByTestId('new-project-parent').fill('../elsewhere');
    await expect(panel).toContainText('Pick a folder inside your workspace');
    await expect(panel.getByTestId('new-project-next')).toBeDisabled();
    expect(fs.readdirSync(WS)).toEqual([]);
  });
});
