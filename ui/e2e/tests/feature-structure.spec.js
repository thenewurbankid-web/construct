import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { gotoCockpit } from './support/cockpit.js';
import { makeBrowseProject, openProject } from './support/browseProject.js';

// #393 -- the Features screen shows a feature as a hierarchy: routes nested under it, then its layers.
// Covers the "Not mapped to a route yet" note with its Map to a route action, and a missing layer shown
// with its own Add action, both wired to the existing stage actions (Import / Create) the two only meet
// on the page, same as the empty feature list's Create action. Also covers #790's Tree / Flow toggle
// (Flow reuses the Pages editor's flow view, #328) and #791's Legacy files note.
const API = process.env.E2E_API_BASE || 'http://localhost:4000';
const details = (page) => page.getByTestId('fc-details');

test.describe.serial('Feature structure: routes and layers as a hierarchy (#393)', () => {
  let project;
  let restore;

  test.beforeAll(async () => {
    project = makeBrowseProject('og393-feature-structure-');
    restore = await openProject(API, project.repo);
  });
  test.afterAll(async () => {
    await restore?.();
    project?.remove();
  });

  test('a feature with a route shows the route and layer counts', async ({ page }) => {
    await gotoCockpit(page, '/?feature=billing');
    await expect(details(page).getByRole('heading', { name: /^Routes \(1\)$/ })).toBeVisible();
    await expect(details(page).getByRole('heading', { name: /^Layers \(\d+ of \d+\)$/ })).toBeVisible();
    await expect(details(page).getByTestId('fc-no-routes')).toHaveCount(0);
  });

  test('a feature with no route shows the calm note and Map to a route opens Import', async ({ page }) => {
    await gotoCockpit(page, '/?feature=shared');
    const note = details(page).getByTestId('fc-no-routes');
    await expect(note).toContainText('Not mapped to a route yet.');
    await expect(note).toContainText('That is fine for a shared kit, or a feature you imported first.');
    await expect(page.getByTestId('stage-action-panel')).toHaveCount(0);
    await note.getByTestId('fc-map-route').click();
    await expect(page.getByTestId('stage-action-panel')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Import' })).toBeVisible();
  });

  test('a missing layer is shown dashed with its own Add action, which opens Create', async ({ page }) => {
    await gotoCockpit(page, '/?feature=shared');
    const missing = details(page).getByTestId('fc-layer-missing');
    await expect(missing.first()).toBeVisible();
    expect(await missing.count()).toBeGreaterThan(0);
    await expect(missing.first()).toContainText('missing');
    await missing.first().getByTestId('fc-add-layer').click();
    await expect(page.getByTestId('stage-action-panel')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Create' })).toBeVisible();
  });

  test('the Tree / Flow switch draws the route -> controller flow instead of the Routes/Layers tree (#790)', async ({ page }) => {
    await gotoCockpit(page, '/?feature=billing');
    await expect(page.getByTestId('fc-structure')).toBeVisible();
    await expect(page.getByTestId('fc-details')).toBeVisible();
    await expect(page.getByTestId('fc-flow-details')).toHaveCount(0);
    await page.getByTestId('fc-view-flow').click();
    await expect(page.getByTestId('fc-flow-details')).toBeVisible();
    await expect(page.getByTestId('fc-details')).toHaveCount(0);
    await expect(page.getByTestId('flow-tree')).toBeVisible();
    await page.getByTestId('fc-view-tree').click();
    await expect(page.getByTestId('fc-details')).toBeVisible();
    await expect(page.getByTestId('fc-flow-details')).toHaveCount(0);
  });

  test('Flow draws a missing layer dashed with the same Add action as Tree (#790)', async ({ page }) => {
    await gotoCockpit(page, '/?feature=shared');
    await page.getByTestId('fc-view-flow').click();
    await expect(page.getByTestId('fc-flow-details')).toBeVisible();
    const missing = page.getByTestId('fc-flow-details').getByTestId('fc-layer-missing');
    await expect(missing.first()).toBeVisible();
    await missing.first().getByTestId('fc-add-layer').click();
    await expect(page.getByTestId('stage-action-panel')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Create' })).toBeVisible();
  });
});

// A project whose `features.root` is not `features` (the owner's real app uses `construct/`, per #393's
// body) shows that root in the tree header instead of pretending it's `features/`.
function makeCustomRootProject() {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'og393-custom-root-')));
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    fs.writeFileSync(path.join(repo, rel), text);
  };
  write('architecture.yml', `version: 1
preset: strict-nextjs
project:
  framework: nextjs
features:
  root: construct
layers:
  domain: { pattern: 'construct/*/domain/**' }
  page: { pattern: 'construct/*/pages/**' }
`);
  write('construct/billing/index.ts', "export { BillingPage } from './pages/BillingPage';\n");
  write('construct/billing/domain/rules.ts', 'export function total(a: number, b: number) { return a + b; }\n');
  write('construct/billing/pages/BillingPage.tsx', "export function BillingPage() {\n  return <div />;\n}\n");
  // Pre-existing app code outside construct/, not managed by Construct -- the "Legacy" note (#791).
  write('app/legacy-page.tsx', "export default function LegacyPage() {\n  return <div />;\n}\n");
  write('app/legacy-layout.tsx', "export default function LegacyLayout() {\n  return <div />;\n}\n");
  const git = (...args) => execFileSync('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: repo, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  return { repo, remove: () => fs.rmSync(repo, { recursive: true, force: true }) };
}

test.describe.serial('Feature structure: a non-default features.root shows in the tree header (#393)', () => {
  let project;
  let restore;

  test.beforeAll(async () => {
    project = makeCustomRootProject();
    restore = await openProject(API, project.repo);
  });
  test.afterAll(async () => {
    await restore?.();
    project?.remove();
  });

  test('the configured root shows above the feature name, not the "features" default', async ({ page }) => {
    await gotoCockpit(page, '/?feature=billing');
    await expect(details(page).getByTestId('fc-name')).toHaveText('billing');
    await expect(details(page).getByTestId('fc-root')).toContainText('construct/');
  });

  test('files outside the root are counted as "Legacy, not managed" in the tree header, with no violations attributed (#791)', async ({ page }) => {
    await gotoCockpit(page, '/?feature=billing');
    await expect(page.getByTestId('fc-legacy-note')).toHaveText('Legacy, outside construct/ (2 files, not managed)');
  });
});

// A feature with a real rule violation on exactly one file, so exactly one layer gets the dot.
function makeViolationProject() {
  const project = makeBrowseProject('og803-violation-');
  // DOMAIN-001 (domain code using an external effect): a real, deterministic violation, isolated to
  // the domain layer so the page/component/etc. layers stay clean -- the #803 one-dot-per-layer test.
  fs.mkdirSync(path.join(project.repo, 'features', 'billing', 'domain'), { recursive: true });
  fs.writeFileSync(path.join(project.repo, 'features', 'billing', 'domain', 'Bad.ts'), "export function Bad() {\n  return fetch('/x');\n}\n");
  return project;
}

test.describe.serial('Feature structure: one quiet dot per layer for rule violations, details in the right panel (#803)', () => {
  let project;
  let restore;

  test.beforeAll(async () => {
    project = makeViolationProject();
    restore = await openProject(API, project.repo);
  });
  test.afterAll(async () => {
    await restore?.();
    project?.remove();
  });

  test('a layer with a rule violation shows one quiet dot, not a violation-per-line list', async ({ page }) => {
    await gotoCockpit(page, '/?feature=billing');
    const domainHeading = details(page).locator('[data-testid="fc-layer"][data-layer="domain"]');
    await expect(domainHeading.getByTestId('fc-violation-dot')).toHaveCount(1);
    const pageHeading = details(page).locator('[data-testid="fc-layer"][data-layer="page"]');
    await expect(pageHeading.getByTestId('fc-violation-dot')).toHaveCount(0);
  });

  test('clicking the dot opens the Violations right panel with that layer\'s rule, file and message', async ({ page }) => {
    await gotoCockpit(page, '/?feature=billing');
    const domainHeading = details(page).locator('[data-testid="fc-layer"][data-layer="domain"]');
    await domainHeading.getByTestId('fc-violation-dot').click();
    const tools = page.getByRole('complementary', { name: 'Right panel: Inspect' });
    await tools.getByRole('tab', { name: /^Violations/ }).click();
    const panel = page.getByTestId('fc-violations-panel');
    await expect(panel).toBeVisible();
    const violation = panel.getByTestId('fc-violation');
    await expect(violation).toHaveCount(1);
    await expect(violation).toContainText('DOMAIN-001');
    await expect(violation).toContainText('features/billing/domain/Bad.ts');
  });
});
