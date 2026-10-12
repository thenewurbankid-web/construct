import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gotoCockpit } from '../tests/support/cockpit.js';
import { openProject } from '../tests/support/browseProject.js';
import { startUnderTheHood } from '../tests/support/lineModes.js';

startUnderTheHood(test);

// Pre-UAT walk of docs/line/review.md "im1 + im2", as the owner does it, on the real server with the drafter on
// (playwright.im1-im2.config.js sets LINE_DRAFTER=1). On a copy of examples/line-sample: the import sample
// (~/Repositories/import-samples/contact-manager-ui) is not laid out as a Line project, so it has no cross-feature problem
// for the drafter to fix. Fails on any console error, any 4xx/5xx answer, and on English that is not a full sentence.
//   E2E_CLIENT_PORT=3398 E2E_SERVER_PORT=4398 npx playwright test -c playwright.im1-im2.config.js --workers=1
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = path.resolve(__dirname, '../../../examples/line-sample');
const API = process.env.E2E_API_BASE || 'http://localhost:4000';

let base;
let restore;
test.beforeAll(async () => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(process.env.E2E_WORKSPACE_ROOT ?? os.tmpdir(), 'line-sample-im1-')));
  fs.cpSync(SAMPLE, base, { recursive: true });
  restore = await openProject(API, base);
});
test.afterAll(async () => { await restore?.(); fs.rmSync(base, { recursive: true, force: true }); });

function watch(page) {
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  page.on('response', (r) => { if (r.status() >= 400) problems.push(`${r.status()} ${r.url()}`); });
  return problems;
}

test('im1 UAT: Settings -> AI steps shows where Line missed, per step, in plain English', async ({ page }) => {
  const problems = watch(page);
  await gotoCockpit(page, '/');
  await page.getByTestId('user-menu-trigger').click();
  await page.getByTestId('profile-settings').click();
  const report = page.getByTestId('miss-report');
  await expect(report).toBeVisible({ timeout: 30_000 });
  await expect(report.getByRole('heading', { name: 'Where Line missed' })).toBeVisible();
  await expect(report.getByTestId('miss-report-sentence')).toHaveText(/^(\d+ miss(es)?: \d+ where the right answer was not among Line's options \(a static tool is missing\), \d+ where it was offered but another was recommended\.|No misses: every right answer was offered and recommended\.)$/);
  await expect(report.getByText(/^From .*\.$|^No plan feedback or eval has been measured yet\.$/)).toBeVisible();
  for (const s of await report.getByTestId('miss-step').allTextContents()) expect(s).toMatch(/^(The line\.\w+ step|Asking one question|Refusing as asked): \d+ miss(es)? where the right answer was not offered, \d+ where it was offered but not recommended\.$/);
  // The patterns Line did not offer sit under Details, slotted: kinds, never a project's names.
  const details = report.locator('details');
  if (await details.count()) {
    await details.getByText(/^Details/).click();
    for (const s of await details.locator('li').allTextContents()) { expect(s).toMatch(/^\d+ miss(es)?: ".*" needed the .* route, which Line did not offer\.$/); expect(s).not.toMatch(/OrderButton|InvoicesPage|orders|billing/); }
  }
  // im2's step is listed with the other AI steps.
  const repair = page.locator('[data-testid="ai-step"][data-step="construct.repair"]');
  await expect(repair).toContainText('repairs it from the exact error');
  await expect(repair.getByTestId('ai-step-model')).toHaveText("Model: qwen2.5-coder:1.5b (Line's default)");
  expect(problems, problems.join('\n')).toEqual([]);
});

test('im1 UAT: in the drafter, a cross-feature problem now also offers moving the item into the library (the top miss)', async ({ page }) => {
  const problems = watch(page);
  await gotoCockpit(page, '/components');
  const box = page.getByTestId('line-draft');
  await expect(box.getByRole('heading', { name: /Describe a change/ })).toBeVisible({ timeout: 30_000 });
  await box.getByLabel('What do you want to change?').fill('fix the problem in InvoicesPage');
  await box.getByLabel('What do you want to change?').press('Enter');
  const routes = box.getByTestId('draft-route');
  await expect(routes.first()).toBeVisible({ timeout: 30_000 });
  const labels = await routes.getByTestId('draft-route-label').allTextContents();
  expect(labels[0]).toMatch(/^Fix the LINE-DIR problem with its recommended fix\.$|^Fix /);
  expect(labels).toContain('Move OrderButton into the library directly.');
  const move = routes.filter({ hasText: 'Move OrderButton into the library directly.' });
  await expect(move.getByRole('button', { name: /^Add to plan/ })).toBeVisible();
  // Adding it only plans it: nothing is written until a person approves it in the Plan panel.
  await move.getByRole('button', { name: /^Add to plan/ }).click();
  const step = page.getByTestId('line-plan').getByTestId('plan-step').last();
  await expect(step).toHaveAttribute('data-state', 'waiting');
  expect(fs.existsSync(path.join(base, 'library/components/OrderButton.tsx'))).toBe(false);
  expect(problems, problems.join('\n')).toEqual([]);
});
