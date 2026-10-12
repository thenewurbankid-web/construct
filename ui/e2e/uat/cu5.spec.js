import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test, expect, freshSample, openSampleFromPicker, goToScreen, expectAxeClean, expectLayoutFits, approveInPlan, expectPlainEnglish, clicker, REPO, WS } from './support/uat.js';

// UAT walk for cu5 (docs/line/review.md, "cu5"): the Pages screen shows each page's two bindings side by side --
// Morpheus (the library component each part is) and Trace (the data, states and actions each part is bound to) --
// as a non-technical owner walks it: clicks only, every decision at most two clicks (Bind + Approve), no technical
// detail outside Details, accessibility and layout checked.
//   1. On a fresh examples/line-sample: Pages -> orders -> OrdersPage: ListPage from the library; "More" has no home;
//      the recommended fix binds it to GET /api/orders, then Approve: "More" calls the API.
//   2. billing -> InvoicesPage: OrderButton (from orders) bound to the library Button, then Approve.
//   3. The public sample app contact-manager-ui (Apache-2.0, https://github.com/neemiassgc/contact-manager-ui), its
//      contacts page put into a Line feature with Trace's contacts contract: Subframe parts are "not from your library",
//      Trace finds the loading/disabled states and the Add button calling POST /api/contacts; Button is bound to the
//      library Button through the Plan panel.
const pageRow = (page, name) => page.locator(`[data-testid="lp-page"][data-page="${name}"]`);
const pickFeature = (page, name) => page.getByRole('list', { name: 'Features' }).getByRole('button').filter({ hasText: name }).click();
const panel = (page) => page.getByTestId('lp-binding');
const row = (page, tag) => panel(page).locator(`[data-testid="lp-binding-row"][data-part="${tag}"]`);

test('cu5 UAT on the Line sample: both bindings of a page, an action bound to the API and a part to the library', async ({ page }, testInfo) => {
  const sample = freshSample();
  const me = clicker();
  await openSampleFromPicker(page);
  await goToScreen(page, 'Pages');
  await expect(page.getByRole('heading', { name: 'Which feature?' })).toBeVisible({ timeout: 30_000 });
  await pickFeature(page, 'orders');
  await pageRow(page, 'OrdersPage').getByRole('button', { name: 'OrdersPage' }).click();
  await expect(page.getByRole('heading', { name: 'How OrdersPage is bound' })).toBeVisible({ timeout: 30_000 });
  await expect(row(page, 'ListPage').getByTestId('lp-binding-library')).toHaveText('The library page ListPage (pages/ListPage).');
  await expect(row(page, 'ListPage').getByTestId('lp-binding-action')).toHaveAttribute('data-resolution', 'unresolved');
  await expectPlainEnglish(panel(page));
  await expectAxeClean(page, '[data-testid="lp-binding"]');
  await expectLayoutFits(page, '[data-testid="line-pages"]', testInfo, 'cu5-orders');

  // The recommended fix, then Approve: two clicks.
  const bindMore = me.action('bind "More" to the API');
  await me.click(panel(page).getByTestId('lp-bind-fix'));
  await expect(panel(page).getByTestId('lp-bind-outcome')).toHaveText(/^Waiting for your approval: Binds "More" on ListPage in the page OrdersPage to GET \/api\/orders/);
  me.count += 1;
  await approveInPlan(page);
  bindMore.done();
  await expect(row(page, 'ListPage').getByTestId('lp-binding-action')).toHaveAttribute('data-resolution', 'api', { timeout: 30_000 });
  expect(sample.read('features/orders/pages/OrdersPage.tsx')).toContain('data-action="reload"');

  // billing: OrderButton comes from another feature; bind it to the library Button (Bind, then Approve).
  await pickFeature(page, 'billing');
  await pageRow(page, 'InvoicesPage').getByRole('button', { name: 'InvoicesPage' }).click({ timeout: 30_000 });
  const ob = row(page, 'OrderButton');
  await expect(ob.getByTestId('lp-binding-library')).toHaveText('OrderButton from the feature orders, based on the library Button.', { timeout: 30_000 });
  await ob.getByLabel('Library component').selectOption({ label: 'Button' });
  const bindButton = me.action('bind OrderButton to the library Button');
  await me.click(ob.getByRole('button', { name: 'Bind to library' }));
  me.count += 1;
  await approveInPlan(page);
  bindButton.done();
  await expect(row(page, 'Button').getByTestId('lp-binding-library')).toHaveText('The library component Button (components/Button).', { timeout: 30_000 });
  expect(sample.read('features/billing/pages/InvoicesPage.tsx')).toContain('<Button />');
});

/** A clone of contact-manager-ui outside the repo: $CU5_CONTACT_MANAGER, else <tmp>/contact-manager-ui (cloned once). */
function contactManager() {
  const given = process.env.CU5_CONTACT_MANAGER;
  const dir = given || path.join(os.tmpdir(), 'contact-manager-ui');
  const page = path.join(dir, 'src/app/(core)/page.tsx');
  if (!fs.existsSync(page) && !given) {
    try { execFileSync('git', ['clone', '--depth', '1', 'https://github.com/neemiassgc/contact-manager-ui', dir], { stdio: 'ignore', timeout: 120_000 }); } catch { /* reported below */ }
  }
  return fs.existsSync(page) ? page : null;
}

test('cu5 UAT on contact-manager-ui: Trace\'s page map of a real Subframe page next to Morpheus\'s library binding', async ({ page }, testInfo) => {
  const source = contactManager();
  test.skip(!source, 'contact-manager-ui could not be cloned here (no network?); set CU5_CONTACT_MANAGER to a clone of https://github.com/neemiassgc/contact-manager-ui');
  // The owner's project: the Line sample with a contacts feature holding the app's contacts page and Trace's contacts contract.
  const dir = path.join(WS, 'line-sample');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.cpSync(path.join(REPO, 'examples/line-sample'), dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'features/contacts/pages'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'features/contacts/spec.md'), '# Contacts\n\n## As a person, I want to keep my contacts, so that I can reach them.\n\n- The ContactsPage lists every contact.\n');
  fs.copyFileSync(path.join(REPO, 'trace/examples/contacts/openapi.json'), path.join(dir, 'features/contacts/openapi.json'));
  fs.writeFileSync(path.join(dir, 'features/contacts/pages/ContactsPage.tsx'), `// @line-base pages/ListPage\n${fs.readFileSync(source, 'utf8')}`);
  const file = 'features/contacts/pages/ContactsPage.tsx';
  const me = clicker();

  await openSampleFromPicker(page);
  await goToScreen(page, 'Pages');
  await pickFeature(page, 'contacts');
  await pageRow(page, 'ContactsPage').getByRole('button', { name: 'ContactsPage' }).click({ timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'How ContactsPage is bound' })).toBeVisible({ timeout: 30_000 });
  await expect(panel(page).getByTestId('lp-contract')).toHaveText('The API contract of contacts (openapi.json) has 4 endpoints.');
  await expect(row(page, 'TextField').getByTestId('lp-binding-library')).toHaveText('TextField comes from @/subframe/components/TextField, not from your library.');
  await expect(row(page, 'TextField').getByTestId('lp-binding-state')).toHaveText(['Disabled when loading || userAbsence.']);
  await expect(row(page, 'Drawer').getByTestId('lp-binding-state')).toHaveText(['Shown only when openContactDrawer.']);
  await expect(row(page, 'Button').getByTestId('lp-binding-action')).toHaveText('Calls the API "Add" calls POST /api/contacts (create a new item).');
  await expect(panel(page).getByTestId('lp-binding-finding')).toHaveCount(2);
  await expectPlainEnglish(panel(page));
  await expectAxeClean(page, '[data-testid="lp-binding"]');
  await expectLayoutFits(page, '[data-testid="line-pages"]', testInfo, 'cu5-contacts');

  // Morpheus: the Subframe Button becomes the library Button (its import points at the library), Bind + Approve.
  const b = row(page, 'Button');
  await b.getByLabel('Library component').selectOption({ label: 'Button' });
  const bindButton = me.action('bind Button to the library');
  await me.click(b.getByRole('button', { name: 'Bind to library' }));
  await expect(panel(page).getByTestId('lp-bind-outcome')).toHaveText('Waiting for your approval: Points Button in the page ContactsPage at the library component Button, instead of @/subframe/components/Button.');
  me.count += 1;
  await approveInPlan(page);
  bindButton.done();
  await expect(row(page, 'Button').getByTestId('lp-binding-library')).toHaveText('The library component Button (components/Button).', { timeout: 30_000 });
  expect(fs.readFileSync(path.join(dir, file), 'utf8')).toContain("import { Button } from '../../../library/components/Button';");

  // Trace: the grid toggle has no home; the recommended fix is one click plus Approve.
  const grid = panel(page).getByTestId('lp-binding-finding').filter({ hasText: 'IconButton' });
  const bindGrid = me.action('bind the grid toggle');
  await me.click(grid.getByTestId('lp-bind-fix'));
  me.count += 1;
  await approveInPlan(page);
  bindGrid.done();
  await expect(panel(page).getByTestId('lp-binding-finding')).toHaveCount(1, { timeout: 30_000 });
});
