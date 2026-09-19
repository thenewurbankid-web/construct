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

const FIXTURES = path.resolve(__dirname, '../../../fixtures/workflow-graphs');
const REFUND = fs.readFileSync(path.join(FIXTURES, 'refund-request.ts'), 'utf8');
const CHECKOUT = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'checkout.json'), 'utf8'));
const CHECKOUT_SRC = compileWorkflow(CHECKOUT, { name: 'Checkout' }).source;

// Epic #185 (#189) — the Workflows screen explains each machine in plain
// English, lists every scenario and flags structural problems, all derived
// from the real source on each load, re-read and confirmed visual edit.
test.describe('Workflows screen: plain-English narrative, scenarios and health (#189)', () => {
  let projectDir;
  let wfDir;

  test.beforeAll(async ({ request }) => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-ui-e2e-workflows-narrative-'));
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir } });
    await request.post(`${API_BASE}/api/init`);
    await request.post(`${API_BASE}/api/create`, { data: { kind: 'single', name: 'Seed', feature: 'shop', layer: 'workflow' } });
    wfDir = path.join(projectDir, 'features/shop/workflows');
  });

  test.beforeEach(() => {
    fs.writeFileSync(path.join(wfDir, 'RefundRequestWorkflow.ts'), REFUND);
    fs.writeFileSync(path.join(wfDir, 'CheckoutWorkflow.tsx'), CHECKOUT_SRC);
  });

  test.afterAll(async ({ request }) => {
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir: path.resolve(__dirname, '../../..') } });
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  async function open(page, file) {
    await page.goto('/workflows');
    await page.getByRole('combobox').first().selectOption('shop');
    await page.getByRole('button', { name: file }).click();
  }

  test('diagram with the English, scenarios and health beneath it', async ({ page }) => {
    await open(page, 'RefundRequestWorkflow.ts');
    await expect(page.getByTestId('wf-state-submitted')).toBeVisible();
    await expect(page.getByTestId('wf-narrative-summary')).toContainText('The "refund request" flow has 8 steps.');
    const english = page.getByTestId('wf-narrative-english');
    await expect(english).toContainText('This flow starts in submitted.');
    await expect(english).toContainText('Immediately, the flow moves to approved — only if it is low value.');
    await expect(english).toContainText('After 48 hours, the flow moves to escalated.');
    await expect(english).toContainText('closed is an end state — the flow stops there.');
    // inline code names render as <code>, state names as <em>
    await expect(english.locator('code', { hasText: 'notifyCustomer' }).first()).toBeVisible();
    await expect(english.locator('em.wf-nar-state', { hasText: 'manual review' }).first()).toBeVisible();
    // scenarios: happy path first, Given/When/Then
    const happy = page.getByTestId('wf-scenario-1');
    await expect(happy).toContainText('Happy path');
    await expect(happy).toContainText('submitted → auto check → approved → refunded → closed');
    await expect(happy).toContainText('Given the flow starts in submitted');
    await expect(happy).toContainText('And the flow ends — closed is an end state');
    await expect(page.getByTestId('wf-narrative-scenarios').locator('[data-testid^="wf-scenario-"]')).toHaveCount(9);
    await expect(page.getByTestId('wf-health-ok')).toBeVisible();
    await page.getByTestId('wf-machine').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'workflows-narrative-diagram-and-english.png'), fullPage: true });
    await page.getByTestId('wf-narrative-scenarios').scrollIntoViewIfNeeded();
    await page.getByTestId('wf-narrative').screenshot({ path: path.join(SCREENSHOTS_DIR, 'workflows-narrative-panels.png') });
  });

  test('health findings appear for a machine with problems, and Re-read from source refreshes the English', async ({ page }) => {
    await open(page, 'CheckoutWorkflow.tsx');
    await expect(page.getByTestId('wf-narrative-summary')).toContainText('The "checkout" flow has 3 steps.');
    await expect(page.getByTestId('wf-finding-no-fallback')).toContainText('"failure" only applies under a condition');
    // the file changes on disk (someone else edits it); Re-read shows the new English
    fs.writeFileSync(path.join(wfDir, 'CheckoutWorkflow.tsx'), CHECKOUT_SRC.replace('done: {\n        type: "final"\n    }', 'done: {}'));
    await page.getByRole('button', { name: 'Re-read from source' }).click();
    await expect(page.getByTestId('wf-narrative-summary')).toContainText('has no end state');
    await expect(page.getByTestId('wf-finding-dead-end')).toContainText('done is a dead end');
    await expect(page.getByTestId('wf-finding-no-end-state')).toBeVisible();
  });

  test('a confirmed visual edit updates the English immediately', async ({ page }) => {
    await open(page, 'CheckoutWorkflow.tsx');
    await expect(page.getByTestId('wf-narrative-summary')).toContainText('can end in done.');
    await expect(page.getByTestId('wf-narrative-state-refunded')).toHaveCount(0);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'workflows-narrative-before-edit.png'), fullPage: true });

    // #248: editing is the Edit tab; the English is the Narrative tab.
    await page.getByRole('tab', { name: 'Edit' }).click();

    await page.getByLabel('New state name').fill('refunded');
    await page.getByRole('button', { name: 'Add state' }).click();
    await page.getByRole('button', { name: 'Confirm save' }).click();
    await expect(page.getByTestId('wf-state-refunded')).toBeVisible();
    await page.getByRole('tab', { name: 'Narrative' }).click();

    // the English now knows about the new state, and Health flags it
    const block = page.getByTestId('wf-narrative-state-refunded');
    await expect(block).toContainText('There is no way out of refunded — the flow gets stuck there.');
    await expect(page.getByTestId('wf-finding-unreachable')).toContainText('refunded can never be reached');
    await expect(page.getByTestId('wf-finding-dead-end')).toContainText('refunded is a dead end');
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'workflows-narrative-after-edit.png'), fullPage: true });

    // wire it up: done --RESET--> refunded; the English and Health follow
    await page.getByRole('tab', { name: 'Edit' }).click();
    await page.getByLabel('Transition from').selectOption('done');
    await page.getByLabel('Event for new transitions').fill('REFUND');
    await page.getByLabel('Transition to').selectOption('refunded');
    await page.getByRole('button', { name: 'Add transition' }).click();
    await page.getByRole('button', { name: 'Confirm save' }).click();
    await page.getByRole('tab', { name: 'Narrative' }).click();
    await expect(page.getByTestId('wf-narrative-state-done')).toContainText('When "refund" happens, the flow moves to refunded.');
    await expect(page.getByTestId('wf-finding-unreachable')).toHaveCount(0);
  });
});
