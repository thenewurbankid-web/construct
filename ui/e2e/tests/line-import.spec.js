import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gotoCockpit } from './support/cockpit.js';
import { openProject } from './support/browseProject.js';
import { runAxe, isBlocking, format } from './support/axe.js';

// Line ci1: Import, partial migration. On a temp copy of examples/import-sample (a plain React + TS app, no Line markers),
// the person picks the folder src/alerts, reads what Line proposes, answers the one question (Table), sees the plan's
// steps and applies them. Every write lands through Construct's writer inside src/alerts; App.tsx and src/ui are unchanged.
// The copy gets a root architecture.yml only because Cockpit opens a project by that file (the folder gets its own).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = path.resolve(__dirname, '../../../examples/import-sample');
const API = process.env.E2E_API_BASE || `http://localhost:${process.env.E2E_SERVER_PORT || 4000}`;

const read = (base, rel) => fs.readFileSync(path.join(base, rel));

test.describe.serial('Line: Import one folder of an existing app (import sample)', () => {
  let base;
  let restore;

  test.beforeAll(async () => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'import-sample-')));
    fs.cpSync(SAMPLE, base, { recursive: true });
    fs.writeFileSync(path.join(base, 'architecture.yml'), 'version: 1\n');
    restore = await openProject(API, base);
  });
  test.afterAll(async () => {
    await restore?.();
    if (base) fs.rmSync(base, { recursive: true, force: true });
  });

  test('scan, one question, plan, apply: the folder becomes Line, nothing outside it changes', async ({ page }) => {
    const app = read(base, 'src/App.tsx');
    const card = read(base, 'src/ui/Card.tsx');
    await gotoCockpit(page, '/import');
    const screen = page.getByTestId('line-import');
    await expect(screen.getByTestId('li-source')).toContainText(base);
    await screen.getByLabel('Folder to bring into Line').fill('src/alerts');
    await screen.getByRole('button', { name: 'Read folder' }).click();

    await expect(screen.getByTestId('li-scan-summary')).toHaveText('Line found 6 items in src/alerts; it needs your answer to one question.');
    await expect(screen.getByTestId('li-found')).toHaveCount(6);
    await expect(screen.getByText('SeverityBadge goes to the library as an atom, because 2 pages use it.')).toBeVisible();
    await expect(screen.getByText('AlertsPage goes to feature alerts, served at /alerts; its full code goes to the library and the feature gets a page based on it.')).toBeVisible();
    // File paths sit under Details, closed.
    await expect(screen.getByText('src/alerts/components/SeverityBadge.tsx', { exact: true })).toBeHidden();

    const question = screen.getByTestId('li-question');
    await expect(question).toHaveCount(1);
    const choices = question.getByRole('button');
    await expect(choices.first()).toHaveText('Put Table in the library, so every feature can use it. (recommended)');
    await expect(choices.first()).toHaveAttribute('aria-pressed', 'true');
    const found = await runAxe(page, { include: '[data-testid="line-import"]' });
    expect(found.filter(isBlocking), format(found.filter(isBlocking))).toEqual([]);

    await question.getByRole('button', { name: 'Keep Table in feature alerts, where it is used.' }).click();
    await expect(question.getByRole('button', { name: 'Keep Table in feature alerts, where it is used.' })).toHaveAttribute('aria-pressed', 'true');
    await screen.getByRole('button', { name: 'Show the plan' }).click();
    await expect(screen.getByTestId('li-plan-summary')).toHaveText('Brings 6 items of src/alerts into Line in 11 steps: 2 to the library and 4 to feature alerts; nothing outside src/alerts changes.');
    await expect(screen.getByTestId('li-step')).toHaveCount(11);
    await expect(screen.getByTestId('li-step').first()).toContainText('Marks src/alerts as a Line folder');
    expect(fs.existsSync(path.join(base, 'src/alerts/architecture.yml'))).toBe(false);

    await screen.getByRole('button', { name: 'Apply' }).click();
    await expect(screen.getByTestId('li-notice')).toContainText('Saved. Brings 6 items of src/alerts into Line', { timeout: 60_000 });
    await expect(screen.locator('[data-testid="li-step"][data-state="done"]')).toHaveCount(11);
    expect(fs.readFileSync(path.join(base, 'src/alerts/features/alerts/components/Table.tsx'), 'utf8')).toMatch(/^\/\/ @line-base components\/Table\n/);
    expect(fs.readFileSync(path.join(base, 'src/alerts/features/alerts/pages/AlertsPage.tsx'), 'utf8')).toContain('// @line-route /alerts');
    expect(read(base, 'src/App.tsx').equals(app)).toBe(true);
    expect(read(base, 'src/ui/Card.tsx').equals(card)).toBe(true);
    const after = await runAxe(page, { include: '[data-testid="line-import"]' });
    expect(after.filter(isBlocking), format(after.filter(isBlocking))).toEqual([]);
  });

  test('a folder outside the project is refused in one sentence', async ({ page }) => {
    await gotoCockpit(page, '/import');
    const screen = page.getByTestId('line-import');
    await screen.getByLabel('Folder to bring into Line').fill('../elsewhere');
    await screen.getByRole('button', { name: 'Read folder' }).click();
    await expect(screen.getByTestId('li-error')).toHaveText('"../elsewhere" is not a folder inside the project; pick one folder of it, such as src/alerts.');
  });

  test('mock mode (?line=mock) shows the same proposals with no server work', async ({ page }) => {
    await gotoCockpit(page, '/import?line=mock');
    const screen = page.getByTestId('line-import');
    await screen.getByLabel('Folder to bring into Line').fill('src/alerts');
    await screen.getByRole('button', { name: 'Read folder' }).click();
    await expect(screen.getByTestId('li-scan-summary')).toHaveText('Line found 6 items in src/alerts; it needs your answer to one question.');
    await expect(screen.getByTestId('li-source')).toHaveText('/mock/import-sample');
    await page.goto('/import?line=real');
  });
});
