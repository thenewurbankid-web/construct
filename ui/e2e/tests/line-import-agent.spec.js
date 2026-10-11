import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gotoCockpit } from './support/cockpit.js';
import { openProject } from './support/browseProject.js';
import { runAxe, isBlocking, format } from './support/axe.js';

// Line ci2: the Import agent. On a temp copy of examples/import-sample, the person starts the agent on src/alerts; it reads,
// sorts and plans the folder and stops at the review. The person skips one step and approves the plan; the agent runs every
// approved step as a cp1 plan step through Construct's writer inside src/alerts, then verifies (Line rules, types, tests).
// The process lives in src/alerts/line/import-plan.json, so a reload shows it as it is. In mock mode (?line=mock) the same
// process runs on the contract mock with one planted refusal: the agent picks its fix, the person approves it in one click.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = path.resolve(__dirname, '../../../examples/import-sample');
const API = process.env.E2E_API_BASE || `http://localhost:${process.env.E2E_SERVER_PORT || 4000}`;

const read = (base, rel) => fs.readFileSync(path.join(base, rel));

test.describe.serial('Line: the Import agent brings one folder into Line (import sample)', () => {
  let base;
  let restore;

  test.beforeAll(async () => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'import-agent-sample-')));
    fs.cpSync(SAMPLE, base, { recursive: true });
    fs.writeFileSync(path.join(base, 'architecture.yml'), 'version: 1\n');
    restore = await openProject(API, base);
  });
  test.afterAll(async () => {
    await restore?.();
    if (base) fs.rmSync(base, { recursive: true, force: true });
  });

  test('start, review (skip one step), approve the plan: the steps land inside the folder, the checks run, the record says who did what', async ({ page }) => {
    const app = read(base, 'src/App.tsx');
    await gotoCockpit(page, '/import/agent');
    const screen = page.getByTestId('line-import-agent');
    await screen.getByLabel('Folder to bring into Line').fill('src/alerts');
    await screen.getByRole('button', { name: 'Start the import' }).click();

    await expect(screen.getByTestId('la-sentence')).toHaveText('Review the plan: approve its 10 steps, or edit, skip or reorder them first.');
    await expect(screen.locator('[data-stage="review"]')).toHaveAttribute('aria-current', 'step');
    await expect(screen.getByTestId('la-step')).toHaveCount(10);
    await expect(screen.getByTestId('la-step').first()).toContainText('Marks src/alerts as a Line folder');
    expect(fs.existsSync(path.join(base, 'src/alerts/line/import-plan.json'))).toBe(true);
    expect(fs.existsSync(path.join(base, 'src/alerts/architecture.yml'))).toBe(false);
    // Technical detail (tool, args) sits under a closed Details.
    await expect(screen.getByText('tool line.import.mark', { exact: true })).toBeHidden();
    const found = await runAxe(page, { include: '[data-testid="line-import-agent"]' });
    expect(found.filter(isBlocking), format(found.filter(isBlocking))).toEqual([]);

    await screen.getByRole('button', { name: 'Skip step 5' }).click();
    await expect(screen.locator('[data-step="import-5-lib-Table"]')).toHaveAttribute('data-review', 'skipped');
    await screen.getByRole('button', { name: 'Approve the plan' }).click();

    await expect(screen.getByTestId('la-sentence')).toHaveText('Done: 9 steps landed.', { timeout: 90_000 });
    await expect(screen.locator('[data-stage="done"]')).toHaveAttribute('aria-current', 'step');
    await expect(screen.locator('[data-testid="la-step"][data-run="done"]')).toHaveCount(9);
    await expect(screen.locator('[data-check="validate"]')).toHaveAttribute('data-state', 'pass');
    await expect(screen.locator('[data-check="validate"]')).toContainText('Validate (profile line) finds no new problems in the folder.');
    await expect(screen.locator('[data-check="types"]')).toContainText('Types were not checked: TypeScript is not installed in the project');
    await screen.getByText(/^Every change \(/).click();
    await expect(screen.getByTestId('la-changes')).toContainText('You skipped "Moves Table into the library as an atom and points its users at it".');
    await expect(screen.getByTestId('la-changes')).toContainText('You approved 9 steps.');

    expect(fs.existsSync(path.join(base, 'src/alerts/features/alerts/pages/AlertsPage.tsx'))).toBe(true);
    expect(fs.existsSync(path.join(base, 'src/alerts/components/Table.tsx'))).toBe(true);
    expect(read(base, 'src/App.tsx').equals(app)).toBe(true);
    const saved = JSON.parse(fs.readFileSync(path.join(base, 'src/alerts/line/import-plan.json'), 'utf8'));
    expect(saved.state).toBe('done');
    const after = await runAxe(page, { include: '[data-testid="line-import-agent"]' });
    expect(after.filter(isBlocking), format(after.filter(isBlocking))).toEqual([]);
  });

  test('the process is kept in the folder: a reload with ?folder= shows it as it is; the plan panel has its steps', async ({ page }) => {
    await gotoCockpit(page, '/import/agent?folder=src%2Falerts');
    const screen = page.getByTestId('line-import-agent');
    await expect(screen.getByTestId('la-sentence')).toHaveText('Done: 9 steps landed.');
    await expect(screen.getByRole('button', { name: 'Start the import' })).toBeHidden();
    const plan = await (await page.request.get(`${API}/api/line/plan`)).json();
    expect(plan.steps.length).toBe(9);
    expect(plan.steps.every((s) => s.tool.startsWith('line.import.') && s.state === 'done')).toBe(true);
  });

  test('a folder outside the project is refused in one sentence', async ({ page }) => {
    await gotoCockpit(page, '/import/agent');
    const screen = page.getByTestId('line-import-agent');
    await screen.getByLabel('Folder to bring into Line').fill('../elsewhere');
    await screen.getByRole('button', { name: 'Start the import' }).click();
    await expect(screen.getByTestId('la-error')).toHaveText('The import folder must be a folder inside the project, like src/alerts.');
  });

  test('mock mode (?line=mock): a refused step gets its fix picked by the agent; the person approves it in one click and the import finishes', async ({ page }) => {
    await gotoCockpit(page, '/import/agent?line=mock');
    const screen = page.getByTestId('line-import-agent');
    await screen.getByLabel('Folder to bring into Line').fill('src/alerts');
    await screen.getByRole('button', { name: 'Start the import' }).click();
    await screen.getByRole('button', { name: 'Approve the plan' }).click();
    await expect(screen.getByTestId('la-sentence')).toHaveText(/^Approve plan step 9 to go on: fix for AlertRow: point AlertRow at the library AlertRow\.$/);
    await screen.getByRole('button', { name: 'Approve and run' }).click();
    await expect(screen.getByTestId('la-sentence')).toHaveText('Done: 10 steps landed.');
    await screen.getByText(/^How the agent decided \(/).click();
    await expect(screen.getByTestId('la-decisions')).toContainText('Which fix for AlertRow? Point AlertRow at the library AlertRow. (Line took the recommended option.)');
    await page.goto('/import?line=real');
  });
});
