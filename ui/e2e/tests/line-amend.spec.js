import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gotoCockpit } from './support/cockpit.js';
import { openProject } from './support/browseProject.js';
import { runAxe, isBlocking, format } from './support/axe.js';

// Experiment fixes 1 and 2, walked as the owner's UAT (docs/line/review.md "Experiment fixes"): an agent asks, through
// the plan API, to move OrderButton to a root-level components/ folder. Construct refuses it now (LINE-LAYOUT: outside
// library/ and features/), and its recommended fix names components/OrderButton.tsx, a file only the refused change
// creates; so the fix is one step that carries the move and the fix together. One Approve lands both; the finding is
// gone and the refused step counts as done.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = path.resolve(__dirname, '../../../examples/line-sample');
const API = process.env.E2E_API_BASE || 'http://localhost:4000';
const exists = (base, rel) => fs.existsSync(path.join(base, rel));

test.describe.serial('Line: a fix for a refused change applies in one approval (Line sample project)', () => {
  let base;
  let restore;

  test.beforeAll(async () => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'line-sample-')));
    fs.cpSync(SAMPLE, base, { recursive: true });
    restore = await openProject(API, base);
  });
  test.afterAll(async () => {
    await restore?.();
    if (base) fs.rmSync(base, { recursive: true, force: true });
  });

  test('moving OrderButton to components/ needs a fix; Apply recommended fix + one Approve lands it inside billing', async ({ page, request }) => {
    // The agent's step, through the plan API (the only way agents change a project).
    const added = await request.post(`${API}/api/line/plan/step`, { data: { tool: 'line.moveFile', args: { from: 'features/orders/components/OrderButton.tsx', to: 'components/OrderButton.tsx' } } });
    expect(added.ok()).toBe(true);

    await gotoCockpit(page, '/components');
    const plan = page.getByTestId('line-plan');
    const first = plan.locator('[data-testid="plan-step"]').last();
    await expect(first).toHaveAttribute('data-state', 'waiting', { timeout: 30_000 });
    await expect(first.getByTestId('plan-step-sentence')).toHaveText('Waiting for your approval: Moves OrderButton.tsx to components/ and points its one user at the new place.');
    await first.getByRole('button', { name: 'Approve step 1' }).click();

    await expect(first).toHaveAttribute('data-state', 'needs-fix');
    await expect(first.getByTestId('plan-step-failing')).toContainText('Validate found a new problem: the source file "components/OrderButton.tsx" is outside library/ and features/, so Line cannot check or reuse it; move it into the library or into the feature that uses it.');
    await expect(first.getByTestId('plan-step-fixes')).toContainText("Move OrderButton.tsx into feature billing's components/ folder, the only feature that uses it, together with the change Construct refused, in one step.");
    expect(exists(base, 'components/OrderButton.tsx')).toBe(false);

    const found = await runAxe(page, { include: '[data-testid="line-plan"]' });
    expect(found.filter(isBlocking), format(found.filter(isBlocking))).toEqual([]);

    await first.getByRole('button', { name: 'Apply recommended fix' }).click();
    const fix = plan.locator('[data-testid="plan-step"]').first();
    await expect(fix).toHaveAttribute('data-state', 'waiting');
    await expect(fix.getByTestId('plan-step-sentence')).toHaveText('Waiting for your approval: Moves OrderButton.tsx to components/ and points its one user at the new place, and in the same step moves OrderButton.tsx to features/billing/components/ and points its one user at the new place.');
    await fix.getByText('Details', { exact: true }).click();
    await expect(fix.getByTestId('plan-step-call')).toContainText('line.amend(');

    await fix.getByRole('button', { name: 'Approve step 2' }).click();
    await expect(fix).toHaveAttribute('data-state', 'done');
    await expect(plan.locator('[data-testid="plan-step"]').last().getByTestId('plan-step-sentence')).toHaveText('Saved together with its fix in step 2.');
    await expect(plan.locator('[data-testid="plan-step"][data-state="needs-fix"]')).toHaveCount(0);

    expect(exists(base, 'features/billing/components/OrderButton.tsx')).toBe(true);
    expect(exists(base, 'components/OrderButton.tsx')).toBe(false);
    expect(exists(base, 'features/orders/components/OrderButton.tsx')).toBe(false);
    // The planted LINE-DIR (billing used orders' button) is gone too; only the planted LINE-BASE is left.
    const project = await (await request.get(`${API}/api/line/project`)).json();
    expect(project.findings.map((f) => `${f.rule} ${f.file}`)).toEqual(['LINE-BASE features/billing/components/InvoiceCard.tsx']);
  });
});
