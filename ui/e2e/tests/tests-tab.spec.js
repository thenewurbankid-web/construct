import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gotoCockpit } from './support/cockpit.js';
import { runAxe, isBlocking, format } from './support/axe.js';

// #300 (the Tests tab and scenario coverage) and #301 (the lock, and clone-to-edit), end to end in a real browser.
// Nothing is mocked: the specs are written by the REAL generator (`construct generate tests`) from the real
// refund-request workflow, the coverage rows come from the scenario enumerator, and a clone is a real file on disk.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const BIN = path.join(REPO, 'bin', 'construct.mjs');
const SHOTS = path.resolve(__dirname, '../screenshots/tests-tab');
fs.mkdirSync(SHOTS, { recursive: true });
const API = process.env.E2E_API_BASE || 'http://localhost:4000';
const LOCK = 'frozen:\n  - features/*/tests/generated/**\nnonLayer:\n  - features/*/tests/**\n';
const BASE = 'version: 1\npreset: strict-nextjs\nproject:\n  framework: nextjs\nfeatures:\n  root: features\n';
const LAYERS = ['controllers', 'workflows', 'hooks', 'domain', 'services', 'pages', 'components'];

/** A throwaway project whose `refunds` feature carries the real refund-request workflow. */
function makeProject({ lock }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og300-tests-'));
  fs.writeFileSync(path.join(dir, 'architecture.yml'), BASE + (lock ? LOCK : ''));
  for (const l of LAYERS) fs.mkdirSync(path.join(dir, 'features', 'refunds', l), { recursive: true });
  fs.writeFileSync(path.join(dir, 'features', 'refunds', 'types.ts'), 'export type Id = string;\n');
  fs.writeFileSync(path.join(dir, 'features', 'refunds', 'index.ts'), "export type * from './types';\n");
  fs.copyFileSync(path.join(REPO, 'fixtures/workflow-graphs/refund-request.ts'), path.join(dir, 'features', 'refunds', 'workflows', 'RefundRequest.ts'));
  return dir;
}
const generate = (dir, ...extra) => execFileSync('node', [BIN, 'generate', 'tests', 'refunds', '--dir', dir, ...extra], { encoding: 'utf8' });

test.describe.serial('Tests tab: coverage, the lock and clone-to-edit (#300, #301)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  let dir;
  let originalDir;
  let gen;
  let tests;
  const cloneName = 'Refund over 50 goes to manual review';

  test.beforeAll(async ({ request }) => {
    originalDir = (await (await request.get(`${API}/api/settings`)).json()).projectDir;
    dir = makeProject({ lock: true });
    generate(dir);
    gen = path.join(dir, 'features', 'refunds', 'tests', 'generated');
    tests = path.join(dir, 'features', 'refunds', 'tests');
    // two scenarios have no test yet: two non-happy files, removed, so Generate has something real to do
    for (const f of fs.readdirSync(gen).sort().filter((n) => !/happy-path/.test(n)).slice(-2)) fs.unlinkSync(path.join(gen, f));
    await request.post(`${API}/api/settings`, { data: { projectDir: dir } });
  });

  test.afterAll(async ({ request }) => {
    await request.post(`${API}/api/settings`, { data: { projectDir: originalDir } });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('the Tests tab lists Generated (Locked) and Yours, and the table covers every scenario', async ({ page }) => {
    await gotoCockpit(page, '/tests');
    await expect(page.getByRole('tab', { name: /^Tests/ })).toBeVisible();
    const rows = page.getByTestId('coverage-row');
    await expect(rows).toHaveCount(9);
    await expect(page.getByTestId('chip-locked')).toHaveCount(7);
    await expect(page.getByTestId('chip-none')).toHaveCount(2);
    await expect(page.getByTestId('coverage-generate')).toHaveCount(2);
    await expect(page.getByTestId('tree-generated')).toHaveCount(7);
    await expect(page.getByTestId('tree-yours')).toHaveCount(0);
    await expect(page.getByTestId('coverage-summary')).toContainText('9 scenarios · 7 with a generated test · 0 of your own');
    // the lock is a word, not only a colour
    await expect(page.getByRole('list', { name: 'Generated tests, locked' })).toBeVisible();
    await expect(rows.first()).toContainText('Happy path');
    await expect(rows.first()).toContainText('Locked');
    await page.screenshot({ path: path.join(SHOTS, '300-tests-tab-coverage--dark.png') });
    expect((await runAxe(page)).filter(isBlocking), format(await runAxe(page))).toEqual([]);
  });

  test('trying to edit a locked test opens the clone dialog, not an error', async ({ page }) => {
    await gotoCockpit(page, '/tests');
    await page.getByRole('button', { name: 'Open the test for Happy path' }).click();
    const detail = page.getByTestId('test-detail');
    await expect(detail.getByTestId('detail-lock')).toHaveText('Locked');
    await expect(detail.getByTestId('detail-readonly-footer')).toContainText('Read-only');
    await expect(detail.getByTestId('detail-path')).toContainText('features/refunds/tests/generated/');
    const edit = page.getByRole('button', { name: 'Edit step 2' });
    await edit.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('clone-reason')).toContainText('You tried to change step 2');
    await expect(dialog).toContainText('cannot be edited');
    await expect(dialog.getByTestId('clone-path')).toContainText('features/refunds/tests/happy-path-copy.spec.ts');
    await expect(dialog.getByTestId('clone-gets')).toContainText('Happy path');
    await page.screenshot({ path: path.join(SHOTS, '301-clone-dialog--dark.png') });
    expect((await runAxe(page, { include: '[role="dialog"]' })).filter(isBlocking)).toEqual([]);

    // keyboard: focus starts in the dialog, Tab is trapped inside it, Esc closes and focus returns to the trigger
    await expect(dialog.getByTestId('clone-name')).toBeFocused();
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(edit).toBeFocused();
    // nothing was written
    expect(fs.existsSync(path.join(tests, 'happy-path-copy.spec.ts'))).toBe(false);
  });

  test('"Just show me the code" shows the read-only source; the code is never a prerequisite', async ({ page }) => {
    await gotoCockpit(page, '/tests');
    await page.getByRole('button', { name: 'Open the test for Happy path' }).click();
    await page.getByRole('button', { name: 'Clone to edit' }).click();
    await page.getByTestId('clone-show-code').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId('detail-code')).toContainText('@construct-generated');
    await expect(page.getByTestId('detail-code')).toContainText('expectFlowState');
    expect(fs.readdirSync(tests).filter((f) => f.endsWith('.spec.ts'))).toEqual([]);
  });

  test('cloning writes a writable copy one level up, keeps its lineage, and leaves the generated file alone', async ({ page }) => {
    const happy = fs.readdirSync(gen).sort().find((f) => /happy-path/.test(f));
    const before = fs.readFileSync(path.join(gen, happy), 'utf8');
    await gotoCockpit(page, '/tests');
    await page.getByRole('button', { name: 'Open the test for Happy path' }).click();
    await page.getByRole('button', { name: 'Clone to edit' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByTestId('clone-name').fill(cloneName);
    await expect(dialog.getByTestId('clone-path')).toHaveText('features/refunds/tests/refund-over-50-goes-to-manual-review.spec.ts');
    await dialog.getByTestId('clone-create').click();

    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId('tests-notice')).toContainText('features/refunds/tests/refund-over-50-goes-to-manual-review.spec.ts');
    await expect(page.getByTestId('tree-yours')).toHaveCount(1);
    await expect(page.getByTestId('tree-yours')).toContainText('refund-over-50-goes-to-manual-review');
    await expect(page.getByTestId('detail-yours')).toHaveText('Clone');
    await expect(page.getByTestId('chip-cloned')).toHaveCount(1);
    await expect(page.getByTestId('detail-notice')).toHaveCount(0);

    const clonePath = path.join(tests, 'refund-over-50-goes-to-manual-review.spec.ts');
    const out = fs.readFileSync(clonePath, 'utf8');
    expect(out.startsWith('// @construct-clone v1')).toBe(true);
    expect(out).toContain(`// cloned from: features/refunds/tests/generated/${happy}`);
    expect(out.endsWith(`\n${before}`)).toBe(true); // header lines, then the source byte for byte
    expect(out).toMatch(/\/\/ machine-hash: sha256:[0-9a-f]{64}/); // lineage survives
    expect(fs.readFileSync(path.join(gen, happy), 'utf8')).toBe(before);
    expect(fs.existsSync(path.join(gen, 'refund-over-50-goes-to-manual-review.spec.ts'))).toBe(false);
    await page.screenshot({ path: path.join(SHOTS, '301-clone-under-yours--dark.png') });
  });

  test('a taken name is refused and the dialog suggests a free one; nothing is overwritten', async ({ page }) => {
    const clonePath = path.join(tests, 'refund-over-50-goes-to-manual-review.spec.ts');
    const first = fs.readFileSync(clonePath, 'utf8');
    await gotoCockpit(page, '/tests');
    await page.getByRole('button', { name: 'Open the test for Happy path' }).click();
    await page.getByRole('button', { name: 'Clone to edit' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByTestId('clone-name').fill(cloneName);
    await dialog.getByTestId('clone-create').click();
    await expect(dialog.getByTestId('clone-error')).toContainText('already exists');
    await expect(dialog.getByTestId('clone-name')).toHaveValue('refund-over-50-goes-to-manual-review-2');
    expect(fs.readFileSync(clonePath, 'utf8')).toBe(first);
    await dialog.getByTestId('clone-cancel').click();
    await expect(dialog).toHaveCount(0);
  });

  test('an uncovered scenario offers Generate; the clone survives regeneration', async ({ page }) => {
    const clonePath = path.join(tests, 'refund-over-50-goes-to-manual-review.spec.ts');
    const mine = fs.readFileSync(clonePath, 'utf8');
    await gotoCockpit(page, '/tests');
    await expect(page.getByTestId('coverage-generate')).toHaveCount(2);
    await page.getByTestId('coverage-generate').first().click();
    await expect(page.getByTestId('generate-done')).toContainText('Generated 2 tests');
    await expect(page.getByTestId('chip-locked')).toHaveCount(9);
    await expect(page.getByTestId('chip-none')).toHaveCount(0);
    expect(fs.readdirSync(gen).filter((f) => f.endsWith('.spec.ts'))).toHaveLength(9);
    // regenerate (as the flow changing would) and prune: the clone is theirs, so it is never touched
    generate(dir, '--prune');
    expect(fs.readFileSync(clonePath, 'utf8')).toBe(mine);
    await page.reload();
    await expect(page.getByTestId('tree-yours')).toHaveCount(1);
    await expect(page.getByTestId('coverage-summary')).toContainText('9 scenarios · 9 with a generated test · 1 of your own');
    await page.screenshot({ path: path.join(SHOTS, '300-tests-tab-after-generate--dark.png') });
  });

  test('light theme', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('construct.theme', 'light'));
    await gotoCockpit(page, '/tests');
    await page.getByRole('button', { name: 'Open the test for Happy path' }).click();
    await page.getByRole('button', { name: 'Edit step 3' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, '301-clone-dialog--light.png') });
    expect((await runAxe(page, { include: '[role="dialog"]' })).filter(isBlocking)).toEqual([]);
  });
});

test.describe.serial('Generate refuses, plainly, when the lock is not declared (#300)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  let dir;
  let originalDir;

  test.beforeAll(async ({ request }) => {
    originalDir = (await (await request.get(`${API}/api/settings`)).json()).projectDir;
    dir = makeProject({ lock: false });
    await request.post(`${API}/api/settings`, { data: { projectDir: dir } });
  });

  test.afterAll(async ({ request }) => {
    await request.post(`${API}/api/settings`, { data: { projectDir: originalDir } });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('the generator message with the YAML is shown as it is, and nothing is written', async ({ page }) => {
    await gotoCockpit(page, '/tests');
    await expect(page.getByTestId('lock-missing')).toContainText('not locked');
    await expect(page.getByTestId('chip-none')).toHaveCount(9);
    await page.getByTestId('coverage-generate').first().click();
    const refused = page.getByTestId('generate-refused');
    await expect(refused).toContainText('Refusing to generate tests');
    await expect(refused).toContainText('features/*/tests/generated/**');
    await expect(refused).toContainText('nonLayer:');
    expect(fs.existsSync(path.join(dir, 'features', 'refunds', 'tests'))).toBe(false);
    await page.screenshot({ path: path.join(SHOTS, '300-generate-refused--dark.png') });
  });
});
