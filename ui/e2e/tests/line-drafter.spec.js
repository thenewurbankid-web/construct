import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gotoCockpit } from './support/cockpit.js';
import { openProject } from './support/browseProject.js';
import { runAxe, isBlocking, format } from './support/axe.js';

// System 1 drafter on the real server (run with playwright.line-drafter.config.js, which sets LINE_DRAFTER=1): a request
// becomes every route Construct checked on a copy of the project, the recommended one first; Add to plan puts its steps
// in the Plan panel, where nothing is written before Approve; a refused route says why with no Add button; a word Line
// does not know is one closed question whose answer is remembered.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = path.resolve(__dirname, '../../../examples/line-sample');
const API = process.env.E2E_API_BASE || 'http://localhost:4000';

async function draft(page, text) {
  const box = page.getByTestId('line-draft');
  await box.getByLabel('What do you want to change?').fill(text);
  await box.getByRole('button', { name: 'Draft' }).click();
  return box;
}

test.describe.serial('Line: Describe a change (System 1 drafter, Line sample project)', () => {
  let base;
  let restore;

  test.beforeAll(async () => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'line-sample-')));
    fs.cpSync(SAMPLE, base, { recursive: true });
    restore = await openProject(API, base);
  });
  test.afterAll(async () => {
    await restore?.();
    if (base) fs.rmSync(base, { recursive: true, force: true });
  });

  test('a request lists the checked route first; Add to plan makes a waiting step; Approve writes it', async ({ page }) => {
    await gotoCockpit(page, '/components');
    const box = await draft(page, 'Add a badge to the orders feature');
    const first = box.getByTestId('draft-route').first();
    await expect(first).toHaveAttribute('data-recommended', 'true', { timeout: 30_000 });
    await expect(first.getByTestId('draft-route-label')).toHaveText('Add a new component OrdersBadge to orders, based on the library Badge.');
    await expect(first.getByTestId('draft-route-sentence')).toHaveText('Construct tried it on a copy of the project: every check passes.');
    await expect(first).toContainText('Recommended · Checked');
    // The tool call sits under Details, collapsed.
    await expect(first.getByText(/^line\.baseOn /)).toBeHidden();
    await first.getByText('Details', { exact: true }).click();
    await expect(first.getByText(/^line\.baseOn /)).toHaveText('line.baseOn {"libraryId":"components/Badge","feature":"orders","name":"OrdersBadge"}');

    const found = await runAxe(page, { include: '[data-testid="line-draft"]' });
    expect(found.filter(isBlocking), format(found.filter(isBlocking))).toEqual([]);

    await first.getByRole('button', { name: /^Add to plan/ }).click();
    await expect(box.getByTestId('draft-notice')).toContainText('Added one step to the plan; approve it to run.');
    const plan = page.getByTestId('line-plan');
    const step = plan.getByTestId('plan-step').first();
    await expect(step).toHaveAttribute('data-state', 'waiting');
    await expect(step.getByTestId('plan-step-sentence')).toHaveText('Waiting for your approval: Creates OrdersBadge in feature orders, based on the library Badge.');
    const file = path.join(base, 'features/orders/components/OrdersBadge.tsx');
    expect(fs.existsSync(file)).toBe(false);
    await step.getByRole('button', { name: /^Approve step/ }).click();
    await expect(step).toHaveAttribute('data-state', 'done', { timeout: 30_000 });
    expect(fs.existsSync(file)).toBe(true);
    // The pick is remembered as one delexicalized transition: no project names in it.
    const rec = fs.readFileSync(path.join(base, 'line/drafter/transitions.jsonl'), 'utf8');
    expect(rec).not.toMatch(/orders|Badge/);
  });

  test('a refused route says why in Construct\'s words and offers no Add button', async ({ page }) => {
    await gotoCockpit(page, '/components');
    const box = await draft(page, 'create a feature called returns');
    const refused = box.locator('[data-testid="draft-route"][data-status="refused"]').first();
    await expect(refused.getByTestId('draft-route-sentence')).toHaveText('Nothing was saved: there is no feature "returns"; pick an existing feature or create its folder under features/ first.', { timeout: 30_000 });
    await expect(refused.getByRole('button', { name: /^Add to plan/ })).toHaveCount(0);
    await expect(box.getByTestId('draft-notes')).toContainText('No route passed Construct\'s checks');
  });

  test('a word Line does not know is one closed question; one click answers it and the routes appear', async ({ page }) => {
    await gotoCockpit(page, '/components');
    const box = await draft(page, 'add a card to the shop feature');
    const q = box.getByTestId('draft-question');
    await expect(q).toContainText('Which part of the project do you mean by "shop"?', { timeout: 30_000 });
    await q.getByRole('button', { name: 'the orders feature' }).click();
    await expect(box.getByTestId('draft-question')).toHaveCount(0);
    await expect(box.getByTestId('draft-route').first().getByTestId('draft-route-label')).toHaveText('Add a new component OrdersCard to orders, based on the library Card.');
    expect(JSON.parse(fs.readFileSync(path.join(base, 'line/domain-map.json'), 'utf8')).synonyms).toEqual({ shop: 'feature:orders' });
  });
});
