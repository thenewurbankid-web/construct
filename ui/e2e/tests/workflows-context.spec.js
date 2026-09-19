import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileWorkflow } from '../../../src/engine/workflowGenerator.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.resolve(__dirname, '../screenshots');
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

const API_BASE = process.env.E2E_API_BASE || 'http://localhost:4000';

const CHECKOUT = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../fixtures/workflow-graphs/checkout.json'), 'utf8'));
const ORIGINAL = compileWorkflow(CHECKOUT, { name: 'Checkout' }).source;

// Epic #223 -- edit a machine's context and actions/guards from the Context /
// Actions panel; every edit is a diff preview, then a hash-checked,
// enforcement-gated write to the real file, and the plain-English narrative
// follows.
test.describe('Workflows screen: context, actions and guards (#223)', () => {
  let projectDir;
  let file;

  test.beforeAll(async ({ request }) => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-ui-e2e-workflows-context-'));
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir } });
    await request.post(`${API_BASE}/api/init`);
    await request.post(`${API_BASE}/api/create`, { data: { kind: 'single', name: 'Seed', feature: 'shop', layer: 'workflow' } });
    file = path.join(projectDir, 'features/shop/workflows/CheckoutWorkflow.tsx');
  });

  test.beforeEach(() => {
    fs.writeFileSync(file, ORIGINAL);
  });

  test.afterAll(async ({ request }) => {
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir: path.resolve(__dirname, '../../..') } });
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  async function open(page) {
    await page.goto('/workflows');
    await page.getByRole('combobox').first().selectOption('shop');
    await page.getByRole('button', { name: 'CheckoutWorkflow.tsx' }).click();
    // #248: Context & actions is a Tools tab.
    await page.getByRole('tab', { name: 'Context & actions' }).click();
    await expect(page.getByTestId('wf-context-panel')).toBeVisible();
  }

  async function confirm(page) {
    const diff = page.getByTestId('wf-diff-preview');
    await expect(diff).toBeVisible();
    await diff.getByRole('button', { name: 'Confirm save' }).click();
    await expect(diff).toHaveCount(0);
  }

  test('shows the existing context, then add a field, declare and attach an action, set a guard', async ({ page }) => {
    await open(page);
    const panel = page.getByTestId('wf-context-panel');
    await expect(panel.getByTestId('wf-context-quantity')).toContainText('number');
    await expect(panel.getByTestId('wf-context-error')).toContainText('string | null');

    // add a context field: previewed, then written (interface kept in sync)
    await panel.getByLabel('New context field name').fill('coupon');
    await panel.getByLabel('Context field type').fill('string | null');
    await panel.getByLabel('Context field initial value').fill('null');
    await panel.getByRole('button', { name: 'Add context field' }).click();
    await expect(page.getByTestId('wf-diff-preview')).toContainText('coupon: string | null;');
    expect(fs.readFileSync(file, 'utf8')).toBe(ORIGINAL);
    await confirm(page);
    await expect(panel.getByTestId('wf-context-coupon')).toBeVisible();
    expect(fs.readFileSync(file, 'utf8')).toContain('context: { quantity: 1, error: null, coupon: null }');
    await page.getByRole('tab', { name: 'Narrative' }).click();
    await expect(page.getByTestId('wf-narrative-context')).toContainText('It remembers coupon (text that can be empty), starting as empty.');
    await page.getByRole('tab', { name: 'Context & actions' }).click();

    // declare an action, attach it to entering `idle`
    await panel.getByLabel('New action name').fill('trackVisit');
    await panel.getByRole('button', { name: 'Declare action' }).click();
    await confirm(page);
    await expect(panel.getByTestId('wf-action-trackVisit')).toContainText('not used yet');
    await panel.getByLabel('Where the action runs').selectOption('entry');
    await panel.getByLabel('State for the action').selectOption('idle');
    await panel.getByRole('button', { name: 'Attach action' }).click();
    await confirm(page);
    await expect(panel.getByTestId('wf-action-trackVisit')).toContainText('entry of idle');
    await page.getByRole('tab', { name: 'Narrative' }).click();
    await expect(page.getByTestId('wf-narrative-state-idle')).toContainText('On entering, it runs trackVisit.');
    await page.getByRole('tab', { name: 'Context & actions' }).click();

    // declare a guard and put it on SUBMIT
    await panel.getByLabel('New guard name').fill('isValid');
    await panel.getByRole('button', { name: 'Declare guard' }).click();
    await confirm(page);
    await panel.getByLabel('Which transition gets the guard').selectOption({ label: 'idle --SUBMIT--> submitting' });
    await panel.getByLabel('Guard condition').selectOption('isValid');
    await panel.getByRole('button', { name: 'Set guard' }).click();
    await confirm(page);
    await expect(panel.getByTestId('wf-guard-isValid')).toContainText('idle --SUBMIT-->');

    const source = fs.readFileSync(file, 'utf8');
    expect(source).toContain("entry: 'trackVisit'");
    expect(source).toContain("guard: 'isValid'");
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'workflows-context-actions-panel.png'), fullPage: true });

    // used actions cannot be removed; unused ones can
    await expect(panel.getByRole('button', { name: 'Remove action trackVisit' })).toBeDisabled();
  });

  test('a non-literal initial value is refused and nothing is written', async ({ page }) => {
    await open(page);
    const panel = page.getByTestId('wf-context-panel');
    await panel.getByLabel('New context field name').fill('bad');
    await panel.getByLabel('Context field type').fill('number');
    await panel.getByLabel('Context field initial value').fill('process.exit(1)');
    await panel.getByRole('button', { name: 'Add context field' }).click();
    await expect(page.getByTestId('wf-edit-error')).toContainText('not a plain literal');
    expect(fs.readFileSync(file, 'utf8')).toBe(ORIGINAL);
  });
});
