import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.resolve(__dirname, '../screenshots');
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

const API_BASE = process.env.E2E_API_BASE || 'http://localhost:4000';

/** Answers whatever question the wizard is currently blocked on (waits for
 * the chat's answer box to (re)appear — it's only in the DOM while
 * `awaitingAnswer` is true — types `text`, and sends it). Empty string is a
 * valid, meaningful answer (several of the wizard's own prompts treat a
 * blank answer as "finish"/"no"). */
async function answerNextQuestion(page, text) {
  const input = page.locator('.chat-input input');
  await expect(input).toBeVisible({ timeout: 15000 });
  if (text) await input.fill(text);
  await page.getByRole('button', { name: 'Send' }).click();
}

// This suite drives the actual rendered UI (not curl, not just
// `npm run build`) through every screen listed in issue #37, capturing one
// screenshot per step into ui/e2e/screenshots/. Steps share one backend
// process's in-memory state (project directory, the feature created in
// step 2/3), so they run serially and in this fixed order.
test.describe.serial('Construct UI walkthrough (issue #37)', () => {
  let tmpProjectDir;
  const consoleErrors = [];
  const pageErrors = [];

  test.beforeAll(() => {
    tmpProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-ui-e2e-'));
  });

  test.afterAll(() => {
    fs.rmSync(tmpProjectDir, { recursive: true, force: true });
  });

  test.beforeEach(({ page }) => {
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(`[${test.info().title}] ${msg.text()}`);
    });
    page.on('pageerror', (err) => pageErrors.push(`[${test.info().title}] ${err}`));
  });

  test.afterAll(() => {
    // Surfaced in the run's final report rather than failing the suite —
    // the task is to record any real bug precisely, not to silently pass
    // or hard-fail the whole harness on one page's console noise.
    if (consoleErrors.length || pageErrors.length) {
      console.log('--- console errors captured across the walkthrough ---');
      for (const e of consoleErrors) console.log(e);
      for (const e of pageErrors) console.log(e);
      console.log('-------------------------------------------------------');
    }
  });

  test('1. project-gate.png — no architecture.yml at the selected directory', async ({ page, request }) => {
    const settingsRes = await request.post(`${API_BASE}/api/settings`, {
      data: { projectDir: tmpProjectDir },
    });
    expect(settingsRes.ok()).toBeTruthy();
    const settingsBody = await settingsRes.json();
    expect(settingsBody.valid).toBe(false);
    expect(settingsBody.needsInit).toBe(true);

    await page.goto('/');
    await expect(page.locator('h1')).toHaveText('No Construct project here yet');
    await expect(page.getByRole('button', { name: 'Initialize Construct here' })).toBeVisible();
    await expect(page.locator('code').first()).toHaveText(tmpProjectDir);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'project-gate.png'), fullPage: true });
  });

  test('2. dashboard-after-init.png — clicking Initialize unlocks the Dashboard', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toHaveText('No Construct project here yet');
    await page.getByRole('button', { name: 'Initialize Construct here' }).click();
    await expect(page.locator('h1')).toHaveText('Features', { timeout: 15_000 });
    // #370: the Dashboard's forms are stage actions of Features; Create opens its form in the stage.
    await page.getByTestId('stage-action-create').click();
    await expect(page.getByRole('heading', { name: 'Create' })).toBeVisible();
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'dashboard-after-init.png'), fullPage: true });
  });

  test('3. dashboard-action-result.png — Create a feature and check attribution badges render visibly', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toHaveText('Features');
    await page.getByTestId('stage-action-create').click();

    const createForm = page.locator('.command-form', { has: page.getByRole('heading', { name: 'Create' }) });
    await createForm.getByPlaceholder('e.g. CpoAccess').fill('billing');
    await createForm.getByRole('button', { name: /^Create (feature|slice|file)$/ }).click();

    const toolBadge = createForm.locator('.attribution-label.tool').first();
    const llmBadge = createForm.locator('.attribution-row .attribution-label').nth(1);
    await expect(toolBadge).toBeVisible({ timeout: 10_000 });
    await expect(llmBadge).toBeVisible();

    // "Visible" per the DOM alone isn't enough — check the actual computed
    // style so a `display:none`/`opacity:0`/zero-size regression would be
    // caught even though Playwright's own toBeVisible() already checks
    // this (this is the explicit, literal check the task asked for).
    for (const badge of [toolBadge, llmBadge]) {
      const box = await badge.boundingBox();
      expect(box, 'attribution badge should have a non-zero bounding box').not.toBeNull();
      expect(box.width).toBeGreaterThan(0);
      expect(box.height).toBeGreaterThan(0);
      const style = await badge.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { display: cs.display, visibility: cs.visibility, opacity: cs.opacity };
      });
      expect(style.display).not.toBe('none');
      expect(style.visibility).not.toBe('hidden');
      expect(Number(style.opacity)).toBeGreaterThan(0);
    }

    await expect(createForm.locator('.command-output')).toContainText('billing');
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'dashboard-action-result.png'), fullPage: true });
  });

  test('4. settings.png — per-capability LLM provider dropdowns', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.locator('h1')).toHaveText('Settings');

    // #100/Epic 6.4: one independently-configurable dropdown per LLM
    // capability (importFill/createFill/planAnalysis), not one global
    // provider select — each has a stable id so this test (and any other
    // future one) can target a specific capability unambiguously.
    const importFillSelect = page.locator('#llm-importFill');
    const createFillSelect = page.locator('#llm-createFill');
    const planAnalysisSelect = page.locator('#llm-planAnalysis');
    await expect(importFillSelect).toBeVisible();
    await expect(createFillSelect).toBeVisible();
    await expect(planAnalysisSelect).toBeVisible();

    const importFillOptions = await importFillSelect.locator('option').allTextContents();
    expect(importFillOptions.length).toBeGreaterThan(1); // "none" + at least one real provider from src/llm.mjs's PROVIDERS
    expect(importFillOptions.some((t) => t.trim() === 'claude')).toBe(true);

    // The #96 hard guardrail, verified at the UI layer too: planAnalysis's
    // own dropdown must never even offer 'ollama' as an option — not just
    // ui/server/src/settings.mjs rejecting it server-side.
    const planAnalysisOptions = await planAnalysisSelect.locator('option').allTextContents();
    expect(planAnalysisOptions.some((t) => t.trim() === 'ollama')).toBe(false);

    // Click to open the native <select>. Note: Chromium's native option
    // popup is an OS-level overlay outside the page's render tree, so
    // page.screenshot() (a CDP viewport capture) cannot show it actually
    // dropped open regardless of headed/headless — this is a Playwright/
    // CDP limitation, not an app bug. We still click it (real interaction,
    // matches what a user does) and additionally assert the real option
    // list programmatically so "showing real options" is verified even
    // though the screenshot itself will show the closed control.
    await importFillSelect.click();
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'settings.png'), fullPage: true });
    await page.keyboard.press('Escape');
  });

  test('5. wizard.png — start a session and get through the first few Q&A turns', async ({ page }) => {
    await page.goto('/wizard');
    await expect(page.locator('h1')).toHaveText('Import Route Wizard');

    // A route that can't possibly resolve, so the wizard fails fast at
    // real route-resolution (no network/CLI call) rather than reaching
    // its one LLM analysis step. This is the "seed route that fails fast"
    // fallback: driving the wizard into the real `claude` CLI call was
    // considered too slow/flaky for an automated screenshot pass (it
    // shells out to an external CLI that needs its own auth/session), so
    // this walkthrough exercises every question-answer turn up to (but
    // not including) that call, ending in a real, unmocked error.
    await page.getByPlaceholder('/v2/home').fill('/definitely-not-a-real-route-xyz');
    await page.getByRole('button', { name: 'Start wizard session' }).click();

    // Turn 1: "Destination feature (Construct feature name): "
    await expect(page.locator('.chat-question').last()).toContainText('Destination feature');
    await answerNextQuestion(page, 'wizardtest');

    // Turn 2: seedRoute pre-fills routeArgs, so the loop goes straight to
    // "Another route to include (leave blank to finish — 1 so far): "
    await expect(page.locator('.chat-question').last()).toContainText('Another route to include');
    await answerNextQuestion(page, ''); // blank -> finish collecting routes

    // Turn 3: "...should the LLM also write the ported logic...? [y/N]: "
    await expect(page.locator('.chat-question').last()).toContainText('LLM also write the ported logic');
    await answerNextQuestion(page, 'n');

    // Turn 4: the seed route isn't an existing directory, so it's treated
    // as a URL-style route -> asks for the Next.js app/ directory.
    await expect(page.locator('.chat-question').last()).toContainText('Next.js app');
    await answerNextQuestion(page, 'definitely-not-a-real-app-dir');

    // Real, unmocked outcome: resolveRoute() fails against a nonexistent
    // app dir, caught by importRouteWizard's own try/catch, logged as an
    // error bubble, session ends — never reaching the claude CLI call.
    await expect(page.locator('.chat-error')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.chat-error').last()).toContainText('Route resolution failed');
    await expect(page.locator('.chat-system').last()).toContainText('Session finished', { timeout: 15_000 });

    // The transcript lives in a scrollable `.chat` box (max-height: 55vh);
    // its own useEffect auto-scrolls new messages into view via a smooth
    // (animated) scrollIntoView, which can still be mid-animation at the
    // moment we'd otherwise screenshot. Force it to the bottom directly so
    // the screenshot deterministically shows the final error + "Session
    // finished" bubbles instead of whatever the animation had reached.
    await page.locator('.chat').evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'wizard.png'), fullPage: true });
  });

  test('6. help.png — getting-started and the live CLI reference are populated', async ({ page }) => {
    await page.goto('/help');
    await expect(page.locator('h1')).toHaveText('Help');
    await expect(page.locator('#getting-started')).toBeVisible();
    await expect(page.locator('#getting-started')).toContainText('Create your first feature');

    // The CLI reference section only renders real content once GET
    // /api/help resolves — wait for that instead of a fixed sleep, and
    // assert the fetched text is non-trivial (proves the fetch actually
    // populated real usage/help text pulled from src/usage.mjs /
    // src/repl.mjs, not just that the section container exists).
    const cliSection = page.locator('#cli-reference');
    await expect(cliSection).toBeVisible();
    await cliSection.locator('> summary').click(); // #391: only Getting started is open by default
    await expect(cliSection.getByText('Top-level overview')).toBeVisible({ timeout: 10_000 });
    const usagePre = cliSection.locator('pre.help-pre').first();
    const usageText = await usagePre.textContent();
    expect(usageText.length).toBeGreaterThan(40);
    expect(usageText).toContain('construct');

    await cliSection.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'help.png'), fullPage: true });
  });

  // Epic #48 (#49-#56): scaffold a page-layer file into the "billing"
  // feature created in step 3, then drive the Pages Editor end to end —
  // browse to it, open its JSX tree, select a node from the tree (#50/#51),
  // and confirm the isolated snippet editor + props inspector render for
  // that selection (#52/#53). Doesn't exercise the save round trip here
  // (that's covered at the API level by ui/server/src/pagesEditor.test.mjs)
  // — this is the one layer that proves the real, rendered browser flow
  // actually wires those pieces together.
  test('7. pages-editor.png — browse a feature, open a page, select a tree node', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toHaveText('Features');
    await page.getByTestId('stage-action-create').click();

    const createForm = page.locator('.command-form', { has: page.getByRole('heading', { name: 'Create' }) });
    await createForm.locator('select').first().selectOption('single');
    await createForm.getByPlaceholder('e.g. CpoAccess').fill('Home');
    await createForm.getByPlaceholder('e.g. cpo-v2').fill('billing');
    await createForm.locator('select').nth(1).selectOption('page');
    await createForm.getByRole('button', { name: /^Create (feature|slice|file)$/ }).click();
    await expect(createForm.locator('.attribution-label.tool').first()).toBeVisible({ timeout: 10_000 });

    await page.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Pages' }).click();
    await expect(page.locator('h1')).toHaveText('Pages Editor');

    await page.locator('.pages-browser select').selectOption('billing');
    const openButton = page.getByRole('button', { name: 'HomePage.tsx' });
    await expect(openButton).toBeVisible({ timeout: 10_000 });
    await openButton.click();

    await expect(page.locator('.tree-panel')).toBeVisible();
    const firstNode = page.locator('.tree-node').first();
    await expect(firstNode).toBeVisible({ timeout: 10_000 });
    await firstNode.click();

    // Selecting via the tree highlights the same node in the structural
    // preview (#51, tree -> preview direction).
    await expect(page.locator('.preview-node.selected')).toBeVisible();
    await expect(page.locator('.snippet-editor')).toBeVisible();
    await expect(page.locator('.props-inspector')).toBeVisible();

    // And the reverse direction (#51, preview -> tree): clicking the
    // preview box selects the same node in the tree.
    await page.locator('.preview-node').first().click();
    await expect(page.locator('.tree-node.selected')).toBeVisible();

    await page.getByRole('button', { name: 'Show diagram' }).click();
    await expect(page.locator('.propflow-svg')).toBeVisible();

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'pages-editor.png'), fullPage: true });
  });
});
