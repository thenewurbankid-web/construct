import { test, expect } from '@playwright/test';
import { gotoCockpit } from './support/cockpit.js';
import { makeBrowseProject, openProject } from './support/browseProject.js';

// LIN-137 (part of LIN-82/epic #616) -- the Debug screen, end to end in a real browser against the real server and a
// real throwaway git project. Nothing is mocked: the four choosers (reproduce -> isolate -> fix -> verify) are read
// by the real deterministic blocks (packages/core/debug-chain.mjs, chooser.mjs's compileChain), and Approve hands
// the compiled plan to the real Plan run route, which creates a real process.
const API = process.env.E2E_API_BASE || 'http://localhost:4000';

test.describe.serial('Debug: reproduce -> isolate -> fix -> verify, one closed question at a time (LIN-137)', () => {
  let project;
  let restore;

  test.beforeAll(async () => {
    project = makeBrowseProject('lin137-debug-');
    restore = await openProject(API, project.repo);
  });
  test.afterAll(async () => {
    await restore?.();
    project?.remove();
  });

  test('the four choosers, one at a time; each already-answered step stays visible and locked', async ({ page }) => {
    await gotoCockpit(page, '/debug');
    await expect(page.getByRole('heading', { name: 'Debug', level: 1 })).toBeVisible();
    await expect(page.getByTestId('debug-no-model')).toContainText('No model picks an option');
    await expect(page.getByTestId('debug-start')).toBeDisabled();
    await expect(page.getByTestId('debug-step-reproduce')).toHaveCount(0);

    await page.getByTestId('debug-feature').fill('cart');
    await expect(page.getByTestId('debug-start')).toBeEnabled();
    await page.getByTestId('debug-start').click();

    // Step 1: reproduce. Only this one is visible; the rest have not been reached yet.
    await expect(page.getByTestId('debug-step-reproduce')).toBeVisible();
    await expect(page.getByTestId('debug-step-isolate')).toHaveCount(0);
    await expect(page.getByTestId('debug-step-reproduce').getByTestId('debug-question')).toContainText('How do you already have this failing?');
    await expect(page.getByTestId('debug-step-reproduce').getByTestId('debug-options').getByRole('button')).toHaveCount(5); // 4 options + exit
    await page.getByTestId('debug-answer-reproduce-playwright-test').click();

    // Step 2: isolate appears; step 1 stays, its buttons now disabled (locked).
    await expect(page.getByTestId('debug-step-isolate')).toBeVisible();
    await expect(page.getByTestId('debug-answer-reproduce-playwright-test')).toBeDisabled();
    await expect(page.getByTestId('debug-step-fix')).toHaveCount(0);
    await page.getByTestId('debug-answer-isolate-narrow').click();

    // Step 3: fix. debug.fix's ai exit is rendered exactly like an option, labelled by its own action.
    await expect(page.getByTestId('debug-step-fix')).toBeVisible();
    await expect(page.getByTestId('debug-answer-fix-exit')).toHaveText('Fill with AI (reviewable diff)');
    await page.getByTestId('debug-answer-fix-add-unit').click();

    // Step 4: verify.
    await expect(page.getByTestId('debug-step-verify')).toBeVisible();
    await expect(page.getByTestId('debug-answer-verify-exit')).toHaveText('Verify by hand');
    await page.getByTestId('debug-answer-verify-rerun-repro').click();

    // Every chooser answered: the compiled plan (four steps, in order) and Approve.
    await expect(page.getByTestId('debug-plan-step')).toHaveCount(4);
    expect(await page.getByTestId('debug-plan-step').evaluateAll((els) => els.map((e) => e.querySelector('code')?.textContent))).toEqual(['test.run', 'test.run', 'create.unit', 'test.run']);
    await expect(page.getByTestId('debug-approve-plan')).toBeEnabled();
    await expect(page.getByTestId('debug-verify-prompt')).toBeVisible();
  });

  test('debug.fix\'s ai exit is excluded from the compiled plan (three steps, not four)', async ({ page }) => {
    await gotoCockpit(page, '/debug');
    await page.getByTestId('debug-feature').fill('cart');
    await page.getByTestId('debug-start').click();
    await page.getByTestId('debug-answer-reproduce-playwright-test').click();
    await page.getByTestId('debug-answer-isolate-narrow').click();
    await page.getByTestId('debug-answer-fix-exit').click();
    await expect(page.getByTestId('debug-step-verify')).toBeVisible();
    await page.getByTestId('debug-answer-verify-rerun-repro').click();
    await expect(page.getByTestId('debug-plan-step')).toHaveCount(3);
    expect(await page.getByTestId('debug-plan-step').evaluateAll((els) => els.map((e) => e.querySelector('code')?.textContent))).toEqual(['test.run', 'test.run', 'test.run']);
  });

  test('"Did not pass" re-presents debug.isolate instead of ending the chain (shouldReiterate)', async ({ page }) => {
    await gotoCockpit(page, '/debug');
    await page.getByTestId('debug-feature').fill('cart');
    await page.getByTestId('debug-start').click();
    await page.getByTestId('debug-answer-reproduce-playwright-test').click();
    await page.getByTestId('debug-answer-isolate-narrow').click();
    await page.getByTestId('debug-answer-fix-add-unit').click();
    await page.getByTestId('debug-answer-verify-rerun-repro').click();
    await expect(page.getByTestId('debug-verify-prompt')).toBeVisible();

    await page.getByTestId('debug-verify-failed').click();

    // debug.isolate is re-presented, unanswered; fix and verify are gone; reproduce's earlier answer is kept.
    await expect(page.getByTestId('debug-step-isolate')).toBeVisible();
    await expect(page.getByTestId('debug-answer-isolate-narrow')).toBeEnabled();
    await expect(page.getByTestId('debug-step-fix')).toHaveCount(0);
    await expect(page.getByTestId('debug-answer-reproduce-playwright-test')).toBeDisabled();
    await expect(page.getByTestId('debug-verify-prompt')).toHaveCount(0);

    // Re-answering all the way through shows the loop happened, then a pass ends the chain.
    await page.getByTestId('debug-answer-isolate-env-check').click();
    await page.getByTestId('debug-answer-fix-rename').click();
    await page.getByTestId('debug-answer-verify-full-feature').click();
    await expect(page.getByTestId('debug-iterations')).toContainText('Re-isolated 1 time.');
    await page.getByTestId('debug-verify-passed').click();
    await expect(page.getByTestId('debug-verify-ok')).toBeVisible();
    await expect(page.getByTestId('debug-verify-prompt').getByTestId('debug-verify-passed')).toHaveCount(0);
  });

  test('Approve plan starts a real process through the Plan run route; nothing reaches the project', async ({ page }) => {
    await gotoCockpit(page, '/debug');
    await page.getByTestId('debug-feature').fill('cart');
    await page.getByTestId('debug-start').click();
    await page.getByTestId('debug-answer-reproduce-playwright-test').click();
    await page.getByTestId('debug-answer-isolate-narrow').click();
    await page.getByTestId('debug-answer-fix-add-unit').click();
    await page.getByTestId('debug-answer-verify-rerun-repro').click();
    await expect(page.getByTestId('debug-approve-plan')).toBeEnabled();

    const before = project.git('status', '--porcelain');
    const ran = page.waitForResponse((r) => r.url().endsWith('/api/plan/run') && r.request().method() === 'POST');
    await page.getByTestId('debug-approve-plan').click();
    const res = await ran;
    expect(res.status()).toBe(200);
    const { processId } = await res.json();
    expect(processId).toBeTruthy();
    await expect(page.getByTestId('debug-started')).toContainText(processId);
    await expect(page.getByTestId('debug-approve-plan')).toBeDisabled();
    expect(project.git('status', '--porcelain')).toBe(before);
  });

  test('a read that fails says so and keeps the feature name', async ({ page }) => {
    await gotoCockpit(page, '/debug');
    await page.route('**/api/debug/read', (route) => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Name the feature under debug first.' }) }));
    await page.getByTestId('debug-feature').fill('cart');
    await page.getByTestId('debug-start').click();
    await expect(page.getByTestId('debug-error')).toHaveText('Name the feature under debug first.');
    await expect(page.getByTestId('debug-feature')).toHaveValue('cart');
  });
});
