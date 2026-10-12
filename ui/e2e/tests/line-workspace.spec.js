import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gotoCockpit } from './support/cockpit.js';
import { openProject } from './support/browseProject.js';
import { runAxe, isBlocking, format } from './support/axe.js';
import { failOnConsoleErrors, refusalOf } from './support/consoleGuard.js';
import { startUnderTheHood } from './support/lineModes.js';

// Two modes: this spec checks the screen's regular view, so it starts Under the hood (screens open in Chat by default).
startUnderTheHood(test);

// Line cu6: one project switcher in the Cockpit header shows the open project and its workspace folder; "Change
// workspace folder" picks a folder inside the project (stored in line/workspace.json). Line then changes only that
// folder: Base on into orders lands, Base on into billing is refused in one sentence and nothing is written, and the
// Components screen tags everything outside the folder "Read-only". Real server, real writer, a copy of line-sample.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = path.resolve(__dirname, '../../../examples/line-sample');
const API = process.env.E2E_API_BASE || 'http://localhost:4000';

const card = (page, name) => page.getByTestId('ll-card').filter({ has: page.getByText(name, { exact: true }) });
const featureRow = (page, name) => page.getByTestId('ll-feature-row').filter({ has: page.getByText(name, { exact: true }) });

test.describe.serial('Line: one workspace folder per project (Line sample project)', () => {
  // Base on into billing is refused by the plan on purpose (outside the workspace folder).
  failOnConsoleErrors(test, { allow: [refusalOf('/api/line/plan/step')] });
  let base;
  let restore;

  test.beforeAll(async () => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'line-workspace-')));
    fs.cpSync(SAMPLE, base, { recursive: true });
    restore = await openProject(API, base);
  });
  test.afterAll(async () => {
    await restore?.();
    if (base) fs.rmSync(base, { recursive: true, force: true });
  });

  test('the project switcher shows the whole project as the workspace, and Change workspace folder sets it to features/orders', async ({ page }) => {
    await gotoCockpit(page, '/components');
    await expect(page.getByTestId('line-library')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('line-read-only')).toHaveCount(0);
    await expect(page.getByTestId('project-workspace')).toHaveText('Whole project');

    await page.getByTestId('project-switcher').click();
    const popover = page.getByRole('dialog', { name: 'Switch project' });
    await expect(popover.getByTestId('project-workspace-folder')).toHaveText('Whole project');
    await popover.getByTestId('change-workspace').click();
    const picker = popover.getByRole('region', { name: 'Pick the workspace folder' });
    await expect(picker).toBeVisible();

    const found = await runAxe(page, { include: '#sh-project-popover' });
    expect(found.filter(isBlocking), format(found.filter(isBlocking))).toEqual([]);

    await picker.getByRole('button', { name: 'features/', exact: true }).click();
    await picker.getByRole('button', { name: 'Use features/orders' }).click();

    await expect(page.getByTestId('project-workspace')).toHaveText('features/orders', { timeout: 30_000 });
    expect(JSON.parse(fs.readFileSync(path.join(base, 'line/workspace.json'), 'utf8'))).toEqual({ folder: 'features/orders' });
  });

  test('items outside features/orders are tagged Read-only; Base on into orders lands, into billing is refused and nothing is written', async ({ page }) => {
    await gotoCockpit(page, '/components');
    const badge = card(page, 'Badge');
    await expect(badge.getByTestId('ll-used-by')).toBeVisible({ timeout: 30_000 });
    await expect(badge.getByTestId('line-read-only')).toHaveText('Read-only');
    await expect(featureRow(page, 'InvoiceCard').getByTestId('line-read-only')).toHaveText('Read-only');
    await expect(featureRow(page, 'OrderCard').getByTestId('line-read-only')).toHaveCount(0);

    const found = await runAxe(page, { include: '[data-testid="line-library"]' });
    expect(found.filter(isBlocking), format(found.filter(isBlocking))).toEqual([]);

    // Into orders (inside the workspace): lands.
    await badge.getByRole('button', { name: 'Base on this: Badge' }).click();
    let form = badge.getByRole('form', { name: 'Base a new component on Badge' });
    await form.getByLabel('Feature').selectOption('orders');
    await form.getByLabel('Name').fill('StatusBadge');
    await form.getByRole('button', { name: 'Create' }).click();
    // cp1: the change is a plan step; Approve in the Plan panel lands it.
    await page.getByTestId('line-plan').getByRole('button', { name: /^Approve step/ }).first().click();
    await expect(page.getByTestId('ll-notice')).toContainText('Saved. Creates StatusBadge in feature orders, based on the library Badge.');
    expect(fs.existsSync(path.join(base, 'features/orders/components/StatusBadge.tsx'))).toBe(true);

    // Billing is outside the workspace, so the form does not offer it (pre-UAT: it used to open on billing, a sure refusal).
    await badge.getByRole('button', { name: 'Base on this: Badge' }).click();
    form = badge.getByRole('form', { name: 'Base a new component on Badge' });
    await expect(form.getByLabel('Feature').locator('option')).toHaveText(['orders']);
    await form.getByRole('button', { name: 'Cancel' }).click();

    // A change that would write outside the folder is still refused in one sentence and writes nothing: promoting
    // billing's InvoiceCard (it would move a read-only file into the read-only library).
    const billingBefore = fs.readdirSync(path.join(base, 'features/billing/components')).sort();
    const invoice = featureRow(page, 'InvoiceCard');
    await invoice.getByRole('button', { name: 'Promote to library: InvoiceCard' }).click();
    const confirm = invoice.getByRole('group', { name: 'Promote InvoiceCard to the library' });
    await confirm.getByRole('button', { name: 'Promote', exact: true }).click();
    await expect(confirm.getByRole('alert')).toHaveText(/^Nothing was saved: .* is outside your workspace folder features\/orders; it stays read-only\.$/);
    expect(fs.existsSync(path.join(base, 'library/components/InvoiceCard.tsx'))).toBe(false);
    expect(fs.readdirSync(path.join(base, 'features/billing/components')).sort()).toEqual(billingBefore);
  });
});
