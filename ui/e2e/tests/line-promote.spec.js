import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gotoCockpit } from './support/cockpit.js';
import { openProject } from './support/browseProject.js';
import { runAxe, isBlocking, format } from './support/axe.js';
import { failOnConsoleErrors } from './support/consoleGuard.js';
import { startUnderTheHood } from './support/lineModes.js';

// Two modes: this spec checks the screen's regular view, so it starts Under the hood (screens open in Chat by default).
startUnderTheHood(test);

// Line hour 7: "Promote to library" on a feature component of the Line sample. Promoting orders' OrderButton moves it
// into the library and re-points billing's InvoicesPage at the library copy (a line.promote plan step, written through
// Construct's writer), so the planted cross-feature import (LINE-DIR) disappears from Diagnostics.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = path.resolve(__dirname, '../../../examples/line-sample');
const API = process.env.E2E_API_BASE || 'http://localhost:4000';

const featureRow = (page, name) => page.getByTestId('ll-feature-row').filter({ has: page.getByText(name, { exact: true }) });

test.describe.serial('Line: Promote to library (Line sample project)', () => {
  failOnConsoleErrors(test);
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

  test('promoting OrderButton moves it into the library and the LINE-DIR problem leaves Diagnostics', async ({ page }) => {
    await gotoCockpit(page, '/components');
    const status = page.getByTestId('status-validate');
    await expect(status).toContainText('2 problems', { timeout: 30_000 });

    const row = featureRow(page, 'OrderButton');
    await row.getByRole('button', { name: 'Promote to library: OrderButton' }).click();
    const confirm = row.getByRole('group', { name: 'Promote OrderButton to the library' });
    await expect(confirm).toContainText('This moves OrderButton into library/ and points every file that uses it at the library copy.');
    const found = await runAxe(page, { include: '[data-testid="line-library"]' });
    expect(found.filter(isBlocking), format(found.filter(isBlocking))).toEqual([]);
    // Cancel writes nothing.
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    expect(fs.existsSync(path.join(base, 'library/components/OrderButton.tsx'))).toBe(false);

    await row.getByRole('button', { name: 'Promote to library: OrderButton' }).click();
    await row.getByRole('button', { name: 'Promote', exact: true }).click();
    // cp1: Promote adds a plan step; Approve in the Plan panel runs it.
    const plan = page.getByTestId('line-plan');
    await expect(plan.getByTestId('plan-step').first()).toContainText('Waiting for your approval: Moves OrderButton from feature orders into the library');
    expect(fs.existsSync(path.join(base, 'library/components/OrderButton.tsx'))).toBe(false);
    await plan.getByRole('button', { name: /^Approve step/ }).first().click();
    await expect(page.getByTestId('ll-notice')).toContainText('Saved. Moves OrderButton from feature orders into the library');

    // The library now has OrderButton (it renders the atom Button, so it is a molecule); orders no longer lists it.
    await expect(page.getByTestId('ll-group-molecule').getByTestId('ll-card').filter({ has: page.getByText('OrderButton', { exact: true }) })).toBeVisible();
    await expect(featureRow(page, 'OrderButton')).toHaveCount(0);
    expect(fs.existsSync(path.join(base, 'library/components/OrderButton.tsx'))).toBe(true);
    expect(fs.existsSync(path.join(base, 'features/orders/components/OrderButton.tsx'))).toBe(false);
    expect(fs.readFileSync(path.join(base, 'features/billing/pages/InvoicesPage.tsx'), 'utf8')).not.toContain('orders/components');

    // Validate re-ran by itself: one problem left, and it is the planted LINE-BASE, not LINE-DIR.
    await expect(status).toContainText('1 problem', { timeout: 30_000 });
    await status.click();
    const drawer = page.getByRole('region', { name: 'Bottom panel: Run' });
    const items = drawer.getByTestId('diagnostic-item');
    await expect(items).toHaveCount(1);
    await expect(items.first().getByTestId('diagnostic-details')).toContainText('LINE-BASE');
    await expect(drawer.getByText(/imports .* from feature "orders"/)).toHaveCount(0);
  });
});
