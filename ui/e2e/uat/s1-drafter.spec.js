import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gotoCockpit } from '../tests/support/cockpit.js';
import { openProject } from '../tests/support/browseProject.js';

// Pre-UAT walk of docs/line/review.md "System 1 drafter" as a non-technical owner would do it, in a real browser on the
// real server (playwright.line-drafter.config.js sets LINE_DRAFTER=1). Fails on any console error or 4xx/5xx answer,
// on any sentence that is not plain English, and when getting the change into the plan takes more than two clicks.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = path.resolve(__dirname, '../../../examples/line-sample');
const API = process.env.E2E_API_BASE || 'http://localhost:4000';

test('UAT s1-drafter: describe a change, see the ways to do it, add the recommended one, approve it', async ({ page }) => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'line-sample-')));
  fs.cpSync(SAMPLE, base, { recursive: true });
  const restore = await openProject(API, base);
  const problems = [];
  // Every answer must be below 400 (/api/review/branches answers 200 for a project that is not a repository).
  const known = () => false;
  page.on('console', (m) => { if (m.type() === 'error' && !known(m.location()?.url)) problems.push(`console: ${m.text()} (${m.location()?.url})`); });
  page.on('response', (r) => { if (r.status() >= 400 && !known(r.url())) problems.push(`${r.status()} ${r.url()}`); });
  try {
    // 1. Open Cockpit on the Components screen of the sample.
    await gotoCockpit(page, '/components');
    const box = page.getByTestId('line-draft');
    await expect(box.getByRole('heading', { name: /Describe a change/ })).toBeVisible({ timeout: 30_000 });

    // 2. Type what you want and press Enter (no click): every way to do it, the recommended one first.
    let clicks = 0;
    await box.getByLabel('What do you want to change?').fill('add a badge to the orders feature');
    await box.getByLabel('What do you want to change?').press('Enter');
    const first = box.getByTestId('draft-route').first();
    await expect(first.getByTestId('draft-route-label')).toHaveText('Add a new component OrdersBadge to orders, based on the library Badge.', { timeout: 30_000 });
    for (const s of await box.locator('.ldr-label, .ldr-sentence, .ldr-risk, .ldr-note').allTextContents()) {
      expect(s, 'plain English: a full sentence, no slot or rule id on the surface').toMatch(/^[A-Z"].*[.?!]$/s);
      expect(s).not.toMatch(/<[A-Z]\d|LINE-[A-Z]+|line\.\w+\(/);
    }

    // 3. Add to plan (click 1), then Approve in the Plan panel (click 2): the file is written only now.
    await first.getByRole('button', { name: /^Add to plan/ }).click();
    clicks++;
    const step = page.getByTestId('line-plan').getByTestId('plan-step').first();
    await expect(step).toHaveAttribute('data-state', 'waiting');
    await step.getByRole('button', { name: /^Approve step/ }).click();
    clicks++;
    await expect(step).toHaveAttribute('data-state', 'done', { timeout: 30_000 });
    expect(fs.existsSync(path.join(base, 'features/orders/components/OrdersBadge.tsx'))).toBe(true);
    expect(clicks).toBeLessThanOrEqual(2);
    expect(problems, problems.join('\n')).toEqual([]);
  } finally {
    await restore?.();
    fs.rmSync(base, { recursive: true, force: true });
  }
});
