import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gotoCockpit } from './support/cockpit.js';
import { openProject } from './support/browseProject.js';
import { runAxe, isBlocking, format } from './support/axe.js';
import { checkSentence, splitSentences } from '../../../packages/summarize/index.mjs';
import { startUnderTheHood } from './support/lineModes.js';

// Two modes: this spec checks the screen's regular view, so it starts Under the hood (screens open in Chat by default).
startUnderTheHood(test);

// cs1: every Plan panel step shows the summarizer's plain English first (<PlainFirst>), and the technical part (the
// tool call, the step id, each check, the files written) only under a collapsed Details. Every sentence the panel
// shows passes the summarizer's own rules: a full sentence, no raw ids, slot names as words.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = path.resolve(__dirname, '../../../examples/line-sample');
const API = process.env.E2E_API_BASE || 'http://localhost:4000';

const card = (page, name) => page.getByTestId('ll-card').filter({ has: page.getByText(name, { exact: true }) });

async function baseOn(page, library, name) {
  const c = card(page, library);
  await c.getByRole('button', { name: `Base on this: ${library}` }).click({ timeout: 30_000 });
  const form = c.getByRole('form', { name: `Base a new component on ${library}` });
  await form.getByLabel('Feature').selectOption('orders');
  await form.getByLabel('Name').fill(name);
  await form.getByRole('button', { name: 'Create' }).click();
  await expect(form).toHaveCount(0);
}

/** Every plain sentence the Plan panel shows, checked by the summarizer's rules (item names as written are names). */
async function expectPlainSentences(plan, names) {
  const texts = await plan.locator('[data-plain-first]').allInnerTexts();
  expect(texts.length).toBeGreaterThan(0);
  for (const text of texts) for (const s of splitSentences(text)) expect(checkSentence(s, { names }).problems, s).toEqual([]);
}

test.describe.serial('Line: plain English first in the Plan panel (cs1)', () => {
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

  test('a waiting step says what it will do in plain English; the tool call and step id are only under Details', async ({ page }) => {
    await gotoCockpit(page, '/components');
    const plan = page.getByTestId('line-plan');
    await expect(plan).toContainText('No steps yet', { timeout: 30_000 });
    await baseOn(page, 'Badge', 'PlainBadge');

    const step = plan.getByTestId('plan-step').first();
    await expect(step.getByTestId('plan-step-sentence')).toHaveText('Waiting for your approval: Creates PlainBadge in feature orders, based on the library Badge.');
    const details = step.getByTestId('plain-first-details');
    await expect(details).not.toHaveAttribute('open', '');
    await expect(step.getByTestId('plan-step-call')).toBeHidden();
    await expectPlainSentences(plan, ['PlainBadge']);

    await details.getByText('Details', { exact: true }).click();
    await expect(step.getByTestId('plan-step-call')).toHaveText('line.baseOn({"libraryId":"components/Badge","feature":"orders","name":"PlainBadge"})');
    await expect(details.locator('dt')).toContainText(['Tool call', 'Step']);
    await expect(details.locator('.pf-row').filter({ hasText: 'Step' }).locator('code')).toHaveText(/ \(step 1, waiting\)$/);

    const found = await runAxe(page, { include: '[data-testid="line-plan"]' });
    expect(found.filter(isBlocking), format(found.filter(isBlocking))).toEqual([]);
  });

  test('after Approve the step reads as one full sentence ("Saved: ..."); the checks and the file written are under Details', async ({ page }) => {
    await gotoCockpit(page, '/components');
    const plan = page.getByTestId('line-plan');
    const step = plan.getByTestId('plan-step').first();
    await step.getByRole('button', { name: 'Approve step 1' }).click({ timeout: 30_000 });
    await expect(step).toHaveAttribute('data-state', 'done');
    await expect(step.getByTestId('plan-step-sentence')).toHaveText('Saved: Creates PlainBadge in feature orders, based on the library Badge.');
    await expectPlainSentences(plan, ['PlainBadge']);
    const details = step.getByTestId('plain-first-details');
    await details.getByText('Details', { exact: true }).click();
    await expect(details.locator('.pf-row').filter({ hasText: 'File written' }).locator('code')).toHaveText('features/orders/components/PlainBadge.tsx');
    await expect(details.locator('.pf-row').filter({ hasText: 'Check' }).first().locator('code')).toHaveText(/^Passed: /);
  });
});
