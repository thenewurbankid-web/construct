import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gotoCockpit } from './support/cockpit.js';

// #839 (design 8's "Preview beside" in the step editor), end to end: a real cloned test, the toggle off by
// default, and the shared `@/features/live-preview` panel (#837) rendered beside the step document -- not a
// new/duplicated preview implementation. "Picking an element fills the step's target" is NOT covered here: the
// allowlisted step fields (packages/engine/testSteps.mjs) have no free-text target/selector to fill from a
// click (events are closed to the flow's own declared events, testId is server-derived) -- see the issue.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const BIN = path.join(REPO, 'packages', 'cli', 'construct.mjs');
const SHOTS = path.resolve(__dirname, '../screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const API = process.env.E2E_API_BASE || 'http://localhost:4000';
const LOCK = 'frozen:\n  - features/*/tests/generated/**\nnonLayer:\n  - features/*/tests/**\n';
const BASE = 'version: 1\npreset: strict-nextjs\nproject:\n  framework: nextjs\nfeatures:\n  root: features\n';
const LAYERS = ['controllers', 'workflows', 'hooks', 'domain', 'services', 'pages', 'components'];

function makeProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og839-preview-beside-'));
  fs.writeFileSync(path.join(dir, 'architecture.yml'), BASE + LOCK);
  for (const l of LAYERS) fs.mkdirSync(path.join(dir, 'features', 'refunds', l), { recursive: true });
  fs.writeFileSync(path.join(dir, 'features', 'refunds', 'types.ts'), 'export type Id = string;\n');
  fs.writeFileSync(path.join(dir, 'features', 'refunds', 'index.ts'), "export type * from './types';\n");
  fs.copyFileSync(path.join(REPO, 'fixtures/workflow-graphs/refund-request.ts'), path.join(dir, 'features', 'refunds', 'workflows', 'RefundRequest.ts'));
  return dir;
}

test.describe.serial('"Preview beside" in the step editor (#839)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  let dir;
  let originalDir;

  test.beforeAll(async ({ request }) => {
    originalDir = (await (await request.get(`${API}/api/settings`)).json()).projectDir;
    dir = makeProject();
    execFileSync('node', [BIN, 'generate', 'tests', 'refunds', '--dir', dir], { encoding: 'utf8' });
    await request.post(`${API}/api/settings`, { data: { projectDir: dir } });
  });

  test.afterAll(async ({ request }) => {
    await request.post(`${API}/api/settings`, { data: { projectDir: originalDir } });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('off by default; toggling it on shows the shared live-preview panel beside the step document, off again hides it', async ({ page }) => {
    await gotoCockpit(page, '/tests');
    await page.getByRole('button', { name: 'Open the test for Happy path' }).click();
    await page.getByRole('button', { name: 'Clone to edit' }).click();
    await page.getByRole('dialog').getByTestId('clone-name').fill('og839 steps');
    await page.getByRole('dialog').getByTestId('clone-create').click();
    await expect(page.getByTestId('tree-yours')).toHaveCount(1);
    await page.getByTestId('detail-edit-steps').click();
    await expect(page.getByTestId('step-editor')).toBeVisible();

    const toggle = page.getByTestId('ts-preview-toggle');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('ts-preview-beside')).toHaveCount(0);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    const beside = page.getByTestId('ts-preview-beside');
    await expect(beside).toBeVisible();
    await expect(beside.getByRole('heading')).toContainText('Live app preview');
    await expect(beside.locator('input[aria-label="Preview URL"]')).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, '839-preview-beside.png') });

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('ts-preview-beside')).toHaveCount(0);
  });
});
