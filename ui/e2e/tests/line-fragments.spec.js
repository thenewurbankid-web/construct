import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gotoCockpit } from './support/cockpit.js';
import { openProject } from './support/browseProject.js';
import { runAxe, isBlocking, format } from './support/axe.js';
import { failOnConsoleErrors, refusalOf } from './support/consoleGuard.js';

// Line cx1 -- spot code editing in the browser without the whole file, on the real /api/line routes over a copy of
// examples/line-sample. OrdersPage passes a handler to ListPage (onMore={() => console.log('Show more orders')});
// "Edit code" on the ListPage part opens just that handler. Bad code, a new cross-feature import and (with a
// tsconfig) a type error are each refused in one sentence, with the technical reason under Details, and nothing is
// written; a good edit lands and changes only the handler's bytes.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = path.resolve(__dirname, '../../../examples/line-sample');
const ORDERS = 'features/orders/pages/OrdersPage.tsx';
const OLD = "() => console.log('Show more orders')";
const LABEL = 'What happens when Orders asks for more';

const listPagePart = (page) => page.locator('[data-testid="lp-part"][data-part="ListPage"]');
const handler = (page) => listPagePart(page).locator('[data-testid="lp-fragment"][data-kind="handler"]');

test.describe.serial('Line spot code editing (Line sample project, real server)', () => {
  // Code that does not parse is refused by the plan on purpose.
  failOnConsoleErrors(test, { allow: [refusalOf('/api/line/plan/step')] });
  let base;
  let restore;
  const read = (rel) => fs.readFileSync(path.join(base, rel), 'utf8');

  test.beforeAll(async () => {
    // The server only opens projects inside its workspace (the OS temp dir under this config), so open a copy.
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'line-frag-')));
    fs.cpSync(SAMPLE, base, { recursive: true });
    restore = await openProject(API(), base);
  });
  test.afterAll(async () => {
    await restore?.();
    if (base) fs.rmSync(base, { recursive: true, force: true });
  });

  const openEditor = async (page) => {
    await gotoCockpit(page, '/pages?feature=orders&page=orders%2Fpages%2FOrdersPage');
    const toggle = listPagePart(page).getByRole('button', { name: 'Edit code' });
    await expect(toggle).toBeVisible({ timeout: 30_000 });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(listPagePart(page).getByRole('button', { name: 'Close code' })).toHaveAttribute('aria-expanded', 'true');
    return handler(page);
  };

  test('"Edit code" on a part opens just that handler, with its plain-English label, and none of the rest of the file', async ({ page }) => {
    const form = await openEditor(page);
    await expect(form.getByLabel(LABEL)).toHaveValue(OLD);
    await expect(form.getByRole('button', { name: 'Save' })).toBeDisabled();
    // The rest of the file stays hidden: no import line, no function header anywhere on the screen.
    await expect(page.getByTestId('line-pages')).not.toContainText('import { ListPage }');
    await expect(page.getByTestId('line-pages')).not.toContainText('export function OrdersPage');

    const found = await runAxe(page, { include: '[data-testid="line-pages"]' });
    expect(found.filter(isBlocking), format(found.filter(isBlocking))).toEqual([]);
  });

  test('code that does not parse is refused in one sentence, the parser message is under Details, and nothing is written', async ({ page }) => {
    const before = read(ORDERS);
    const form = await openEditor(page);
    await form.getByLabel(LABEL).fill('() => {');
    await form.getByRole('button', { name: 'Save' }).click();
    const refusal = form.getByTestId('lp-fragment-refusal');
    await expect(refusal.locator('p')).toHaveText('This code is not a single valid expression, so nothing was saved.');
    await expect(refusal.getByTestId('lp-fragment-detail')).toBeHidden();
    await refusal.getByText('Details').click();
    await expect(refusal.getByTestId('lp-fragment-detail')).not.toBeEmpty();
    await expect(form.getByLabel(LABEL)).toHaveValue('() => {'); // what was typed stays, to fix it
    expect(read(ORDERS)).toBe(before);
  });

  test('a handler that would import another feature: Construct refuses the plan step, nothing is written, and the Plan panel offers its typed fixes', async ({ page }) => {
    const before = read(ORDERS);
    const form = await openEditor(page);
    await form.getByLabel(LABEL).fill("() => import('../../billing/pages/InvoicesPage')");
    await form.getByRole('button', { name: 'Save' }).click();
    // cp1: Save code adds a plan step; the Line rules run when the approved step runs.
    await expect(page.getByTestId('lp-outcome')).toHaveText(/^Waiting for your approval: Changes the code for /);
    const plan = page.getByTestId('line-plan');
    await plan.getByRole('button', { name: /^Approve step/ }).first().click();
    const step = plan.getByTestId('plan-step').first();
    await expect(step).toHaveAttribute('data-state', 'needs-fix');
    // cl1: promoting InvoicesPage alone would be refused (it uses orders' OrderButton), so the fix offered is the chain.
    await expect(step.getByTestId('plan-step-fixes')).toContainText('First move OrderButton into the library, because InvoicesPage uses it; then move InvoicesPage.tsx from feature billing into the library');
    await expect(step.getByRole('button', { name: 'Apply recommended fix' })).toBeVisible();
    await expect(step.getByTestId('plan-step-failing')).toContainText(/Validate found a new problem: feature "orders" imports "\.\.\/\.\.\/billing\/pages\/InvoicesPage" from feature "billing"/);
    await expect(step.getByRole('button', { name: 'Try again' })).toBeVisible();
    await expect(step.getByRole('button', { name: 'Leave as it is' })).toBeVisible();
    await expect(page.getByTestId('lp-outcome')).toHaveText(/^Nothing was saved: feature "orders" imports/);
    expect(read(ORDERS)).toBe(before);
    await step.getByRole('button', { name: 'Leave as it is' }).click();
    await expect(plan.getByTestId('plan-step').nth(1)).toHaveAttribute('data-state', 'done');
  });

  test('a good edit lands with "Saved. ..." and changes only the handler\'s bytes on disk', async ({ page }) => {
    const before = read(ORDERS);
    const NEW = "() => console.log('All the orders')";
    const form = await openEditor(page);
    await form.getByLabel(LABEL).fill(NEW);
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByTestId('lp-outcome')).toHaveText(`Waiting for your approval: Changes the code for "${LABEL}" in OrdersPage.`);
    expect(read(ORDERS)).toBe(before);
    await page.getByTestId('line-plan').getByRole('button', { name: /^Approve step/ }).first().click();
    await expect(page.getByTestId('lp-outcome')).toHaveText(`Saved. Changes the code for "${LABEL}" in OrdersPage.`);
    expect(read(ORDERS)).toBe(before.replace(OLD, NEW));
    await listPagePart(page).getByRole('button', { name: 'Edit code' }).click();
    await expect(handler(page).getByLabel(LABEL)).toHaveValue(NEW);
  });

  test('with a tsconfig, code that breaks the types is refused in a sentence with the TypeScript message under Details', async ({ page }) => {
    fs.writeFileSync(path.join(base, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, jsx: 'preserve', noEmit: true, module: 'esnext', moduleResolution: 'bundler', target: 'es2022' } }));
    const before = read(ORDERS);
    const form = await openEditor(page);
    await form.getByLabel(LABEL).fill('42');
    await form.getByRole('button', { name: 'Save' }).click();
    const refusal = form.getByTestId('lp-fragment-refusal');
    await expect(refusal.locator('p')).toHaveText('The new code does not match the types this file expects, so nothing was saved.', { timeout: 15_000 });
    await refusal.getByText('Details').click();
    await expect(refusal.getByTestId('lp-fragment-detail')).toContainText('TS2322');
    expect(read(ORDERS)).toBe(before);

    const found = await runAxe(page, { include: '[data-testid="line-pages"]' });
    expect(found.filter(isBlocking), format(found.filter(isBlocking))).toEqual([]);
  });
});

function API() {
  return process.env.E2E_API_BASE || `http://localhost:${process.env.E2E_SERVER_PORT || 4000}`;
}
