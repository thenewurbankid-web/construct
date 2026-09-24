import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { materializeLegacyShop, writeLegacyShopPlan } from '../support/legacyShop.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.resolve(__dirname, '../../screenshots/demos');
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

const API_BASE = process.env.E2E_API_BASE || 'http://localhost:4000';

// The same small non-Construct "legacy" Next.js-shaped app used for the CLI
// evidence in #146/#147's write-ups: app/products/page.tsx + a real client
// component doing a real fetch/render, and the [id] details route pair.
// Reused here (not regenerated) so the UI run traces the exact same real
// files the CLI transcripts reference.
const { appDir: LEGACY_APP_DIR } = materializeLegacyShop();
// A real plan.json, produced earlier in this session by calling the same
// route-resolver.mjs + import.mjs functions the wizard calls internally
// (resolveRoute -> traceRouteFiles -> analyzeFiles, one real "claude" call)
// against that same legacy app. The interactive wizard never writes a plan
// to disk itself (it builds directly in-session) — this file is what lets
// #147's UI section exercise the Dashboard's "from an approved plan file"
// Import mode for real, the same way a human would after hand-reviewing an
// AI-proposed plan.
const PLAN_FILE = writeLegacyShopPlan(LEGACY_APP_DIR);

async function answerNextQuestion(page, text) {
  const input = page.locator('.chat-input input');
  await expect(input).toBeVisible({ timeout: 15_000 });
  if (text) await input.fill(text);
  await page.getByRole('button', { name: 'Send' }).click();
}

// #146's UI section: the guided chat wizard (ui/client/features/wizard),
// walked through independently of the CLI section above — its own real
// WebSocket session, its own real trace + real single combined `claude`
// call, its own real approval gate. Answers "n" to the LLM-fill question
// (that step is #147's focus) so this run's own resulting scaffold, once
// approved, is the plain deterministic TODO-breadcrumb form — same
// separation of concerns as the CLI section.
test.describe.serial('Demo #146 -- guided route import: scan, plan, approval (UI)', () => {
  let projectDir;

  test.beforeAll(async ({ request }) => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-demo-route-146-ui-'));
    const settingsRes = await request.post(`${API_BASE}/api/settings`, { data: { projectDir, llmProviders: { importFill: 'ollama' } } }); // provider comes from Settings since #109
    expect(settingsRes.ok()).toBeTruthy();
    const initRes = await request.post(`${API_BASE}/api/init`);
    expect(initRes.ok()).toBeTruthy();
  });

  test.afterAll(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  test('#146 UI: wizard traces a real route, proposes a real plan, and only builds on approval', async ({ page }) => {
    await page.goto('/wizard');
    await expect(page.locator('h1')).toHaveText('Import Route Wizard');

    await page.getByPlaceholder('/v2/home').fill('/products');
    await page.getByRole('button', { name: 'Start wizard session' }).click();

    await expect(page.locator('.chat-question').last()).toContainText('Destination feature');
    await answerNextQuestion(page, 'products-ui');

    // seedRoute pre-fills routeArgs with /products -> next question is
    // "Another route to include".
    await expect(page.locator('.chat-question').last()).toContainText('Another route to include');
    await answerNextQuestion(page, '/products/1');
    await expect(page.locator('.chat-question').last()).toContainText('Another route to include');
    await answerNextQuestion(page, '');

    await expect(page.locator('.chat-question').last()).toContainText('LLM also write the ported logic');
    await answerNextQuestion(page, 'n');

    await expect(page.locator('.chat-question').last()).toContainText('Next.js app');
    await answerNextQuestion(page, LEGACY_APP_DIR);

    // The real, single combined `claude` call — this is the slow step
    // (a real model round trip), so give it real time rather than mocking it.
    await expect(page.locator('.chat-log').filter({ hasText: 'Proposed plan for feature' })).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('.chat-question').last()).toContainText('Approve this plan and build it now?');

    await page.locator('.chat').evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'route-import-146-ui-1-plan-proposed.png'), fullPage: true });

    await answerNextQuestion(page, 'y');

    // Approval triggers the real deterministic scaffold + a real
    // `validate --feature` run, ending with the wizard's own "what's left"
    // summary and a system "Session finished" message.
    await expect(page.locator('.chat-system').last()).toContainText('Session finished', { timeout: 30_000 });
    const transcript = await page.locator('.chat').innerText();
    expect(transcript).toContain('TODO(import) marker');

    await page.locator('.chat').evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'route-import-146-ui-2-approved-and-scaffolded.png'), fullPage: true });
  });
});

// #147's UI section: continuing from an approved plan, via the Dashboard's
// existing Import form in "From an approved plan file" mode — a real,
// already-shipped UI surface distinct from the wizard (mirrors the CLI's
// own two entry points: the interactive wizard vs the flat `import --plan`
// form). Provider is "ollama" (Qwen) for the per-file logic-write step,
// same real reachable local daemon used in the CLI section.
test.describe.serial('Demo #147 -- guided route import: scaffold + AI-written logic (UI)', () => {
  let projectDir;

  test.beforeAll(async ({ request }) => {
    expect(fs.existsSync(PLAN_FILE)).toBeTruthy();
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-demo-route-147-ui-'));
    const settingsRes = await request.post(`${API_BASE}/api/settings`, { data: { projectDir, llmProviders: { importFill: 'ollama' } } }); // provider comes from Settings since #109
    expect(settingsRes.ok()).toBeTruthy();
    const initRes = await request.post(`${API_BASE}/api/init`);
    expect(initRes.ok()).toBeTruthy();
  });

  test.afterAll(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  test('#147 UI: Import form (plan mode) scaffolds + writes real ported logic via ollama', async ({ page }) => {
    // 8 real per-file ollama (qwen2.5-coder:7b) calls -- genuinely slow
    // (the CLI run of the same plan took ~2 minutes end to end), well past
    // playwright.config.js's default 30s test timeout.
    test.setTimeout(660_000);
    await page.goto('/dashboard');
    await expect(page.locator('h1')).toHaveText('Dashboard');
    await page.locator('.dashboard-more > summary').click(); // #391: Import sits under More actions
    const importForm = page.locator('.command-form', { has: page.getByRole('heading', { name: 'Import an existing file' }) });

    await importForm.getByLabel('Mode').selectOption('plan');
    await importForm.getByLabel('Plan file path').fill(PLAN_FILE);
    await importForm.getByLabel(/Have the LLM write the ported logic/).check();

    await importForm.getByRole('button', { name: /^Import (file|plan)$/ }).click();
    // 8 real per-file ollama calls (qwen2.5-coder:7b) -- genuinely slow;
    // the CLI run of the same plan took ~2 minutes end to end.
    await expect(importForm.locator('.command-result')).toBeVisible({ timeout: 600_000 });
    await expect(importForm.locator('.attribution-label.llm')).toBeVisible();

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'route-import-147-ui-1-scaffold-and-ollama-fill.png'), fullPage: true });

    const resultText = await importForm.locator('.command-result').innerText();
    console.log(`\n#147 UI (plan mode, --llm ollama) result:\n${resultText}`);
    expect(resultText).toContain('scaffolded');
  });
});
