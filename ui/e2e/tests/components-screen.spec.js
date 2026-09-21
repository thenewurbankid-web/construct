import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { gotoCockpit } from './support/cockpit.js';
import { makeBrowseProject, openProject, SUMMARY_PATH, PLAIN_PATH } from './support/browseProject.js';
import { runAxe, isBlocking, format } from './support/axe.js';

// #431 + #434 -- the Components screen: the Browser lists every component of the open project; choosing one shows it
// in the stage as documentation (name, feature, path, props read by react-docgen) with its file editable as plain
// text, saved through the reviewed path (diff, then a hash-checked, architecture-gated write). ?component= in the URL.
const API = process.env.E2E_API_BASE || 'http://localhost:4000';
const browser = (page) => page.getByRole('complementary', { name: 'Browser' });
const list = (page) => browser(page).getByRole('listbox', { name: 'Components' });
const options = (page) => list(page).getByRole('option');
const NAMES = ['BillingSummary', 'BillingView', 'Broken', 'CheckoutView', 'CurrencyLabel', 'Plain', 'ReportingView'];

/** Appends text at the end of the source editor, whichever adapter loaded (Monaco, or the textarea fallback). */
async function appendToSource(page, text) {
  const editor = page.locator('[data-source-editor]').first();
  await expect(editor).toBeVisible({ timeout: 30_000 });
  if ((await editor.getAttribute('data-source-editor')) === 'textarea') {
    await editor.fill(`${await editor.inputValue()}${text}`);
    return;
  }
  await page.locator('.monaco-editor .view-lines').first().click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(text);
}

test.describe.serial('Components screen: browse in the left pane, document and edit in the stage (#431, #434)', () => {
  let project;
  let restore;

  test.beforeAll(async () => {
    project = makeBrowseProject('og431-components-');
    restore = await openProject(API, project.repo);
  });
  test.afterAll(async () => {
    await restore?.();
    project?.remove();
  });

  test('the Browser lists every component of the project; the rail marks Components; nothing is open yet', async ({ page }) => {
    await gotoCockpit(page, '/components');
    await expect(page.getByRole('navigation', { name: 'Screens', exact: true }).getByRole('link', { name: 'Components' })).toHaveAttribute('aria-current', 'page');
    await expect(options(page)).toHaveText(NAMES.map((n) => new RegExp(`^${n}`)));
    await expect(page.getByTestId('components-list-count')).toHaveText(String(NAMES.length));
    await expect(page.getByTestId('components-pick')).toBeVisible();
    await expect(page.getByTestId('cd-doc')).toHaveCount(0);
    // The old Components entry (the workflow viewer) is still one URL away.
    await page.goto('/workflows');
    await expect(page.getByRole('navigation', { name: 'Screens', exact: true }).getByRole('link', { name: 'Components' })).toHaveAttribute('aria-current', 'page');
  });

  test('choosing a component documents it: name, feature, path and the props table; the file is below; the URL keeps it', async ({ page }) => {
    await gotoCockpit(page, '/components');
    await options(page).filter({ hasText: 'BillingSummary' }).click();
    await expect(page).toHaveURL(new RegExp(`/components\\?component=${encodeURIComponent(SUMMARY_PATH).replace(/\./g, '\\.')}$`));
    await expect(page.getByTestId('cd-name')).toHaveText('BillingSummary');
    await expect(page.getByTestId('cd-feature').getByRole('link', { name: 'billing' })).toHaveAttribute('href', '/?feature=billing');
    await expect(page.getByTestId('cd-path')).toHaveText(SUMMARY_PATH);
    const rows = page.getByTestId('cd-prop');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText('total');
    await expect(rows.nth(0)).toContainText('number');
    await expect(rows.nth(0)).toContainText('yes');
    await expect(rows.nth(0)).toContainText('Amount to show, in whole units.');
    await expect(rows.nth(1)).toContainText('label');
    await expect(rows.nth(1)).toContainText('no');
    await expect(rows.nth(1)).toContainText("'Total'");
    await expect(rows.nth(2)).toContainText('() => void');
    await expect(page.getByTestId('cd-component')).toContainText('A one-line summary of a bill.');
    await expect(page.locator('[data-source-editor]').first()).toBeVisible({ timeout: 30_000 });
    await expect(options(page).filter({ hasText: 'BillingSummary' })).toHaveAttribute('aria-selected', 'true');
    await page.reload();
    await expect(page.getByTestId('cd-name')).toHaveText('BillingSummary');
    await expect(page.getByTestId('cd-prop')).toHaveCount(3);
  });

  test('a component with no props documented, and one that does not parse, say "No prop documentation found" and still show the file', async ({ page }) => {
    await gotoCockpit(page, `/components?component=${encodeURIComponent(PLAIN_PATH)}`);
    await expect(page.getByTestId('cd-name')).toHaveText('Plain');
    await expect(page.getByTestId('cd-none')).toContainText('No prop documentation found');
    await expect(page.getByTestId('cd-path')).toHaveText(PLAIN_PATH);
    await expect(page.locator('[data-source-editor]').first()).toBeVisible({ timeout: 30_000 });

    await options(page).filter({ hasText: 'Broken' }).click();
    await expect(page.getByTestId('cd-name')).toHaveText('Broken');
    await expect(page.getByTestId('cd-none')).toContainText('No prop documentation found');
    await expect(page.getByTestId('cd-reason')).toContainText('could not be parsed');
    await expect(page.getByTestId('cd-source-summary')).toBeVisible();
  });

  test('the filter narrows the list; no match offers Clear the filter; keyboard Up/Down/Home/End/Enter', async ({ page }) => {
    await gotoCockpit(page, '/components');
    const filter = page.getByRole('searchbox', { name: 'Filter components' });
    await filter.fill('view');
    await expect(options(page)).toHaveText([/^BillingView/, /^CheckoutView/, /^ReportingView/]);
    await filter.fill('billing components');
    await expect(options(page)).toHaveText([/^BillingSummary/, /^BillingView/, /^Broken/, /^Plain/]); // every word matches the label or the file path
    await filter.fill('zzz');
    await expect(browser(page).getByTestId('state-empty')).toContainText('Nothing matches');
    await page.getByRole('button', { name: 'Clear the filter' }).click();
    await expect(options(page)).toHaveCount(NAMES.length);

    await expect(list(page).locator('[tabindex="0"]')).toHaveCount(1);
    await filter.focus();
    await page.keyboard.press('ArrowDown');
    await expect(options(page).nth(0)).toBeFocused();
    await page.keyboard.press('End');
    await expect(options(page).nth(NAMES.length - 1)).toBeFocused();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('cd-name')).toHaveText('Broken');
  });

  test('a link to something that is not a component selects nothing and says so', async ({ page }) => {
    await gotoCockpit(page, `/components?component=${encodeURIComponent('features/billing/domain/billingRules.ts')}`);
    await expect(page.getByTestId('state-empty')).toContainText('is not a component of this project');
    await page.getByRole('button', { name: 'Choose another in the Browser' }).click();
    await expect(page).not.toHaveURL(/component=/);
  });

  test('the server refuses a path that is not in the list, a foreign Origin and a non-JSON save, and writes nothing', async ({ page, request }) => {
    await gotoCockpit(page, '/components');
    const status = (p) => page.evaluate(async ([api, p]) => (await fetch(`${api}${p}`, { credentials: 'include' })).status, [API, p]);
    expect(await status('/api/components/source?path=..%2F..%2Fetc%2Fpasswd')).toBe(404);
    expect(await status('/api/components/describe?path=features%2Fbilling%2Fdomain%2FbillingRules.ts')).toBe(404);
    expect(await status('/api/components/source?path=%2Fetc%2Fpasswd')).toBe(404);
    const before = project.read(SUMMARY_PATH);
    const foreign = await request.post(`${API}/api/components/save`, { headers: { origin: 'https://evil.example' }, data: { path: SUMMARY_PATH, content: 'x', commit: true, contentHash: 'x' } });
    expect(foreign.status()).toBe(403);
    const text = await request.post(`${API}/api/components/save`, { headers: { 'content-type': 'text/plain' }, data: 'path=x' });
    expect(text.status()).toBe(415);
    expect(project.read(SUMMARY_PATH)).toBe(before);
  });

  test('edit the file as plain text: Review shows the diff, Cancel keeps the draft, Confirm writes it; the props follow', async ({ page }) => {
    project.git('checkout', '--', SUMMARY_PATH);
    await gotoCockpit(page, `/components?component=${encodeURIComponent(SUMMARY_PATH)}`);
    await expect(page.getByTestId('cd-review')).toBeDisabled();
    await appendToSource(page, '\n// reviewed by the e2e test\n');
    await expect(page.getByTestId('cd-review')).toBeEnabled();
    await page.getByTestId('cd-review').click();
    const diff = page.getByTestId('wf-diff-preview');
    await expect(diff).toContainText('+ // reviewed by the e2e test');
    // Nothing is written until Confirm.
    expect(project.read(SUMMARY_PATH)).not.toContain('reviewed by the e2e test');
    await diff.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByTestId('cd-review')).toBeEnabled();
    await page.getByTestId('cd-review').click();
    await page.getByTestId('wf-diff-preview').getByRole('button', { name: 'Confirm save' }).click();
    await expect(page.getByTestId('cd-saved')).toBeVisible();
    expect(project.read(SUMMARY_PATH)).toContain('// reviewed by the e2e test');
    await expect(page.getByTestId('cd-review')).toBeDisabled();
    await expect(page.getByTestId('cd-prop')).toHaveCount(3);
    // The save went through the normal commit-on-save path.
    expect(project.git('log', '--oneline', '-n', '3')).toMatch(/BillingSummary|billing|update/i);
  });

  test('an edit that breaks an architecture rule is blocked with the rule named, and the file on disk is untouched', async ({ page }) => {
    project.git('checkout', '--', SUMMARY_PATH);
    const original = project.read(SUMMARY_PATH);
    await gotoCockpit(page, `/components?component=${encodeURIComponent(SUMMARY_PATH)}`);
    await expect(page.locator('[data-source-editor]').first()).toBeVisible({ timeout: 30_000 });
    await appendToSource(page, "\nimport { fetchBilling } from '../services/billingService';\nfetchBilling();\n");
    await page.getByTestId('cd-review').click();
    await page.getByTestId('wf-diff-preview').getByRole('button', { name: 'Confirm save' }).click();
    await expect(page.getByTestId('cd-error')).toContainText('Save blocked');
    expect(project.read(SUMMARY_PATH)).toBe(original);
    await expect(page.getByTestId('cd-discard')).toBeEnabled();
    await page.getByTestId('cd-discard').click();
    await expect(page.getByTestId('cd-review')).toBeDisabled();
  });

  test('if the file changed on disk meanwhile, Confirm is refused (409) and Reload from disk takes the new text', async ({ page }) => {
    project.git('checkout', '--', SUMMARY_PATH);
    await gotoCockpit(page, `/components?component=${encodeURIComponent(SUMMARY_PATH)}`);
    await expect(page.locator('[data-source-editor]').first()).toBeVisible({ timeout: 30_000 });
    await appendToSource(page, '\n// my draft\n');
    await page.getByTestId('cd-review').click();
    await expect(page.getByTestId('wf-diff-preview')).toBeVisible();
    fs.writeFileSync(path.join(project.repo, SUMMARY_PATH), `${project.read(SUMMARY_PATH)}// someone else\n`);
    await page.getByTestId('wf-diff-preview').getByRole('button', { name: 'Confirm save' }).click();
    await expect(page.getByTestId('cd-error')).toContainText('changed on disk');
    await expect(page.getByTestId('cd-reload')).toBeVisible();
    expect(project.read(SUMMARY_PATH)).toContain('// someone else');
    expect(project.read(SUMMARY_PATH)).not.toContain('my draft');
    await page.getByTestId('cd-reload').click();
    await expect(page.getByTestId('cd-review')).toBeDisabled();
    project.git('checkout', '--', SUMMARY_PATH);
  });

  test('switching component with unsaved changes asks first; keeping the draft stays put', async ({ page }) => {
    project.git('checkout', '--', SUMMARY_PATH);
    await gotoCockpit(page, `/components?component=${encodeURIComponent(SUMMARY_PATH)}`);
    await expect(page.locator('[data-source-editor]').first()).toBeVisible({ timeout: 30_000 });
    await appendToSource(page, '\n// unsaved\n');
    page.once('dialog', (d) => d.dismiss());
    await options(page).filter({ hasText: 'Plain' }).click();
    await expect(page.getByTestId('cd-name')).toHaveText('BillingSummary');
    page.once('dialog', (d) => d.accept());
    await options(page).filter({ hasText: 'Plain' }).click();
    await expect(page.getByTestId('cd-name')).toHaveText('Plain');
    expect(project.read(SUMMARY_PATH)).not.toContain('unsaved');
  });

  test('loading, error (Try again) and empty (Create one) states of the list', async ({ page }) => {
    let mode = 'slow';
    await page.route('**/api/components', async (route) => {
      if (mode === 'slow') {
        await new Promise((r) => setTimeout(r, 600));
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, count: 0, components: [] }) });
      }
      if (mode === 'error') return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Boom.' }) });
      return route.continue();
    });
    await gotoCockpit(page, '/components');
    await expect(browser(page).getByTestId('state-loading')).toBeVisible();
    await expect(browser(page).getByTestId('state-empty')).toContainText('This project has no components yet');
    await expect(browser(page).getByRole('link', { name: 'Create one' })).toHaveAttribute('href', '/');
    mode = 'error';
    await page.reload();
    await expect(browser(page).getByTestId('state-error')).toContainText('Boom.');
    mode = 'real';
    await browser(page).getByRole('button', { name: 'Try again' }).click();
    await expect(options(page)).toHaveCount(NAMES.length);
  });

  test('at 390px one pane shows at a time: choosing a component brings its documentation forward', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoCockpit(page, '/components');
    const bar = page.getByRole('tablist', { name: 'Panes' });
    await bar.getByRole('tab', { name: 'Browser' }).click();
    await options(page).filter({ hasText: 'BillingView' }).click();
    await expect(bar.getByRole('tab', { name: 'Stage' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('cd-name')).toHaveText('BillingView');
    await expect(page.getByTestId('cd-prop')).toHaveCount(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  for (const theme of ['dark', 'light']) {
    for (const [vp, size] of [['wide', { width: 1280, height: 800 }], ['narrow', { width: 390, height: 844 }]]) {
      test(`accessibility: ${theme} ${vp}, the list and a documented component with its editor`, async ({ page }) => {
        await page.addInitScript((t) => localStorage.setItem('construct.theme', t), theme);
        await page.setViewportSize(size);
        await gotoCockpit(page, `/components?component=${encodeURIComponent(SUMMARY_PATH)}`);
        await expect(page.getByTestId('cd-prop')).toHaveCount(3);
        await expect(page.locator('[data-source-editor]').first()).toBeVisible({ timeout: 30_000 });
        const stage = await runAxe(page, { exclude: ['.monaco-editor'] });
        expect(stage.filter(isBlocking), format(stage.filter(isBlocking))).toEqual([]);
        if (vp === 'narrow') await page.getByRole('tablist', { name: 'Panes' }).getByRole('tab', { name: 'Browser' }).click();
        await expect(list(page)).toBeVisible();
        const browse = await runAxe(page);
        expect(browse.filter(isBlocking), format(browse.filter(isBlocking))).toEqual([]);
      });
    }
  }
});
