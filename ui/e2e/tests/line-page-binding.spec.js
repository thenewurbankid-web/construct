import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gotoCockpit } from './support/cockpit.js';
import { openProject } from './support/browseProject.js';
import { runAxe, isBlocking, format } from './support/axe.js';
import { failOnConsoleErrors } from './support/consoleGuard.js';

// cu5 -- the Pages screen shows a page's two bindings side by side, on the real /api/line routes over a copy of
// examples/line-sample: each part's library component (Morpheus) next to its data, states and actions (Trace's page
// map, with orders' API contract features/orders/openapi.json). An action with no home is a finding with typed fixes;
// binding an action or a part is a plan step that is written only after Approve in the Plan panel.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = path.resolve(__dirname, '../../../examples/line-sample');
const API = process.env.E2E_API_BASE || 'http://localhost:4000';
const ORDERS = 'features/orders/pages/OrdersPage.tsx';
const INVOICES = 'features/billing/pages/InvoicesPage.tsx';

const panel = (page) => page.getByTestId('lp-binding');
const row = (page, tag) => panel(page).locator(`[data-testid="lp-binding-row"][data-part="${tag}"]`);
const approve = async (page) => {
  const waiting = page.getByTestId('line-plan').getByTestId('plan-step').filter({ hasText: 'Waiting for your approval' });
  await expect(waiting).toHaveCount(1, { timeout: 15_000 });
  await waiting.getByRole('button', { name: /^Approve step/ }).click();
  await expect(waiting).toHaveCount(0, { timeout: 30_000 });
};

test.describe.serial('Pages: Trace\'s page map and wiring next to Morpheus\'s component binding (cu5, real server)', () => {
  failOnConsoleErrors(test);
  let base;
  let restore;
  const read = (rel) => fs.readFileSync(path.join(base, rel), 'utf8');

  test.beforeAll(async () => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'line-sample-')));
    fs.cpSync(SAMPLE, base, { recursive: true });
    restore = await openProject(API, base);
  });
  test.afterAll(async () => {
    await restore?.();
    if (base) fs.rmSync(base, { recursive: true, force: true });
  });

  test('OrdersPage: ListPage from the library on the left, its "More" action with no home on the right, with typed fixes', async ({ page }) => {
    await gotoCockpit(page, '/pages?feature=orders&page=orders%2Fpages%2FOrdersPage');
    await expect(page.getByRole('heading', { name: 'How OrdersPage is bound' })).toBeVisible({ timeout: 30_000 });
    await expect(panel(page).getByTestId('lp-contract')).toHaveText('The API contract of orders (openapi.json) has 3 endpoints.');
    await expect(panel(page).getByTestId('lp-coverage')).toHaveText('0 of 1 action has a home (0 call the API, 0 on the page, 0 stubs to write).');
    await expect(panel(page).getByRole('columnheader')).toHaveText(['Part', 'Library component (Morpheus)', 'Data and actions (Trace)']);
    const listPage = row(page, 'ListPage');
    await expect(listPage.getByTestId('lp-binding-library')).toHaveText('The library page ListPage (pages/ListPage).');
    await expect(listPage.getByTestId('lp-binding-data')).toHaveText('Static text, no data.');
    await expect(listPage.getByTestId('lp-binding-action')).toHaveText('Needs a home "More" has no home yet: "more" is not a known action and the handler is not a stub.');
    await expect(listPage.getByRole('button', { name: 'Bind to library' })).toHaveCount(0);
    const finding = panel(page).getByTestId('lp-binding-finding');
    await expect(finding).toHaveCount(1);
    await expect(finding.locator('.lp-finding-sentence')).toHaveText('More on ListPage is not bound to the API: "more" is not a known action and the handler is not a stub.');
    await expect(finding.getByTestId('lp-bind-fix')).toHaveText('Bind "More" to GET /api/orders (reload the list).');
    await expect(finding.getByTestId('lp-bind-other')).toHaveCount(4);
    await expect(finding.getByTestId('lp-bind-other').first()).toBeHidden();
    const found = await runAxe(page, { include: '[data-testid="lp-binding"]' });
    expect(found.filter(isBlocking), format(found.filter(isBlocking))).toEqual([]);
  });

  test('the recommended fix is one click plus Approve: it waits in the Plan panel, then "More" calls GET /api/orders', async ({ page }) => {
    const before = read(ORDERS);
    await gotoCockpit(page, '/pages?feature=orders&page=orders%2Fpages%2FOrdersPage');
    await panel(page).getByTestId('lp-bind-fix').click({ timeout: 30_000 });
    await expect(panel(page).getByTestId('lp-bind-outcome')).toHaveText('Waiting for your approval: Binds "More" on ListPage in the page OrdersPage to GET /api/orders (reload the list).');
    expect(read(ORDERS)).toBe(before);
    await approve(page);
    await expect(row(page, 'ListPage').getByTestId('lp-binding-action')).toHaveAttribute('data-resolution', 'api', { timeout: 30_000 });
    await expect(row(page, 'ListPage').getByTestId('lp-binding-action')).toHaveText('Calls the API "More" calls GET /api/orders (reload the list).');
    await expect(panel(page).getByTestId('lp-binding-finding')).toHaveCount(0);
    await expect(panel(page).getByTestId('lp-coverage')).toHaveText('1 of 1 action has a home (1 calls the API, 0 on the page, 0 stubs to write).');
    expect(read(ORDERS)).toContain('data-action="reload"');
  });

  test('InvoicesPage: OrderButton (from another feature) is bound to the library Button through the Plan panel', async ({ page }) => {
    await gotoCockpit(page, '/pages?feature=billing&page=billing%2Fpages%2FInvoicesPage');
    await expect(panel(page).getByTestId('lp-contract')).toHaveText('billing has no API contract yet; add its openapi.json beside spec.md so Trace can bind this page\'s actions to endpoints.', { timeout: 30_000 });
    const ob = row(page, 'OrderButton');
    await expect(ob.getByTestId('lp-binding-library')).toHaveText('OrderButton from the feature orders, based on the library Button.');
    await ob.getByLabel('Library component').selectOption({ label: 'Button' });
    await ob.getByRole('button', { name: 'Bind to library' }).click();
    await expect(panel(page).getByTestId('lp-bind-outcome')).toHaveText('Waiting for your approval: Replaces OrderButton in the page InvoicesPage with the library component Button.');
    await approve(page);
    await expect(row(page, 'Button').getByTestId('lp-binding-library')).toHaveText('The library component Button (components/Button).', { timeout: 30_000 });
    expect(read(INVOICES)).toContain('<Button />');
    expect(read(INVOICES)).toContain("import { Button } from '../../../library/components/Button';");
  });
});

// The contract's mock (?line=mock) shows the same two bindings with no server.
test('Pages bindings on the contract mock (?line=mock)', async ({ page }) => {
  await gotoCockpit(page, '/pages?line=mock&feature=orders&page=orders%2Fpages%2FOrdersPage');
  await expect(row(page, 'ListPage').getByTestId('lp-binding-library')).toHaveText('The library page ListPage (pages/ListPage).', { timeout: 30_000 });
  await panel(page).getByTestId('lp-bind-fix').click();
  await expect(row(page, 'ListPage').getByTestId('lp-binding-action')).toHaveAttribute('data-resolution', 'api', { timeout: 30_000 });
});
