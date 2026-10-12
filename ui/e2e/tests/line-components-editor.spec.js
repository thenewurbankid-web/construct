import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gotoCockpit } from './support/cockpit.js';
import { openProject } from './support/browseProject.js';
import { runAxe, isBlocking, format } from './support/axe.js';

// cu4 -- the Components screen's three areas: the Library (cards and each feature's components), the Editor for the
// open component (Behaviour, Events, States; Studio's Editor parts, linked) and New component. On the real server over
// a copy of examples/line-sample plus the cu4 overlay (fixtures/line-cu4: a library Disclosure and orders/OrderDetails
// based on it). Every edit is a plan step that waits in the Plan panel; nothing is written before Approve. A library
// component opens read-only, and editing it is refused with "base a feature item on it" and its typed fix.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const SAMPLE = path.join(REPO, 'examples/line-sample');
const OVERLAY = path.join(REPO, 'fixtures/line-cu4');
const API = process.env.E2E_API_BASE || 'http://localhost:4000';
const FILE = 'features/orders/components/OrderDetails.tsx';
const COPY = 'features/orders/components/OrderDetails.behaviour.json';

const plan = (page) => page.getByTestId('line-plan');
const editor = (page) => page.getByTestId('lc-editor');

/** Approve the newest waiting step and wait until it ran. */
async function approve(page) {
  const step = plan(page).locator('[data-testid="plan-step"][data-state="waiting"]').first();
  await expect(step).toBeVisible({ timeout: 60_000 });
  await step.getByRole('button', { name: /^Approve step \d+$/ }).click();
  await expect(plan(page).locator('[data-testid="plan-step"][data-state="waiting"]')).toHaveCount(0, { timeout: 60_000 });
  // The run (writer + checks) can take a while on a busy machine: wait until no step is still ready or running, so the
  // next change never queues behind it.
  await expect(plan(page).locator('[data-testid="plan-step"][data-state="ready"], [data-testid="plan-step"][data-state="running"]')).toHaveCount(0, { timeout: 60_000 });
}

async function axeClean(page) {
  const found = await runAxe(page, { include: '[data-testid="lc-area"]' });
  expect(found.filter(isBlocking), format(found.filter(isBlocking))).toEqual([]);
}

test.describe.serial('Components editor (Library, Editor, New component; Line sample + cu4 overlay, real server)', () => {
  // The first visit compiles /components in next dev (about 20 s), so each test gets room beyond the 30 s default.
  test.describe.configure({ timeout: 240_000 });
  let base;
  let restore;

  test.beforeAll(async () => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'line-sample-cu4-')));
    fs.cpSync(SAMPLE, base, { recursive: true });
    for (const sub of ['library', 'features']) fs.cpSync(path.join(OVERLAY, sub), path.join(base, sub), { recursive: true });
    restore = await openProject(API, base);
  });
  test.afterAll(async () => {
    await restore?.();
    if (base) fs.rmSync(base, { recursive: true, force: true });
  });

  test('open a feature component: the editor shows it with Behaviour, Events and States tabs; accessible at 1280', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoCockpit(page, '/components');
    await page.getByRole('button', { name: 'Open in the editor: OrderDetails' }).click({ timeout: 60_000 });
    await expect(page).toHaveURL(/component=features%2Forders%2Fcomponents%2FOrderDetails\.tsx/);
    await expect(editor(page)).toHaveAttribute('data-component', 'OrderDetails', { timeout: 60_000 });
    await expect(page.getByTestId('lc-headline')).toHaveText('OrderDetails: a component of orders, based on Disclosure.');
    await expect(page.getByRole('tab')).toHaveText(['Behaviour', 'Events', 'States']);
    await expect(page.getByTestId('lc-behaviour')).toContainText('OrderDetails has no behaviour yet.');
    await expect(page.getByTestId('lc-new')).toBeVisible();
    await axeClean(page);
  });

  test('Behaviour: Add this behaviour waits in the plan; Approve writes the working copy and draws its states', async ({ page }) => {
    await gotoCockpit(page, `/components?component=${encodeURIComponent(FILE)}`);
    const add = page.locator('[data-line-control="components.attachBehaviour"][data-line-target="disclosure"]');
    await add.click({ timeout: 60_000 });
    await expect(page.getByTestId('lc-notice')).toContainText('Waiting for your approval: Gives OrderDetails in orders the disclosure behaviour', { timeout: 60_000 });
    expect(fs.existsSync(path.join(base, COPY))).toBe(false);
    await approve(page);
    await expect(page.getByTestId('lc-primitive')).toHaveAttribute('data-primitive', 'disclosure', { timeout: 60_000 });
    await expect(page.getByTestId('lc-behaviour')).toContainText('Clicking the trigger opens and closes it.');
    await expect(page.getByTestId('lc-node')).toHaveCount(2);
    expect(JSON.parse(fs.readFileSync(path.join(base, COPY), 'utf8')).edits.primitives[0].primitive).toBe('disclosure');
  });

  test('Events: add When -> Do, approve, and the file changes; two that undo each other show a warning and its fix', async ({ page }) => {
    await gotoCockpit(page, `/components?component=${encodeURIComponent(FILE)}&tab=events`);
    await expect(page.getByTestId('lc-events')).toContainText('No When -> Do yet.', { timeout: 60_000 });
    await page.locator('[data-line-control="components.whenSource"]').selectOption('click:trigger');
    await page.locator('[data-line-control="components.whenAction"]').selectOption('primitive:disclosure-1:open');
    await page.locator('[data-line-control="components.addWhenDo"]').click();
    await expect(page.getByTestId('lc-notice')).toContainText(/Waiting for your approval: Adds to OrderDetails: when the trigger is clicked, open the disclosure\./i, { timeout: 60_000 });
    expect(JSON.parse(fs.readFileSync(path.join(base, COPY), 'utf8')).edits.events).toEqual([]);
    await approve(page);
    await expect(page.getByTestId('lc-whendo')).toHaveCount(1, { timeout: 60_000 });
    expect(JSON.parse(fs.readFileSync(path.join(base, COPY), 'utf8')).edits.events.length).toBe(1);
    await page.locator('[data-line-control="components.whenAction"]').selectOption('primitive:disclosure-1:close');
    await page.locator('[data-line-control="components.addWhenDo"]').click();
    await approve(page);
    await expect(page.getByTestId('lc-conflict')).toContainText('nothing seems to happen', { timeout: 60_000 });
    await page.locator('[data-line-control="components.fixWhenDo"]').click();
    await approve(page);
    await expect(page.getByTestId('lc-conflict')).toHaveCount(0, { timeout: 60_000 });
    await axeClean(page);
  });

  test('States: the live current state is marked on the graph; clicking another state is a plan step', async ({ page }) => {
    await gotoCockpit(page, `/components?component=${encodeURIComponent(FILE)}&tab=states`);
    await expect(page.getByTestId('lc-current-state')).toHaveText('closed', { timeout: 60_000 });
    await page.getByRole('button', { name: 'Set to open' }).click();
    await expect(page.getByTestId('lc-notice')).toContainText("Waiting for your approval: Sets OrderDetails's disclosure to open.", { timeout: 60_000 });
    await approve(page);
    await expect(page.getByTestId('lc-current-state')).toHaveText('open', { timeout: 60_000 });
    expect(JSON.parse(fs.readFileSync(path.join(base, COPY), 'utf8')).current).toEqual({ 'disclosure-1': 'open' });
  });

  test('a library component opens read-only; an edit is refused with "base a feature item on it" and its fix is one click', async ({ page }) => {
    await gotoCockpit(page, '/components');
    await page.getByRole('button', { name: 'Open in the editor: Disclosure' }).click({ timeout: 60_000 });
    await expect(page.getByTestId('lc-readonly')).toContainText('Disclosure is a library component: complete, used as it is and never changed here.');
    await page.getByRole('tab', { name: 'Events' }).click();
    const lib = fs.readFileSync(path.join(base, 'library/components/Disclosure.tsx'), 'utf8');
    await page.locator('[data-line-control="components.whenAction"]').selectOption('set:open:true');
    await page.locator('[data-line-control="components.addWhenDo"]').click();
    const refusal = page.getByTestId('lc-refusal');
    await expect(refusal).toContainText('Disclosure is a library component, which stays complete and is never changed here; base a feature item on it and change that.', { timeout: 60_000 });
    await expect(refusal.locator('details')).not.toHaveAttribute('open', '');
    await refusal.getByText('Details').click();
    await expect(refusal).toContainText('LIBRARY_ITEM');
    await expect(plan(page).locator('[data-testid="plan-step"][data-state="waiting"]')).toHaveCount(0);
    expect(fs.readFileSync(path.join(base, 'library/components/Disclosure.tsx'), 'utf8')).toBe(lib);
    await refusal.getByTestId('lc-refusal-fix').click();
    await expect(page.getByTestId('lc-notice')).toContainText('Waiting for your approval: Creates BillingDisclosure in feature billing, based on the library Disclosure.', { timeout: 60_000 });
    await approve(page);
    expect(fs.existsSync(path.join(base, 'features/billing/components/BillingDisclosure.tsx'))).toBe(true);
  });

  test('New component: based on a library component, it waits in the plan and lands on Approve; accessible at 375', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await gotoCockpit(page, '/components');
    const form = page.getByTestId('lc-new');
    await form.locator('[data-line-control="components.newBase"]').selectOption('components/Disclosure', { timeout: 60_000 });
    await form.locator('[data-line-control="components.newFeature"]').selectOption('orders');
    await form.locator('[data-line-control="components.newName"]').fill('OrderFaq');
    await form.locator('[data-line-control="components.newCreate"]').click();
    await expect(page.getByTestId('lc-notice')).toContainText('Waiting for your approval: Creates OrderFaq in feature orders, based on the library Disclosure.', { timeout: 60_000 });
    expect(fs.existsSync(path.join(base, 'features/orders/components/OrderFaq.tsx'))).toBe(false);
    await approve(page);
    expect(fs.readFileSync(path.join(base, 'features/orders/components/OrderFaq.tsx'), 'utf8').split('\n')[0]).toBe('// @line-base components/Disclosure');
    await expect(page.getByRole('button', { name: 'Open in the editor: OrderFaq' })).toBeVisible({ timeout: 60_000 });
    await axeClean(page);
  });
});
