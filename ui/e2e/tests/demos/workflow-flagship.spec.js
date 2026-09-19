import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(__dirname, '../../screenshots/demos');
fs.mkdirSync(SHOTS, { recursive: true });
const REPO = path.resolve(__dirname, '../../../..');
const CLI = path.join(REPO, 'bin/construct.mjs');
const DESCRIPTOR = path.join(REPO, 'docs/demos/workflow-flagship/refund.json');
const API_BASE = process.env.E2E_API_BASE || 'http://localhost:4000';

function cli(args) {
  const out = execFileSync('node', [CLI, ...args], { encoding: 'utf8' });
  console.log(`\n$ construct ${args.join(' ')}\n${out}`);
  return out;
}

// Flagship demo (guide "Workflows as machines, in plain English"). The refund
// flow is generated from a JSON descriptor by the real CLI, then everything on
// the Workflows screen is derived from that one source file. Screenshots are
// kept to the moments that matter.
test.describe.serial('Flagship demo: refund flow on the Workflows screen', () => {
  test.use({ viewport: { width: 1500, height: 1250 } });
  let projectDir;
  let file;

  test.beforeAll(async ({ request }) => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-flagship-'));
    cli(['init', projectDir]);
    cli(['create', 'workflow', 'refund', '--feature', 'refunds', '--from', DESCRIPTOR, '--dir', projectDir]);
    file = path.join(projectDir, 'features/refunds/workflows/RefundWorkflow.tsx');
    const res = await request.post(`${API_BASE}/api/settings`, { data: { projectDir } });
    expect(res.ok()).toBeTruthy();
  });

  test.afterAll(async ({ request }) => {
    await request.post(`${API_BASE}/api/settings`, { data: { projectDir: REPO } });
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  async function open(page) {
    await page.goto('/workflows');
    await page.getByRole('combobox').first().selectOption('refunds');
    await page.getByRole('button', { name: 'RefundWorkflow.tsx' }).click();
    await expect(page.getByTestId('wf-state-requested')).toBeVisible();
  }

  test('diagram, plain English and scenarios all come from the one generated file', async ({ page }) => {
    await open(page);
    // Story 2: the diagram shows every state of the descriptor.
    for (const s of ['requested', 'reviewing', 'escalated', 'paying', 'refunded', 'rejected']) {
      await expect(page.getByTestId(`wf-state-${s}`)).toBeVisible();
    }
    await page.getByTestId('wf-machine').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SHOTS, 'flagship-1-diagram-and-english.png'), fullPage: true });

    // Story 4: the English.
    await expect(page.getByTestId('wf-narrative-summary')).toContainText('The "refund request" flow has 6 steps.');
    const english = page.getByTestId('wf-narrative-english');
    await expect(english).toContainText('When "approve" happens, the flow moves to paying — only if it is within limit.');
    await expect(english).toContainText('loops back to paying');

    // Story 5: every path as a scenario.
    await expect(page.getByTestId('wf-narrative-scenarios').locator('[data-testid^="wf-scenario-"]')).toHaveCount(6);
    await expect(page.getByTestId('wf-scenario-1')).toContainText('requested → reviewing → paying → refunded');
    await page.getByTestId('wf-narrative-scenarios').scrollIntoViewIfNeeded();
    await page.getByTestId('wf-narrative-scenarios').screenshot({ path: path.join(SHOTS, 'flagship-2-scenarios.png') });

    // Story 6: a healthy flow reports no problems.
    await expect(page.getByTestId('wf-health-ok')).toBeVisible();
  });

  test('a visual edit changes the source by a few lines, and the English and Health follow', async ({ page }) => {
    await open(page);
    const before = fs.readFileSync(file, 'utf8');
    // #248: editing is the Edit tab of the Tools panel; the English is the Narrative tab.
    await page.getByRole('tab', { name: 'Edit' }).click();
    await page.getByLabel('New state name').fill('onHold');
    await page.getByRole('button', { name: 'Add state' }).click();
    const diff = page.getByTestId('wf-diff-preview');
    await expect(diff).toContainText('onHold: {}');
    expect(fs.readFileSync(file, 'utf8')).toBe(before); // nothing written until confirmed
    await diff.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SHOTS, 'flagship-3-edit-diff-preview.png') });
    await diff.getByRole('button', { name: 'Confirm save' }).click();
    await expect(page.getByTestId('wf-state-onHold')).toBeVisible();
    await page.getByRole('tab', { name: 'Narrative' }).click();

    // The real source diff (unified, as a code reviewer would see it).
    const beforeFile = path.join(projectDir, 'before.tsx');
    fs.writeFileSync(beforeFile, before);
    let udiff = '';
    try { execFileSync('diff', ['-u', beforeFile, file], { encoding: 'utf8' }); } catch (e) { udiff = e.stdout; }
    const changed = udiff.split('\n').filter((l) => /^[+-][^+-]/.test(l));
    console.log(`\nSOURCE DIFF (${changed.length} changed line(s) in a ${before.split('\n').length}-line file):\n${udiff}`);

    // The English and Health followed the edit.
    await expect(page.getByTestId('wf-narrative-state-onHold')).toContainText('There is no way out of on hold');
    await expect(page.getByTestId('wf-finding-unreachable')).toContainText('on hold can never be reached');
    await expect(page.getByTestId('wf-finding-dead-end')).toContainText('on hold is a dead end');
    await page.getByTestId('wf-narrative-scenarios').scrollIntoViewIfNeeded();
    await page.getByTestId('wf-narrative').screenshot({ path: path.join(SHOTS, 'flagship-4-health-after-edit.png') });
  });
});
