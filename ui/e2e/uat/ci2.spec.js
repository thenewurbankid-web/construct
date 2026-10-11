import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gotoCockpit } from '../tests/support/cockpit.js';
import { openProject } from '../tests/support/browseProject.js';

// UAT walk for ci2 (docs/line/review.md "ci2", To try it in Cockpit), as a non-technical owner: open Import, follow the link
// to the Import agent, type the folder, Start, Approve the plan, read the result and the checks. Only clicks and typing;
// the walk fails on any console error or any 4xx/5xx answer, and counts the clicks each decision takes (at most two).
// The project is a temp copy of examples/import-sample (opened once, like picking it in the project switcher).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = path.resolve(__dirname, '../../../examples/import-sample');
const API = process.env.E2E_API_BASE || `http://localhost:${process.env.E2E_SERVER_PORT || 4000}`;

test.describe.serial('UAT ci2: the Import agent, walked as the owner', () => {
  let base;
  let restore;

  test.beforeAll(async () => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'uat-ci2-')));
    fs.cpSync(SAMPLE, base, { recursive: true });
    fs.writeFileSync(path.join(base, 'architecture.yml'), 'version: 1\n');
    restore = await openProject(API, base);
  });
  test.afterAll(async () => {
    await restore?.();
    if (base) fs.rmSync(base, { recursive: true, force: true });
  });

  test('Import -> Import agent -> Start -> Approve the plan -> Done, in plain English, two clicks per decision at most', async ({ page }) => {
    const problems = [];
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
    page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
    page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('/_next/')) problems.push(`${r.status()} ${r.request().method()} ${r.url()}`); });

    // 1. Open Import and follow the link to the agent.
    await gotoCockpit(page, '/import');
    await page.getByRole('link', { name: /Or let the Import agent plan it/ }).click();
    const screen = page.getByTestId('line-import-agent');
    await expect(screen.getByRole('heading', { name: 'Import agent' })).toBeVisible();

    // 2. Type the folder and start: one click.
    await screen.getByLabel('Folder to bring into Line').fill('src/alerts');
    await screen.getByRole('button', { name: 'Start the import' }).click();
    await expect(screen.getByTestId('la-sentence')).toHaveText('Review the plan: approve its 10 steps, or edit, skip or reorder them first.');
    await expect(screen.getByTestId('la-step')).toHaveCount(10);
    // Plain English first: no tool names or JSON on screen until Details is opened.
    await expect(screen.getByText('tool line.import.mark', { exact: true })).toBeHidden();
    for (const text of await screen.locator('.la-sentence').allInnerTexts()) expect(text, 'a sentence on screen').toMatch(/^[A-Z0-9"].*[.?!]$/s);

    // 3. Approve the plan: one click, and the agent does the rest.
    await screen.getByRole('button', { name: 'Approve the plan' }).click();
    await expect(screen.getByTestId('la-sentence')).toHaveText('Done: 10 steps landed.', { timeout: 90_000 });
    await expect(screen.locator('[data-check="validate"]')).toContainText('finds no new problems');

    // 4. The record says who did what, in sentences.
    await screen.getByText(/^Every change \(/).click();
    await expect(screen.getByTestId('la-changes')).toContainText('You approved 10 steps.');
    await expect(screen.getByTestId('la-changes')).toContainText('Your agent wrote the plan:');

    expect(fs.existsSync(path.join(base, 'src/alerts/features/alerts/pages/AlertsPage.tsx'))).toBe(true);
    expect(problems, problems.join('\n')).toEqual([]);
  });
});
