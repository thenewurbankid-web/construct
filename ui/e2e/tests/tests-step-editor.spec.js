import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gotoCockpit } from './support/cockpit.js';
import { runAxe, isBlocking, format } from './support/axe.js';

// #302 -- editing a cloned test as a STRUCTURED STEP DOCUMENT, end to end in a real browser. Nothing is mocked:
// the specs are written by the REAL generator from the real refund-request workflow, the clone is made through
// the UI, every edit is previewed as a diff and only written on confirm, the file on disk is checked against the
// diff, the locked original is checked byte for byte, and a file that does not round-trip is shown read-only.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const BIN = path.join(REPO, 'bin', 'construct.mjs');
const SHOTS = path.resolve(__dirname, '../screenshots/tests-step-editor');
fs.mkdirSync(SHOTS, { recursive: true });
const API = process.env.E2E_API_BASE || 'http://localhost:4000';
const LOCK = 'frozen:\n  - features/*/tests/generated/**\nnonLayer:\n  - features/*/tests/**\n';
const BASE = 'version: 1\npreset: strict-nextjs\nproject:\n  framework: nextjs\nfeatures:\n  root: features\n';
const LAYERS = ['controllers', 'workflows', 'hooks', 'domain', 'services', 'pages', 'components'];

function makeProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og302-steps-'));
  fs.writeFileSync(path.join(dir, 'architecture.yml'), BASE + LOCK);
  for (const l of LAYERS) fs.mkdirSync(path.join(dir, 'features', 'refunds', l), { recursive: true });
  fs.writeFileSync(path.join(dir, 'features', 'refunds', 'types.ts'), 'export type Id = string;\n');
  fs.writeFileSync(path.join(dir, 'features', 'refunds', 'index.ts'), "export type * from './types';\n");
  fs.copyFileSync(path.join(REPO, 'fixtures/workflow-graphs/refund-request.ts'), path.join(dir, 'features', 'refunds', 'workflows', 'RefundRequest.ts'));
  return dir;
}

test.describe.serial('Step document: edit a cloned test without code, review the diff, confirm (#302)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  let dir;
  let originalDir;
  let gen;
  let tests;
  let happy;
  let genBefore;
  let before;
  const file = () => path.join(tests, 'refund-steps.spec.ts');

  test.beforeAll(async ({ request }) => {
    originalDir = (await (await request.get(`${API}/api/settings`)).json()).projectDir;
    dir = makeProject();
    execFileSync('node', [BIN, 'generate', 'tests', 'refunds', '--dir', dir], { encoding: 'utf8' });
    gen = path.join(dir, 'features', 'refunds', 'tests', 'generated');
    tests = path.join(dir, 'features', 'refunds', 'tests');
    happy = fs.readdirSync(gen).sort().find((f) => /happy-path/.test(f));
    genBefore = fs.readFileSync(path.join(gen, happy), 'utf8');
    await request.post(`${API}/api/settings`, { data: { projectDir: dir } });
  });

  test.afterAll(async ({ request }) => {
    await request.post(`${API}/api/settings`, { data: { projectDir: originalDir } });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const openEditor = async (page) => {
    await gotoCockpit(page, '/tests');
    await page.getByTestId('tree-yours').filter({ hasText: 'refund-steps' }).click();
    await page.getByTestId('detail-edit-steps').click();
    await expect(page.getByTestId('step-editor')).toBeVisible();
  };

  test('clone a generated test, open it as steps: GIVEN / AND / WHEN / THEN rows, each with the selector it binds to', async ({ page }) => {
    await gotoCockpit(page, '/tests');
    await page.getByRole('button', { name: 'Open the test for Happy path' }).click();
    await page.getByRole('button', { name: 'Clone to edit' }).click();
    await page.getByRole('dialog').getByTestId('clone-name').fill('refund steps');
    await page.getByRole('dialog').getByTestId('clone-create').click();
    await expect(page.getByTestId('tree-yours')).toHaveCount(1);
    before = fs.readFileSync(file(), 'utf8');

    await page.getByTestId('detail-edit-steps').click();
    await expect(page.getByTestId('editor-title')).toContainText('Happy path');
    const rows = page.getByTestId('step-row');
    expect(await rows.count()).toBeGreaterThanOrEqual(5);
    // no route reaches the feature, so the generator left a "needs" note before the page is opened
    await expect(rows.first()).toHaveAttribute('data-keyword', 'NEEDS');
    const keywords = await rows.evaluateAll((els) => els.map((e) => e.getAttribute('data-keyword')));
    expect(keywords).toEqual(expect.arrayContaining(['GIVEN', 'AND', 'WHEN', 'THEN']));
    await expect(page.getByTestId('step-binding').filter({ hasText: '[data-testid="request-refund"]' })).toHaveCount(1);
    await expect(page.getByTestId('step-binding').filter({ hasText: '[data-flow-state=' }).first()).toBeVisible();
    await expect(page.getByTestId('editor-changes')).toHaveText('No unsaved changes');
    await expect(page.getByTestId('editor-review')).toBeDisabled();
    await page.screenshot({ path: path.join(SHOTS, '302-1-step-document--dark.png') });
  });

  test('edit with form fields only: set the page, add a check, move it, remove a step; nothing is written yet', async ({ page }) => {
    await openEditor(page);
    // the page to open (the "no route" note goes away when one is set)
    await page.locator('[data-keyword="GIVEN"] .ts-srow-btn').click();
    await page.getByTestId('field-url').fill('/refunds/new');
    // a check, added after the first event and moved up with the keyboard
    await page.locator('[data-keyword="WHEN"] .ts-srow-btn').first().click();
    await page.getByTestId('add-check').click();
    await page.getByTestId('field-text').fill('A reviewer will check this refund');
    await page.getByTestId('field-wait').selectOption('10000');
    await page.getByTestId('field-note').fill('added by QA');
    await expect(page.getByTestId('step-code')).toContainText('page.getByText("A reviewer will check this refund")');
    await page.getByTestId('step-up').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('editor-announce')).toContainText(/Moved to step \d+ of \d+/);
    // remove the last flow-state step: it stays, struck through and labelled, until saved
    const last = page.locator('[data-keyword="THEN"] .ts-srow-btn').last();
    await last.click();
    await page.getByTestId('step-remove').click();
    await expect(page.locator('[data-change="removed"]')).toHaveCount(1);
    await expect(page.locator('[data-change="removed"]')).toContainText('Removed by you');
    await expect(page.locator('[data-change="added"]')).toContainText('the page shows "A reviewer will check this refund"');
    await expect(page.locator('[data-change="changed"]')).toContainText('Open /refunds/new');
    await expect(page.getByTestId('editor-changes')).toContainText('unsaved changes');
    expect(fs.readFileSync(file(), 'utf8')).toBe(before); // no code was typed and nothing was written
    await page.locator('[data-keyword="CHECK"] .ts-srow-btn').click(); // show the panel for the check in the screenshot
    await expect(page.getByTestId('step-panel')).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, '302-2-editing--dark.png') });
    expect((await runAxe(page)).filter(isBlocking), format(await runAxe(page))).toEqual([]);
  });

  test('review shows the diff; confirming writes exactly it; the locked original is untouched; the result still round-trips', async ({ page, request }) => {
    await openEditor(page);
    await page.locator('[data-keyword="GIVEN"] .ts-srow-btn').click();
    await page.getByTestId('field-url').fill('/refunds/new');
    await page.locator('[data-keyword="WHEN"] .ts-srow-btn').first().click();
    await page.getByTestId('add-check').click();
    await page.getByTestId('field-text').fill('A reviewer will check this refund');
    await page.getByTestId('field-note').fill('added by QA');
    await page.locator('[data-keyword="THEN"] .ts-srow-btn').last().click();
    await page.getByTestId('step-remove').click();

    await page.getByTestId('editor-review').click();
    const diff = page.getByTestId('review-diff');
    await expect(diff).toBeVisible();
    expect(fs.readFileSync(file(), 'utf8')).toBe(before); // a review writes nothing
    const added = await diff.locator('[data-kind="added"] .ts-diff-text').allTextContents();
    const removed = await diff.locator('[data-kind="removed"] .ts-diff-text').allTextContents();
    expect(added.join('\n')).toContain('getByText("A reviewer will check this refund")');
    expect(added.join('\n')).toContain('const START_URL: string | null = "/refunds/new";');
    expect(removed.join('\n')).toContain('TODO(construct)');
    await page.getByTestId('step-review').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SHOTS, '302-3-diff-review--dark.png') });

    await page.getByTestId('review-confirm').click();
    await expect(page.getByTestId('editor-notice')).toContainText('exactly what you reviewed');
    const after = fs.readFileSync(file(), 'utf8');
    expect(after).not.toBe(before);
    // the file is exactly the diff: every added line is there, every removed line is gone
    for (const line of added) expect(after.split('\n')).toContain(line);
    for (const line of removed.filter((l) => l.includes('TODO(construct)') || l.includes('START_URL: string | null = null'))) expect(after.split('\n')).not.toContain(line);
    expect(after.startsWith('// @construct-clone v1')).toBe(true);
    expect(after).toMatch(/\/\/ machine-hash: sha256:[0-9a-f]{64}/); // the lineage header survives
    expect(fs.readFileSync(path.join(gen, happy), 'utf8')).toBe(genBefore); // the locked original is untouched
    const reopened = await (await request.get(`${API}/api/tests/refunds/steps?name=refund-steps.spec.ts`)).json();
    expect(reopened.editable).toBe(true); // it still round-trips
    await expect(page.getByTestId('editor-changes')).toHaveText('No unsaved changes');
    await expect(page.locator('[data-keyword="CHECK"]')).toContainText('A reviewer will check this refund');
    await page.screenshot({ path: path.join(SHOTS, '302-4-saved--dark.png') });
  });

  test('a file that does not round-trip is shown read-only with the reason, and is never touched', async ({ page }) => {
    const odd = fs.readFileSync(file(), 'utf8').replace('  await page.goto(START_URL);', '  await page.goto(START_URL);\n  await page.waitForTimeout(500);');
    fs.writeFileSync(path.join(tests, 'hand-written.spec.ts'), odd);
    await gotoCockpit(page, '/tests');
    await page.getByTestId('tree-yours').filter({ hasText: 'hand-written' }).click();
    await page.getByTestId('detail-edit-steps').click();
    await expect(page.getByTestId('editor-readonly')).toBeVisible();
    await expect(page.getByTestId('editor-readonly-reason')).toContainText(/line \d+/);
    await expect(page.getByTestId('step-row')).toHaveCount(0);
    await expect(page.getByTestId('editor-review')).toHaveCount(0);
    expect(fs.readFileSync(path.join(tests, 'hand-written.spec.ts'), 'utf8')).toBe(odd);
    await page.screenshot({ path: path.join(SHOTS, '302-5-read-only--dark.png') });
    expect((await runAxe(page)).filter(isBlocking), format(await runAxe(page))).toEqual([]);
  });

  test('a test edited elsewhere while you review is refused as stale and nothing is written', async ({ page }) => {
    await openEditor(page);
    await page.locator('[data-keyword="WHEN"] .ts-srow-btn').first().click();
    await page.getByTestId('add-check').click();
    await page.getByTestId('field-text').fill('Second check');
    await page.getByTestId('editor-review').click();
    await expect(page.getByTestId('review-confirm')).toBeVisible();
    const elsewhere = `${fs.readFileSync(file(), 'utf8')}// edited elsewhere\n`;
    fs.writeFileSync(file(), elsewhere);
    await page.getByTestId('review-confirm').click();
    await expect(page.getByTestId('review-error')).toContainText('changed');
    expect(fs.readFileSync(file(), 'utf8')).toBe(elsewhere);
    await page.screenshot({ path: path.join(SHOTS, '302-6-stale--dark.png') });
  });

  test('light theme', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('construct.theme', 'light'));
    await page.goto('/tests');
    await page.getByTestId('tree-yours').filter({ hasText: 'refund-steps' }).click();
    await page.getByTestId('detail-edit-steps').click();
    await expect(page.getByTestId('step-editor')).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, '302-7-step-document--light.png') });
    expect((await runAxe(page)).filter(isBlocking), format(await runAxe(page))).toEqual([]);
  });
});
