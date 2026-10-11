import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gotoCockpit } from './support/cockpit.js';
import { openProject } from './support/browseProject.js';
import { runAxe, isBlocking, format } from './support/axe.js';

// Line hour 4: "Base on this" on a library card of the Line sample. Pick a feature and a name, Create: the server
// writes the new feature component through Construct's writer (POST /api/line/base-on), the page says what happened
// in one sentence, and the card's "used by" count goes up. A name that is taken is refused in one sentence.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = path.resolve(__dirname, '../../../examples/line-sample');
const API = process.env.E2E_API_BASE || 'http://localhost:4000';

const card = (page, name) => page.getByTestId('ll-card').filter({ has: page.getByText(name, { exact: true }) });
const featureRow = (page, name) => page.getByTestId('ll-feature-row').filter({ has: page.getByText(name, { exact: true }) });

test.describe.serial('Line: Base on this (Line sample project)', () => {
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

  test('base a new orders component on Badge: one sentence, the file is written with its base link, the count goes up', async ({ page }) => {
    await gotoCockpit(page, '/components');
    const badge = card(page, 'Badge');
    await expect(badge.getByTestId('ll-used-by')).toHaveText('Not used by any feature yet', { timeout: 30_000 });

    await badge.getByRole('button', { name: 'Base on this: Badge' }).click();
    const form = badge.getByRole('form', { name: 'Base a new component on Badge' });
    await expect(form.getByLabel('Feature')).toHaveValue('billing');
    await expect(form.getByLabel('Name')).toHaveValue('BillingBadge');
    await form.getByLabel('Feature').selectOption('orders');
    await expect(form.getByLabel('Name')).toHaveValue('OrdersBadge');
    await form.getByLabel('Name').fill('StatusBadge');

    const found = await runAxe(page, { include: '[data-testid="line-library"]' });
    expect(found.filter(isBlocking), format(found.filter(isBlocking))).toEqual([]);

    await form.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByTestId('ll-notice')).toContainText('Saved. Creates StatusBadge in feature orders, based on the library Badge.');
    await expect(form).toHaveCount(0);
    await expect(badge.getByTestId('ll-used-by')).toHaveText('Used by 1 feature component');
    await expect(featureRow(page, 'StatusBadge').getByTestId('ll-base')).toHaveText('Based on Badge');

    const written = fs.readFileSync(path.join(base, 'features/orders/components/StatusBadge.tsx'), 'utf8');
    expect(written.split('\n')[0]).toBe('// @line-base components/Badge');
  });

  test('a name the feature already has is refused in one sentence, the form stays open and nothing is written', async ({ page }) => {
    await gotoCockpit(page, '/components');
    const button = card(page, 'Button');
    await expect(button.getByTestId('ll-used-by')).toHaveText('Used by 1 feature component', { timeout: 30_000 });
    await button.getByRole('button', { name: 'Base on this: Button' }).click();
    const form = button.getByRole('form', { name: 'Base a new component on Button' });
    await form.getByLabel('Feature').selectOption('orders');
    await form.getByLabel('Name').fill('OrderButton');
    const before = fs.readFileSync(path.join(base, 'features/orders/components/OrderButton.tsx'), 'utf8');
    await form.getByRole('button', { name: 'Create' }).click();
    await expect(form.getByRole('alert')).toHaveText(/already has a component named OrderButton; pick another name\.$/);
    await expect(form).toBeVisible();
    await expect(button.getByTestId('ll-used-by')).toHaveText('Used by 1 feature component');
    expect(fs.readFileSync(path.join(base, 'features/orders/components/OrderButton.tsx'), 'utf8')).toBe(before);
    await form.getByRole('button', { name: 'Cancel' }).click();
    await expect(button.getByRole('button', { name: 'Base on this: Button' })).toBeVisible();
  });
});
