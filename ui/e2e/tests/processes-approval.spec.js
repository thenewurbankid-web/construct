import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gotoCockpit } from './support/cockpit.js';

// #341 — approve or reject a process's artifacts in the Processes drawer, through the approval gate.
//
// Run with playwright.processes.config.js. `/__test/seed-review` (support/processes-server.mjs) leaves a
// FINISHED process whose bot branch holds three files: one to approve, one to reject, and one the plan
// never declared, which the gate refuses. Everything else is the product: the real routes, the real
// session gate, the real approval gate, real git. The assertions that matter are on the disk.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(__dirname, '../screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const API = process.env.E2E_API_BASE || 'http://localhost:4000';

const drawer = (page) => page.getByRole('region', { name: 'Drawer' });
const shot = (page, name) => drawer(page).screenshot({ path: path.join(SHOTS, `341-${name}.png`) });
const row = (page, file) => page.locator(`[data-testid="review-artifact"][data-path="${file}"]`);
const onDisk = (root, file) => fs.readFileSync(path.join(root, file), 'utf8');

test.describe.serial('Approve or reject artifacts (#341)', () => {
  let seed;

  test.beforeAll(async ({ request }) => {
    const res = await request.post(`${API}/__test/seed-review`, { data: { title: 'Update the notes' } });
    expect(res.ok()).toBeTruthy();
    seed = await res.json();
  });

  test.beforeEach(async ({ page, request }) => {
    const { projectDir } = await (await request.get(`${API}/api/settings`)).json();
    await page.addInitScript(([key]) => {
      localStorage.setItem(key, JSON.stringify({ left: { size: 200, open: true }, right: { size: 360, open: false }, drawer: { size: 520, open: false } }));
    }, [`construct.shell.layout:${projectDir}`]);
    await gotoCockpit(page, '/help');
    await page.getByTestId('pill-processes').click();
    await expect(drawer(page)).toBeVisible();
    await expect(page.getByTestId('process-detail')).toBeVisible();
  });

  test('the review shows each file\'s exact diff; a refused file shows the gate\'s reason and has no enabled Approve', async ({ page }) => {
    await page.getByTestId('process-review-open').click();
    const approve = row(page, `approve-${seed.n}.txt`);
    await expect(approve.getByTestId('review-diff')).toContainText('+gamma');
    await expect(approve.getByTestId('review-approve')).toBeEnabled();

    const sneaky = row(page, `sneaky-${seed.n}.txt`);
    await expect(sneaky.getByTestId('review-refusal')).toContainText('did not declare');
    await expect(sneaky.getByTestId('review-approve')).toBeDisabled();
    await expect(sneaky.getByTestId('review-refusal')).toHaveAttribute('role', 'alert');

    // No approve-all, anywhere.
    await expect(drawer(page).getByRole('button', { name: /all/i })).toHaveCount(0);
    await shot(page, 'review');
    await sneaky.scrollIntoViewIfNeeded();
    await sneaky.getByTestId('review-refusal').scrollIntoViewIfNeeded();
    await shot(page, 'refused');
  });

  test('approving one file lands exactly the reviewed bytes, records who decided, and reports the check', async ({ page }) => {
    await page.getByTestId('process-review-open').click();
    const file = `approve-${seed.n}.txt`;
    expect(onDisk(seed.root, file)).toBe('alpha\nbeta\n');
    await row(page, file).getByTestId('review-approve').click();
    await expect(row(page, file).getByTestId('review-verdict')).toContainText('Approved by local');
    expect(onDisk(seed.root, file)).toBe('alpha\nbeta\ngamma\n');
    await expect(page.getByTestId('review-validation')).toBeVisible();
    // The other files were not touched by that one decision.
    expect(onDisk(seed.root, `reject-${seed.n}.txt`)).toBe('one\ntwo\n');
    expect(fs.existsSync(path.join(seed.root, `sneaky-${seed.n}.txt`))).toBe(false);
    await expect(row(page, file).getByTestId('review-approve')).toHaveCount(0);
    await shot(page, 'approved');
  });

  test('rejecting one file writes nothing to the tree and records the verdict', async ({ page }) => {
    await page.getByTestId('process-review-open').click();
    const file = `reject-${seed.n}.txt`;
    await row(page, file).getByTestId('review-reject').click();
    await expect(row(page, file).getByTestId('review-verdict')).toContainText('Rejected by local');
    expect(onDisk(seed.root, file)).toBe('one\ntwo\n');
    await expect(row(page, file).getByTestId('review-approve')).toHaveCount(0);
    // The refused file is still refused after the others were decided.
    await expect(row(page, `sneaky-${seed.n}.txt`).getByTestId('review-approve')).toBeDisabled();
    expect(fs.existsSync(path.join(seed.root, `sneaky-${seed.n}.txt`))).toBe(false);
    await shot(page, 'decided');
  });
});
