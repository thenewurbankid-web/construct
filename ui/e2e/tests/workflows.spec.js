import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileWorkflow } from '../../../src/engine/workflowGenerator.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.resolve(__dirname, '../screenshots');
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

// Dedicated ports (playwright.workflows.config.js); override with
// WORKFLOWS_API_BASE when using the standard config.
const API_BASE = process.env.WORKFLOWS_API_BASE || 'http://localhost:4105';

const CHECKOUT = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../fixtures/workflow-graphs/checkout.json'), 'utf8'));

// One supported machine plus one whose config is a spread (not statically
// analyzable) in the same file — the second must degrade to a message.
const MIXED = `import { createMachine } from 'xstate';
const base = { id: 'x' };
export const Good = createMachine({
  id: 'toggle',
  initial: 'off',
  states: { off: { on: { TOGGLE: 'on' } }, on: { on: { TOGGLE: 'off' } } },
});
export const Complex = createMachine({ ...base, initial: 'a', states: { a: {} } });
`;

const NESTED = `import { setup } from 'xstate';
export const Player = setup({}).createMachine({
  id: 'player',
  initial: 'stopped',
  states: {
    stopped: { on: { PLAY: 'playing' } },
    playing: {
      initial: 'normal',
      states: { normal: { on: { SEEK: 'seeking' } }, seeking: { after: { 500: 'normal' } } },
      on: { STOP: 'stopped', TICK: { actions: 'advance' } },
    },
  },
});
`;

test.describe('Workflows screen: real XState machines as diagrams (#59, #60, epic #57)', () => {
  let projectDir;
  let checkoutPath;

  test.beforeAll(async ({ request }) => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-ui-e2e-workflows-'));
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir } });
    await request.post(`${API_BASE}/api/init`);
    await request.post(`${API_BASE}/api/create`, { data: { kind: 'single', name: 'Checkout', feature: 'shop', layer: 'workflow' } });
    checkoutPath = path.join(projectDir, 'features/shop/workflows/CheckoutWorkflow.tsx');
    fs.mkdirSync(path.dirname(checkoutPath), { recursive: true });
    // Real generated output of `construct generate workflow ... --from checkout.json`.
    fs.writeFileSync(checkoutPath, compileWorkflow(CHECKOUT, { name: 'Checkout' }).source);
    fs.writeFileSync(path.join(projectDir, 'features/shop/workflows/Mixed.ts'), MIXED);
    fs.writeFileSync(path.join(projectDir, 'features/shop/workflows/Nested.ts'), NESTED);
    fs.writeFileSync(path.join(projectDir, 'features/shop/workflows/Broken.ts'), 'export const b = createMachine({ initial: ');
  });

  test.afterAll(async ({ request }) => {
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir: path.resolve(__dirname, '../../..') } });
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  test('nav entry -> feature -> file renders states, guarded edges, initial + final', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Workflows' }).click();
    await expect(page.getByRole('heading', { name: 'Workflows' })).toBeVisible();

    await page.getByRole('combobox').selectOption('shop');
    await expect(page.getByRole('button', { name: 'CheckoutWorkflow.tsx' })).toBeVisible();
    await page.getByRole('button', { name: 'CheckoutWorkflow.tsx' }).click();

    for (const s of ['idle', 'submitting', 'done']) await expect(page.getByTestId(`wf-state-${s}`)).toBeVisible();
    await expect(page.getByTestId('wf-start')).toBeVisible();
    await expect(page.getByTestId('wf-state-done')).toContainText('final');
    await expect(page.getByTestId('wf-state-idle')).toContainText('initial');
    const edgeLabels = page.locator('.react-flow__edge-text');
    await expect(edgeLabels.filter({ hasText: 'SUBMIT' })).toHaveCount(1);
    await expect(edgeLabels.filter({ hasText: 'FAILURE [hasError]' })).toHaveCount(1);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'workflows-checkout-machine.png'), fullPage: true });
  });

  test('a machine that cannot be analyzed shows a clear message; the rest of the file still renders', async ({ page }) => {
    await page.goto('/workflows');
    await page.getByRole('combobox').selectOption('shop');
    await page.getByRole('button', { name: 'Mixed.ts' }).click();
    await expect(page.getByTestId('wf-machine')).toHaveCount(2);
    await expect(page.getByTestId('wf-state-off')).toBeVisible();
    await expect(page.getByTestId('wf-machine-error')).toContainText("Can't visualize this machine");
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'workflows-unsupported-machine.png'), fullPage: true });

    await page.getByRole('button', { name: 'Broken.ts' }).click();
    await expect(page.getByTestId('wf-file-error')).toContainText("Can't visualize this file");
  });

  test('nested (compound) states, after-delays and internal transitions are drawn', async ({ page }) => {
    await page.goto('/workflows');
    await page.getByRole('combobox').selectOption('shop');
    await page.getByRole('button', { name: 'Nested.ts' }).click();
    await expect(page.getByTestId('wf-state-playing')).toContainText('compound');
    await expect(page.getByTestId('wf-state-playing.seeking')).toBeVisible();
    await expect(page.getByTestId('wf-state-playing')).toContainText('TICK');
    await expect(page.locator('.react-flow__edge-text').filter({ hasText: 'after 500ms' })).toHaveCount(1);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'workflows-nested-machine.png'), fullPage: true });
  });

  test('always derived from real source: editing the file changes the diagram on re-read', async ({ page }) => {
    await page.goto('/workflows');
    await page.getByRole('combobox').selectOption('shop');
    await page.getByRole('button', { name: 'CheckoutWorkflow.tsx' }).click();
    await expect(page.getByTestId('wf-state-done')).toBeVisible();
    await expect(page.getByTestId('wf-state-refunded')).toHaveCount(0);

    const src = fs.readFileSync(checkoutPath, 'utf8');
    fs.writeFileSync(checkoutPath, src.replace('done: {', 'refunded: { type: "final" },\n    done: {'));
    await page.getByRole('button', { name: 'Re-read from source' }).click();
    await expect(page.getByTestId('wf-state-refunded')).toBeVisible();
    fs.writeFileSync(checkoutPath, src);
  });

  test('scope guard: the API refuses to read outside workflows/', async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/workflows/machines?feature=shop&file=${encodeURIComponent('../../../architecture.yml')}`);
    expect(res.status()).toBe(400);
  });
});
