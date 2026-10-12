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

// Line ca2 (screen): where Cockpit shows a Line problem, its recommended fix is one sentence with Apply (a line.fix
// plan step the click approves and runs, written through Construct's writer; it shows in the Plan panel as done). The sample has two planted problems: InvoiceCard has no library
// base (LINE-BASE) and InvoicesPage imports orders' OrderButton (LINE-DIR). Each is fixed in at most two clicks, from the
// Components screen, the Pages screen and the Diagnostics drawer; the clicks are counted.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = path.resolve(__dirname, '../../../examples/line-sample');
const API = process.env.E2E_API_BASE || 'http://localhost:4000';
const CARD = 'features/billing/components/InvoiceCard.tsx';
const INVOICES = 'features/billing/pages/InvoicesPage.tsx';

const featureRow = (page, name) => page.getByTestId('ll-feature-row').filter({ has: page.getByText(name, { exact: true }) });
const pageRow = (page, name) => page.locator(`[data-testid="lp-page"][data-page="${name}"]`);

/** Every click the person makes goes through here, so the test can say how many it took. */
function clicker() {
  const c = { count: 0, click: async (locator) => { c.count += 1; await locator.click(); } };
  return c;
}

async function expectNoBlockingAxe(page, include) {
  const found = await runAxe(page, { include });
  expect(found.filter(isBlocking), format(found.filter(isBlocking))).toEqual([]);
}

test.describe.serial('Line: apply a fix (Line sample project, real server)', () => {
  failOnConsoleErrors(test);
  let base;
  let restore;
  const read = (rel) => fs.readFileSync(path.join(base, rel), 'utf8');
  /** Put the sample back as it was (both problems planted again). */
  const resetSample = () => {
    for (const dir of ['features', 'library']) fs.rmSync(path.join(base, dir), { recursive: true, force: true });
    fs.cpSync(SAMPLE, base, { recursive: true });
  };

  test.beforeAll(async () => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'line-fix-')));
    fs.cpSync(SAMPLE, base, { recursive: true });
    restore = await openProject(API, base);
  });
  test.afterAll(async () => {
    await restore?.();
    if (base) fs.rmSync(base, { recursive: true, force: true });
  });

  test('Components: InvoiceCard\'s missing base offers "Base it on Card"; one click on Apply saves it and the problem is gone', async ({ page }) => {
    const me = clicker();
    await gotoCockpit(page, '/components');
    const status = page.getByTestId('status-validate');
    await expect(status).toContainText('2 problems', { timeout: 30_000 });

    const row = featureRow(page, 'InvoiceCard');
    const fix = row.getByTestId('line-fix');
    await expect(fix).toContainText('Base InvoiceCard.tsx on the library component Card, which it already uses.');
    await expect(fix.getByTestId('lf-more')).toHaveCount(0); // one fix only: no "Other ways to fix"
    await expectNoBlockingAxe(page, '[data-testid="line-library"]');

    await me.click(fix.getByRole('button', { name: /^Apply: Base InvoiceCard\.tsx on the library component Card/ }));
    await expect(page.getByTestId('ll-notice')).toContainText('Saved.');
    // The click was the approval: the fix is a line.fix step of the plan, done.
    const fixStep = page.getByTestId('line-plan').getByTestId('plan-step').first();
    await expect(fixStep).toHaveAttribute('data-state', 'done');
    await expect(fixStep.getByTestId('plan-step-sentence')).toHaveText(/^Saved: /);
    await expect(row.getByTestId('ll-problem')).toHaveCount(0, { timeout: 30_000 });
    await expect(status).toContainText('1 problem', { timeout: 30_000 });
    expect(read(CARD)).toContain('@line-base components/Card');
    expect(me.count).toBeLessThanOrEqual(2);
    expect(me.count).toBe(1);
  });

  test('Pages: InvoicesPage\'s cross-feature import offers promote; one click on Apply leaves 0 problems', async ({ page }) => {
    const me = clicker();
    await gotoCockpit(page, '/pages?feature=billing');
    const status = page.getByTestId('status-validate');
    await expect(status).toContainText('1 problem', { timeout: 30_000 });
    const row = pageRow(page, 'InvoicesPage');
    await expect(row.getByTestId('lp-page-status')).toHaveText('Needs attention');
    const fix = row.getByTestId('line-fix');
    await expect(fix).toContainText('Move OrderButton.tsx from feature orders into the library and point every import at the library copy.');
    await expectNoBlockingAxe(page, '[data-testid="line-pages"]');

    await me.click(fix.getByRole('button', { name: /^Apply: Move OrderButton\.tsx/ }));
    await expect(page.getByTestId('line-pages').getByTestId('lf-notice')).toContainText('Saved.');
    await expect(page.getByTestId('line-plan').getByTestId('plan-step').first()).toHaveAttribute('data-state', 'done');
    await expect(row.getByTestId('lp-page-status')).toHaveText('Fine', { timeout: 30_000 });
    await expect(row.getByTestId('line-fix')).toHaveCount(0);
    await expect(status).toContainText('no problems', { timeout: 30_000 });
    expect(read(INVOICES)).not.toContain('orders/components');
    expect(fs.existsSync(path.join(base, 'library/components/OrderButton.tsx'))).toBe(true);
    expect(me.count).toBe(1);
  });

  test('Diagnostics: a Line row offers its fix too; open the drawer, Apply (two clicks), and the row leaves', async ({ page }) => {
    resetSample();
    const me = clicker();
    await gotoCockpit(page, '/components');
    const status = page.getByTestId('status-validate');
    await expect(status).toContainText('2 problems', { timeout: 30_000 });

    await me.click(status);
    const drawer = page.getByRole('region', { name: 'Bottom panel: Run' });
    const items = drawer.getByTestId('diagnostic-item');
    await expect(items).toHaveCount(2);
    const baseItem = items.filter({ has: page.getByTestId('diagnostic-details').filter({ hasText: 'LINE-BASE' }) });
    await expect(baseItem.getByTestId('line-fix')).toContainText('Base InvoiceCard.tsx on the library component Card');
    await expectNoBlockingAxe(page, '[data-testid="diagnostic-item"]');

    await me.click(baseItem.getByRole('button', { name: /^Apply: Base InvoiceCard\.tsx/ }));
    await expect(drawer.getByTestId('lf-notice')).toContainText('Saved.');
    await expect(items).toHaveCount(1, { timeout: 30_000 });
    await expect(items.first().getByTestId('diagnostic-details')).toContainText('LINE-DIR');
    await expect(status).toContainText('1 problem');
    expect(read(CARD)).toContain('@line-base components/Card');
    expect(me.count).toBe(2);
  });
});
