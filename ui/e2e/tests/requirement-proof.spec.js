import { test, expect } from '@playwright/test';
import { gotoCockpit } from './support/cockpit.js';
import { openProject } from './support/browseProject.js';
import { runAxe, isBlocking, format } from './support/axe.js';
import { makeProofProject } from '../../../test-utils/proofProject.mjs';

// #653 (part of #616) -- the Requirement screen shows the proof of a generated screen and lets a person run or skip it, end to
// end in a real browser against the real server and a REAL `construct init` project: the plan is applied to it through its own
// commands (what the process runner does once the files are approved), the proof runs for real (bundled with the project's esbuild,
// node --test), and a deliberately broken page really fails it. Nothing is mocked.
// Ports (this spec's own): E2E_CLIENT_PORT=49525 E2E_SERVER_PORT=49526 E2E_DEVSERVER_PORT_BASE=49530.
const API = process.env.E2E_API_BASE || 'http://localhost:4000';
const PRODUCTS = 'A user wants to see a list of products';
const REASON = 'the empty state is redesigned in #700';

const isRead = (r) => r.url().endsWith('/api/requirement/read') && r.request().method() === 'POST';
const isProof = (name) => (r) => r.url().endsWith(`/api/requirement/proof/${name}`) && r.request().method() === 'POST';
const readSentence = async (page, text) => {
  await page.getByTestId('requirement-text').fill(text);
  const done = page.waitForResponse(isRead);
  await page.getByTestId('requirement-read').click();
  await done;
  await expect(page.getByTestId('requirement-card')).toBeVisible();
};
const chooseList = async (page) => {
  const done = page.waitForResponse(isRead);
  await page.getByTestId('requirement-shape-list').click();
  await done;
  await expect(page.getByTestId('requirement-proof')).toBeVisible();
};
const runProof = async (page) => {
  const done = page.waitForResponse(isProof('run'));
  await page.getByTestId('proof-run').click();
  const res = await done;
  expect(res.status()).toBe(200);
  return { res, body: await res.json() };
};
const noScroll = async (page, label) => {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${label}: page scroll`).toBe(true);
  expect(await page.getByTestId('requirement-stage').evaluate((el) => el.scrollWidth <= el.clientWidth + 1), `${label}: stage scroll`).toBe(true);
  expect(await page.getByTestId('requirement-proof').evaluate((el) => el.scrollWidth <= el.clientWidth + 1), `${label}: card scroll`).toBe(true);
};

test.describe.serial('Requirement: the proof of a generated screen is shown, run and skipped (#653)', () => {
  let project;
  let restore;
  let plan;

  test.beforeAll(async () => {
    project = makeProofProject({ prefix: 'og653-e2e-', git: true });
    restore = await openProject(API, project.root);
    const res = await fetch(`${API}/api/requirement/read`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: PRODUCTS, answers: [{ id: 'q-shape', option: 'list' }] }) });
    plan = (await res.json()).plan;
  });
  test.afterAll(async () => {
    await restore?.();
    project?.remove();
  });

  test('the plan is not applied yet: a pending Proof card after Approve, the chain incomplete, run and skip off with "approve the plan first"', async ({ page }) => {
    await gotoCockpit(page, '/requirement');
    await readSentence(page, PRODUCTS);
    await expect(page.getByTestId('requirement-proof')).toHaveCount(0); // no shape chosen: the plain scaffold proves nothing
    await chooseList(page);
    const card = page.getByTestId('requirement-proof');
    await expect(card.getByRole('heading', { level: 2 })).toHaveText('6. Prove the screen');
    // Its place: after the approval, as a separate step.
    const order = await page.getByTestId('requirement-stage').locator('[data-testid="requirement-timeline"], [data-testid="requirement-approve"], [data-testid="requirement-proof"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
    expect(order).toEqual(['requirement-timeline', 'requirement-approve', 'requirement-proof']);
    await expect(card).toHaveAttribute('data-state', 'pending');
    await expect(page.getByTestId('proof-state')).toHaveText('○ Pending');
    await expect(page.getByTestId('proof-chain')).toHaveText('Chain: incomplete (the proof has not run yet)');
    await expect(page.getByTestId('proof-chain')).toHaveAttribute('data-complete', 'false');
    await expect(page.getByTestId('proof-run')).toBeDisabled();
    await expect(page.getByTestId('proof-skip')).toBeDisabled();
    await expect(page.getByTestId('proof-run-reason')).toContainText('Approve the plan first');
    // Approving the plan is its own, earlier step: the proof does not run by itself, and the reason then names the next step.
    const ran = page.waitForResponse((r) => r.url().endsWith('/api/plan/run') && r.request().method() === 'POST');
    await page.getByTestId('requirement-approve-plan').click();
    expect((await ran).status()).toBe(200);
    await expect(page.getByTestId('requirement-started')).toBeVisible();
    await expect(page.getByTestId('proof-run')).toBeDisabled();
    await expect(page.getByTestId('proof-run-reason')).toContainText('approve each of its files in the process');
    await expect(page.getByTestId('proof-chain')).toContainText('incomplete');
    // The run route refuses too (never a guess), whatever the buttons say.
    const refused = await page.evaluate(async ({ api, plan }) => {
      const res = await fetch(`${api}/api/requirement/proof/run`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ feature: 'products', plan }) });
      return { status: res.status, body: await res.json() };
    }, { api: API, plan });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('NOT_APPLIED');
    expect(refused.body.error).toMatch(/Approve the plan first/);

    // The files reach the project (what approving each file does): the card notices and the proof can be run.
    project.applyPlan(plan);
    await expect(page.getByTestId('proof-run')).toBeEnabled({ timeout: 15_000 });
    await expect(page.getByTestId('proof-run-reason')).toHaveCount(0);
    await expect(page.getByTestId('proof-skip')).toBeEnabled();
  });

  test('green path: Run the proof runs the read-only proof; the card is green and the chain reads "complete (proof green: N passed)"', async ({ page }) => {
    await gotoCockpit(page, '/requirement');
    await readSentence(page, PRODUCTS);
    await chooseList(page);
    // Read again with the plan applied: the card asks the server, and run is on with no reason.
    await expect(page.getByTestId('proof-run')).toBeEnabled();
    await expect(page.getByTestId('proof-run-reason')).toHaveCount(0);
    const done = page.waitForResponse(isProof('run'));
    await page.getByTestId('proof-run').click();
    await expect(page.getByTestId('proof-running')).toBeVisible(); // progress while it runs
    await expect(page.getByTestId('proof-run')).toBeDisabled();
    const res = await done;
    expect(res.status()).toBe(200);
    // Only a feature name and the plan go over; no path.
    expect(Object.keys(res.request().postDataJSON()).sort()).toEqual(['feature', 'plan']);
    const { run } = await res.json();
    expect(run.state).toBe('green');
    await expect(page.getByTestId('requirement-proof')).toHaveAttribute('data-state', 'green');
    await expect(page.getByTestId('proof-state')).toHaveText('✓ Green');
    await expect(page.getByTestId('proof-chain')).toHaveText(`Chain: complete (proof green: ${run.counts.passed} passed)`);
    await expect(page.getByTestId('proof-chain')).toHaveAttribute('data-complete', 'true');
    await expect(page.getByTestId('proof-counts')).toContainText(`${run.counts.passed} passed, 0 failed`);
    await expect(page.getByTestId('proof-failure')).toHaveCount(0);
    await expect(page.getByTestId('proof-skip')).toHaveCount(0);
    await expect(page.getByTestId('proof-run')).toHaveText('Run the proof again');
    expect(run.counts.passed).toBeGreaterThanOrEqual(7); // #621: the plan's default source is local, whose list proof has 7 tests (10 for the endpoint source)
  });

  test('a deliberately broken page: the card is failed, the failing state ("empty") is named, in the words of the Tests screen; the chain is incomplete', async ({ page }) => {
    project.breakEmptyState();
    await gotoCockpit(page, '/requirement');
    await readSentence(page, PRODUCTS);
    await chooseList(page);
    const { body } = await runProof(page);
    expect(body.run.state).toBe('failed');
    await expect(page.getByTestId('requirement-proof')).toHaveAttribute('data-state', 'failed');
    await expect(page.getByTestId('proof-state')).toHaveText('✗ Failed');
    const failure = page.getByTestId('proof-failure');
    await expect(failure).toHaveCount(1);
    await expect(failure).toHaveAttribute('data-kind', 'app');
    await expect(failure.getByRole('heading', { level: 3 })).toContainText('The app behaved differently');
    await expect(page.getByTestId('proof-failing-state')).toHaveText('Failing state: empty, the screen reached blank');
    await expect(page.getByTestId('proof-failure-summary')).toHaveText('The page given no rows: the empty state is wrong, the screen shows blank.');
    await expect(page.getByTestId('proof-chain')).toContainText('incomplete (the proof failed');
    await expect(page.getByTestId('proof-chain')).toHaveAttribute('data-complete', 'false');
    // The closed options of the failure: run again and skip work; edit, fill with AI show what they will do and are off, with the reason.
    await expect(page.getByTestId('proof-run')).toBeEnabled();
    await expect(page.getByTestId('proof-skip')).toBeEnabled();
    await expect(page.getByTestId('proof-option-edit-code')).toBeDisabled();
    await expect(page.getByTestId('proof-option-fill-with-ai')).toBeDisabled();
    await expect(page.getByTestId('proof-option-regenerate-screen')).toHaveCount(0);
    await expect(page.locator('[data-testid="proof-option-note"][data-option="fill-with-ai"]')).toContainText('reviewable diff');
    await expect(page.locator('[data-testid="proof-option-note"][data-option="edit-code"]')).toContainText('Not wired here yet');
  });

  test('skip: an empty reason is refused; a reason makes the chain "complete (proof skipped: <reason>)", never a plain complete', async ({ page, request }) => {
    await gotoCockpit(page, '/requirement');
    await readSentence(page, PRODUCTS);
    await chooseList(page);
    await runProof(page); // still broken: failed
    await page.getByTestId('proof-skip').click();
    await expect(page.getByTestId('proof-skip-form')).toBeVisible();
    let skipRequests = 0;
    page.on('request', (r) => { if (r.url().endsWith('/api/requirement/proof/skip')) skipRequests += 1; });
    await page.getByTestId('proof-skip-confirm').click();
    await expect(page.getByTestId('proof-skip-error')).toContainText('Give a reason');
    await page.getByTestId('proof-skip-reason').fill('short');
    await page.getByTestId('proof-skip-confirm').click();
    await expect(page.getByTestId('proof-skip-error')).toContainText('at least 8 characters');
    await expect(page.getByTestId('proof-chain')).toHaveAttribute('data-complete', 'false');
    expect(skipRequests, 'the refusal happens before anything is sent').toBe(0);
    // The server refuses the same, whatever the client does.
    const direct = await request.post(`${API}/api/requirement/proof/skip`, { data: { feature: 'products', plan, reason: '   ' } });
    expect(direct.status()).toBe(400);
    expect((await direct.json()).code).toBe('REASON_REQUIRED');

    await page.getByTestId('proof-skip-reason').fill(REASON);
    const saved = page.waitForResponse(isProof('skip'));
    await page.getByTestId('proof-skip-confirm').click();
    const res = await saved;
    expect(res.status()).toBe(200);
    expect(res.request().postDataJSON().reason).toBe(REASON);
    await expect(page.getByTestId('requirement-proof')).toHaveAttribute('data-state', 'skipped');
    await expect(page.getByTestId('proof-state')).toHaveText('↷ Skipped');
    await expect(page.getByTestId('proof-chain')).toHaveText(`Chain: complete (proof skipped: ${REASON})`);
    await expect(page.getByTestId('proof-chain')).toHaveAttribute('data-complete', 'true');
    await expect(page.getByTestId('proof-skip-form')).toHaveCount(0);
    await expect(page.getByTestId('proof-failure')).toHaveCount(0);
    // A run afterwards supersedes the skip: the chain is what the last word says (fixed, it is green).
    project.fixEmptyState();
    await runProof(page);
    await expect(page.getByTestId('requirement-proof')).toHaveAttribute('data-state', 'green');
    await expect(page.getByTestId('proof-chain')).toContainText('complete (proof green:');
  });

  for (const theme of ['dark', 'light']) {
    test(`accessibility and layout at 390 px: ${theme}, pending-then-green, a failed proof with its banner, and the skip form`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem('construct.theme', t), theme);
      await page.setViewportSize({ width: 390, height: 844 });
      await gotoCockpit(page, '/requirement');
      await readSentence(page, PRODUCTS);
      await chooseList(page);
      const check = async (label) => {
        const found = await runAxe(page);
        expect(found.filter(isBlocking), `${label}: ${format(found.filter(isBlocking))}`).toEqual([]);
        await noScroll(page, label);
      };
      await expect(page.getByTestId('proof-run')).toBeEnabled();
      await check('pending');
      await runProof(page);
      await expect(page.getByTestId('requirement-proof')).toHaveAttribute('data-state', 'green');
      await check('green');
      project.breakEmptyState();
      await runProof(page);
      await expect(page.getByTestId('proof-failure')).toBeVisible();
      await check('failed');
      await page.getByTestId('proof-skip').click();
      await page.getByTestId('proof-skip-confirm').click();
      await expect(page.getByTestId('proof-skip-error')).toBeVisible();
      await check('skip form with its error');
      project.fixEmptyState();
    });
  }
});
