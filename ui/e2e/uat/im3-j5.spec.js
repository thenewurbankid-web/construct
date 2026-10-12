import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gotoCockpit } from '../tests/support/cockpit.js';
import { openProject } from '../tests/support/browseProject.js';
import { runAxe, isBlocking, format } from '../tests/support/axe.js';

// Pre-UAT walk of docs/line/review.md "im3 + j5" (memory of past answers per step), in a real browser on the real server
// (playwright.line-memory.config.js sets LINE_DRAFTER=1). On a copy of examples/line-sample (import-samples'
// contact-manager-ui is not a Line project, so the drafter cannot open it): pick the same drafted route 3 times, the 4th
// draft recommends it first and says why; Settings shows the step's memory; Forget clears it and the static order is back.
// Fails on any console error or 4xx/5xx answer.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = path.resolve(__dirname, '../../../examples/line-sample');
const API = process.env.E2E_API_BASE || 'http://localhost:4000';
const REQUEST = 'use OrderButton in billing';

test('UAT im3-j5: three picks of the same route make it the recommended one, saying why; Forget clears it', async ({ page }) => {
  test.setTimeout(180_000);
  const base = fs.realpathSync(fs.mkdtempSync(path.join(process.env.E2E_WORKSPACE_ROOT ?? os.tmpdir(), 'line-memory-')));
  fs.cpSync(SAMPLE, base, { recursive: true });
  const restore = await openProject(API, base);
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()} (${m.location()?.url})`); });
  page.on('response', (r) => { if (r.status() >= 400) problems.push(`${r.status()} ${r.url()}`); });
  const draft = async () => {
    const box = page.getByTestId('line-draft');
    await box.getByLabel('What do you want to change?').fill(REQUEST);
    await box.getByLabel('What do you want to change?').press('Enter');
    await expect(box.getByTestId('draft-route').first()).toBeVisible({ timeout: 30_000 });
    return box;
  };
  try {
    await gotoCockpit(page, '/components');
    await expect(page.getByTestId('line-draft').getByRole('heading', { name: /Describe a change/ })).toBeVisible({ timeout: 30_000 });

    // 1. The static order: via the library first, no memory line.
    let box = await draft();
    const first = box.getByTestId('draft-route').first();
    const staticId = await first.getAttribute('data-route');
    expect(staticId).toMatch(/^via-library:/);
    await expect(box.getByTestId('draft-route-memory')).toHaveCount(0);
    const other = box.locator('[data-testid="draft-route"][data-status="ok"]:not([data-recommended="true"])').first();
    const otherId = await other.getAttribute('data-route');
    expect(otherId).toMatch(/^base-on:/);

    // 2. Pick the other route three times (Add to plan, one click each), drafting again each time.
    for (let i = 0; i < 3; i++) {
      box = await draft();
      const card = box.locator(`[data-testid="draft-route"][data-route="${otherId}"]`);
      await card.getByRole('button', { name: /^Add to plan/ }).click();
      await expect(page.getByTestId('line-plan').getByTestId('plan-step')).toHaveCount(i + 1, { timeout: 30_000 });
    }

    // 3. The 4th draft recommends it first and says why.
    box = await draft();
    const top = box.getByTestId('draft-route').first();
    await expect(top).toHaveAttribute('data-route', otherId, { timeout: 30_000 });
    await expect(top).toHaveAttribute('data-recommended', 'true');
    await expect(top.getByTestId('draft-route-memory')).toHaveText(/^Recalled from 3 past decisions: the last 3 times you picked a new item based on the library\.$/);
    const memFile = path.join(base, 'line/memory/drafter.route.jsonl');
    const text = fs.readFileSync(memFile, 'utf8');
    expect(text.trim().split('\n')).toHaveLength(3);
    for (const w of ['OrderButton', 'billing', 'orders']) expect(text).not.toContain(w);

    // 4. Settings: the step's memory size, then Forget (one click).
    await gotoCockpit(page, '/settings');
    const mem = page.getByTestId('ai-memory');
    const step = mem.locator('[data-testid="memory-step"][data-step="drafter.route"]');
    await expect(step.getByTestId('memory-size')).toHaveText('3 remembered decisions', { timeout: 30_000 });
    const axe = await runAxe(page, { include: '[data-testid="ai-memory"]' });
    expect(axe.filter(isBlocking), format(axe.filter(isBlocking))).toEqual([]);
    await step.getByRole('button', { name: /^Forget this step's memory/ }).click();
    await expect(mem.getByTestId('memory-message')).toHaveText('Line forgot 3 remembered decisions for this step.');
    await expect(step.getByTestId('memory-size')).toHaveText('0 remembered decisions');
    await expect(step.getByRole('button', { name: /^Forget/ })).toHaveCount(0);

    // 5. Back to the static order.
    await gotoCockpit(page, '/components');
    box = await draft();
    await expect(box.getByTestId('draft-route').first()).toHaveAttribute('data-route', staticId ?? '', { timeout: 30_000 });
    await expect(box.getByTestId('draft-route-memory')).toHaveCount(0);
    expect(problems, problems.join('\n')).toEqual([]);
  } finally {
    await restore?.();
    fs.rmSync(base, { recursive: true, force: true });
  }
});
