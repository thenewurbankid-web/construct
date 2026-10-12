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

// Line hour 1: open the sample Line project (examples/line-sample, `preset: line`) in Cockpit and read its two
// planted Line errors in the Diagnostics panel: the plain-English sentence first, the rule id and file:line inside
// a collapsed "Details" disclosure.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = path.resolve(__dirname, '../../../examples/line-sample');
const API = process.env.E2E_API_BASE || 'http://localhost:4000';

const PLANTED = [
  {
    rule: 'LINE-DIR',
    location: 'features/billing/pages/InvoicesPage.tsx:4',
    sentence: 'Feature "billing" imports "../../orders/components/OrderButton" from feature "orders"; a feature may use only the library, so promote that item to library/ and import it from there.',
  },
  {
    rule: 'LINE-BASE',
    location: 'features/billing/components/InvoiceCard.tsx:1',
    sentence: 'The feature component "features/billing/components/InvoiceCard.tsx" has no library base; add one "@line-base components/<Name>" comment naming the library item it is based on, and create that library item first if none fits.',
  },
];

test.describe('Line errors in plain English (Line sample project)', () => {
  failOnConsoleErrors(test);
  let base;
  let restore;

  test.beforeAll(async () => {
    // The server only opens projects inside its workspace (the OS temp dir under this config), so open a copy.
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'line-sample-')));
    fs.cpSync(SAMPLE, base, { recursive: true });
    restore = await openProject(API, base);
  });
  test.afterAll(async () => {
    await restore?.();
    if (base) fs.rmSync(base, { recursive: true, force: true });
  });

  test('the status bar counts the two Line errors; Diagnostics shows each sentence, rule id and file:line under Details', async ({ page }) => {
    await gotoCockpit(page, '/help');
    const status = page.getByTestId('status-validate');
    await expect(status).toContainText('2 problems', { timeout: 30_000 });
    await status.click();
    const drawer = page.getByRole('region', { name: 'Bottom panel: Run' });
    const items = drawer.getByTestId('diagnostic-item');
    await expect(items).toHaveCount(PLANTED.length);

    for (const p of PLANTED) {
      const item = items.filter({ hasText: p.sentence });
      await expect(item).toHaveCount(1);
      // Plain English first: the sentence is the row itself, the technical bits are not visible yet.
      await expect(item.getByTestId('diagnostic-row')).toBeVisible();
      await expect(item.getByTestId('diagnostic-row')).toContainText(p.sentence);
      await expect(item.getByTestId('diagnostic-row')).not.toContainText(p.rule);
      const details = item.getByTestId('diagnostic-details');
      await expect(details).not.toHaveAttribute('open', /.*/);
      await expect(details.getByText(p.rule, { exact: true })).toBeHidden();
      // Opening Details shows the rule id and where it is.
      await details.getByText('Details', { exact: true }).click();
      await expect(details.getByText(p.rule, { exact: true })).toBeVisible();
      await expect(details.getByText(p.location, { exact: true })).toBeVisible();
    }

    const found = await runAxe(page, { include: '[aria-label="Problems"]' });
    expect(found.filter(isBlocking), format(found.filter(isBlocking))).toEqual([]);
  });
});
