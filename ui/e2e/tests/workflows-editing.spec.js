import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileWorkflow } from '../../../src/engine/workflowGenerator.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.resolve(__dirname, '../screenshots');
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

// Run with E2E_CLIENT_PORT/E2E_SERVER_PORT set (see ui/e2e/playwright.config.js).
const API_BASE = process.env.E2E_API_BASE || 'http://localhost:4000';

const CHECKOUT = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../fixtures/workflow-graphs/checkout.json'), 'utf8'));
const ORIGINAL = compileWorkflow(CHECKOUT, { name: 'Checkout' }).source;

// #61 (epic #57) — visual editing of a real workflow file: add/rename/remove
// state, add/retarget/remove transition, each previewed as a diff before it
// is written, refused when ambiguous, nothing but the source file changed.
test.describe('Workflows screen: visual editing saved back to source (#61)', () => {
  let projectDir;
  let file;

  test.beforeAll(async ({ request }) => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-ui-e2e-workflows-edit-'));
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
    await expect(page.getByTestId('wf-state-idle')).toBeVisible();
    // #248: the edit form is the Edit tab of the Tools panel.
    await page.getByRole('tab', { name: 'Edit' }).click();
  }

  test('add a state: diff preview, then Confirm writes it to the real file', async ({ page }) => {
    await open(page);
    await page.getByLabel('New state name').fill('refunded');
    await page.getByRole('button', { name: 'Add state' }).click();
    const diff = page.getByTestId('wf-diff-preview');
    await expect(diff).toContainText('refunded: {}');
    // nothing written yet
    expect(fs.readFileSync(file, 'utf8')).toBe(ORIGINAL);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'workflows-edit-diff-preview.png'), fullPage: true });

    await diff.getByRole('button', { name: 'Confirm save' }).click();
    await expect(page.getByTestId('wf-state-refunded')).toBeVisible();
    await expect(page.getByTestId('wf-diff-preview')).toHaveCount(0);
    expect(fs.readFileSync(file, 'utf8')).toContain('refunded: {}');
    // zero metadata: the workflows/ folder still holds just the source files
    expect(fs.readdirSync(path.dirname(file)).sort()).toEqual(['CheckoutWorkflow.tsx', 'Seed.tsx']);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'workflows-edit-state-added.png'), fullPage: true });
  });

  test('cancel leaves the file untouched', async ({ page }) => {
    await open(page);
    await page.getByLabel('New state name').fill('ghost');
    await page.getByRole('button', { name: 'Add state' }).click();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByTestId('wf-diff-preview')).toHaveCount(0);
    expect(fs.readFileSync(file, 'utf8')).toBe(ORIGINAL);
  });

  test('add a transition with the form', async ({ page }) => {
    await open(page);
    await page.getByLabel('Transition from').selectOption('done');
    await page.getByLabel('Event for new transitions').fill('RESET');
    await page.getByLabel('Transition to').selectOption('idle');
    await page.getByRole('button', { name: 'Add transition' }).click();
    await page.getByRole('button', { name: 'Confirm save' }).click();
    await expect(page.locator('.react-flow__edge-text').filter({ hasText: 'RESET' })).toHaveCount(1);
    expect(fs.readFileSync(file, 'utf8')).toMatch(/RESET: 'idle'/);
  });

  test('add a transition by dragging from one state to another', async ({ page }) => {
    await open(page);
    await page.getByLabel('Event for new transitions').fill('SKIP');
    const from = page.getByTestId('wf-state-idle').locator('.react-flow__handle.source').first();
    const to = page.getByTestId('wf-state-done').locator('.react-flow__handle.target').first();
    const a = await from.boundingBox();
    const b = await to.boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 8 });
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect(page.getByTestId('wf-diff-preview')).toContainText("SKIP: 'done'");
    await page.getByRole('button', { name: 'Confirm save' }).click();
    await expect(page.locator('.react-flow__edge-text').filter({ hasText: 'SKIP' })).toHaveCount(1);
    expect(fs.readFileSync(file, 'utf8')).toMatch(/SKIP: 'done'/);
  });

  test('retarget a transition by dragging its arrowhead to another state', async ({ page }) => {
    await open(page);
    const edge = page.locator('.react-flow__edge').filter({ hasText: 'SUBMIT' });
    await edge.locator('.react-flow__edgeupdater-target').hover({ force: true });
    const anchor = await edge.locator('.react-flow__edgeupdater-target').boundingBox();
    const to = await page.getByTestId('wf-state-done').locator('.react-flow__handle.target').first().boundingBox();
    await page.mouse.move(anchor.x + anchor.width / 2, anchor.y + anchor.height / 2);
    await page.mouse.down();
    await page.mouse.move(anchor.x + anchor.width / 2 + 20, anchor.y + anchor.height / 2 + 30, { steps: 5 });
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 15 });
    await page.mouse.up();
    await expect(page.getByTestId('wf-diff-preview')).toContainText('SUBMIT: "done"');
    await page.getByRole('button', { name: 'Confirm save' }).click();
    await expect(page.getByTestId('wf-diff-preview')).toHaveCount(0);
    expect(fs.readFileSync(file, 'utf8')).toMatch(/SUBMIT: "done"|SUBMIT: 'done'/);
  });

  test('rename a state updates the key, initial and every transition target', async ({ page }) => {
    await open(page);
    await page.getByLabel('State to rename or remove').selectOption('idle');
    await page.getByLabel('Rename to').fill('ready');
    await page.getByRole('button', { name: 'Rename state' }).click();
    await page.getByRole('button', { name: 'Confirm save' }).click();
    await expect(page.getByTestId('wf-state-ready')).toBeVisible();
    await expect(page.getByTestId('wf-state-idle')).toHaveCount(0);
    const src = fs.readFileSync(file, 'utf8');
    expect(src).toContain("initial: 'ready'");
    expect(src).toContain('target: "ready"');
  });

  test('remove a transition: select the arrow, preview, confirm', async ({ page }) => {
    await open(page);
    await page.locator('.react-flow__edge-text').filter({ hasText: 'SUCCESS' }).click({ force: true });
    await page.getByRole('button', { name: 'Remove selected transition' }).click();
    await page.getByRole('button', { name: 'Confirm save' }).click();
    await expect(page.locator('.react-flow__edge-text').filter({ hasText: 'SUCCESS' })).toHaveCount(0);
    expect(fs.readFileSync(file, 'utf8')).not.toMatch(/SUCCESS: \{/);
  });

  test('ambiguous edits are refused with a reason; guarded transitions are not editable', async ({ page }) => {
    await open(page);
    // "done" is still the target of SUCCESS
    await page.getByLabel('State to rename or remove').selectOption('done');
    await page.getByRole('button', { name: 'Remove state' }).click();
    await expect(page.getByTestId('wf-edit-error')).toContainText('still the target');
    // initial state cannot be removed
    await page.getByLabel('State to rename or remove').selectOption('idle');
    await page.getByRole('button', { name: 'Remove state' }).click();
    await expect(page.getByTestId('wf-edit-error')).toContainText('initial');
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'workflows-edit-refused.png'), fullPage: true });
    // guarded FAILURE [hasError]: selecting it does not enable removal
    await page.locator('.react-flow__edge-text').filter({ hasText: 'FAILURE [hasError]' }).click({ force: true });
    await expect(page.getByRole('button', { name: 'Remove selected transition' })).toBeDisabled();
    expect(fs.readFileSync(file, 'utf8')).toBe(ORIGINAL);
  });

  test('a stale edit (file changed on disk after load) is refused, not clobbered', async ({ page }) => {
    await open(page);
    await page.getByLabel('New state name').fill('late');
    await page.getByRole('button', { name: 'Add state' }).click();
    await expect(page.getByTestId('wf-diff-preview')).toBeVisible();
    fs.writeFileSync(file, `${ORIGINAL}\n// edited elsewhere\n`);
    await page.getByRole('button', { name: 'Confirm save' }).click();
    await expect(page.getByTestId('wf-edit-error')).toContainText('changed on disk');
    expect(fs.readFileSync(file, 'utf8')).toContain('edited elsewhere');
    expect(fs.readFileSync(file, 'utf8')).not.toContain('late: {}');
  });
});
