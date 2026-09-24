import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// #109: Settings' per-capability provider is consumed by real run paths, and
// LLM use stays opt-in PER RUN. Runs against real servers (pick free ports
// with E2E_CLIENT_PORT / E2E_SERVER_PORT, see ui/README.md) and a REAL local
// ollama and claude CLI; nothing is mocked. Real LLM calls are slow (a cold
// ollama 7b call alone can take ~2 min), hence the long per-test timeout.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.resolve(__dirname, '../screenshots');
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
const CLI_BIN = path.resolve(__dirname, '../../../packages/cli/construct.mjs');
const API = process.env.E2E_API_BASE || 'http://localhost:4000';

test.describe.configure({ timeout: 240_000 });

async function setProviders(request, llmProviders) {
  const res = await request.post(`${API}/api/settings`, { data: { llmProviders } });
  expect(res.ok()).toBeTruthy();
}

function createForm(page) {
  return page.locator('.command-form', { has: page.getByRole('heading', { name: 'Create', exact: true }) });
}

async function fillSingleLayerCreate(page, name) {
  const form = createForm(page);
  await form.getByLabel('What to scaffold').selectOption('single');
  await form.getByPlaceholder('e.g. CpoAccess').fill(name);
  await form.getByPlaceholder('e.g. cpo-v2').fill('pricing');
  await form.locator('select').nth(1).selectOption('domain');
  return form;
}

test.describe.serial('#109 Settings LLM providers are consumed, opt-in per run', () => {
  let projectDir;
  let routeDir;
  let original; // the server's settings before this suite, restored afterwards so later specs (smoke, ...) don't inherit a deleted tmp dir

  test.beforeAll(async ({ request }) => {
    original = await (await request.get(`${API}/api/settings`)).json();
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-settings-llm-'));
    execFileSync('node', [CLI_BIN, 'init', projectDir]);
    execFileSync('node', [CLI_BIN, 'create', 'feature', 'pricing', '--dir', projectDir]);
    routeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-settings-llm-route-'));
    fs.writeFileSync(path.join(routeDir, 'page.tsx'), 'import { discountLabel } from "./discount";\nexport default function Page() { return <p>{discountLabel(10)}</p>; }\n');
    fs.writeFileSync(path.join(routeDir, 'discount.ts'), 'export function discountLabel(pct: number) {\n  return pct > 0 ? `${pct}% off` : "";\n}\n');
  });

  test.afterAll(async ({ request }) => {
    await request.post(`${API}/api/settings`, { data: { projectDir: original.projectDir, llmProviders: original.llmProviders } });
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(routeDir, { recursive: true, force: true });
  });

  test('Create form: checkbox OFF makes zero LLM calls even though Settings has createFill=ollama', async ({ page, request }) => {
    const res = await request.post(`${API}/api/settings`, { data: { projectDir, llmProviders: { createFill: 'ollama' } } });
    expect(res.ok()).toBeTruthy();
    await page.goto('/dashboard');
    const form = await fillSingleLayerCreate(page, 'PlainStub');
    await expect(form.getByLabel(/Have the LLM write the implementation/)).not.toBeChecked();
    await form.getByRole('button', { name: 'Run create' }).click();
    await expect(form.locator('.command-output')).toContainText('Created features/pricing/domain/PlainStub.tsx', { timeout: 15_000 });
    await expect(form.locator('.command-output')).not.toContainText('LLM-filled');
    await expect(form.locator('.command-result')).toContainText('0 calls');
    const content = fs.readFileSync(path.join(projectDir, 'features/pricing/domain/PlainStub.tsx'), 'utf8');
    expect(content).toBe('export function PlainStub() {\n  return true;\n}\n');
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'settings-llm-create-off.png'), fullPage: true });
  });

  test('Create form: checkbox ON uses the Settings createFill provider (ollama, real)', async ({ page }) => {
    await page.goto('/dashboard');
    const form = await fillSingleLayerCreate(page, 'OllamaFilled');
    await form.getByLabel(/Have the LLM write the implementation/).check();
    await form.getByRole('button', { name: 'Run create' }).click();
    await expect(form.locator('.command-result')).toContainText('via "ollama"', { timeout: 200_000 });
    await expect(form.locator('.command-output')).toContainText('OllamaFilled.tsx');
    const content = fs.readFileSync(path.join(projectDir, 'features/pricing/domain/OllamaFilled.tsx'), 'utf8');
    console.log(`\nollama-written OllamaFilled.tsx:\n${content}`);
    expect(content).toContain('OllamaFilled');
    expect(content).not.toBe('export function OllamaFilled() {\n  return true;\n}\n');
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'settings-llm-create-on-ollama.png'), fullPage: true });
  });

  test('Changing Settings createFill to claude changes which provider the next create uses (real claude)', async ({ page, request }) => {
    await setProviders(request, { createFill: 'claude' });
    await page.goto('/dashboard');
    const form = await fillSingleLayerCreate(page, 'ClaudeFilled');
    await form.getByLabel(/Have the LLM write the implementation/).check();
    await form.getByRole('button', { name: 'Run create' }).click();
    await expect(form.locator('.command-result')).toContainText('via "claude"', { timeout: 120_000 });
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'settings-llm-create-on-claude.png'), fullPage: true });
  });

  test('Import form: no ad-hoc provider field; checkbox ON uses Settings importFill (ollama)', async ({ page, request }) => {
    await setProviders(request, { importFill: 'ollama' });
    const oldFile = path.join(routeDir, 'discount.ts');
    await page.goto('/dashboard');
    const form = page.locator('.command-form', { has: page.getByRole('heading', { name: 'Import (non-interactive)' }) });
    await form.getByLabel('Name', { exact: true }).fill('DiscountLabel');
    await form.getByLabel('Feature', { exact: true }).fill('pricing');
    await form.locator('.layer-checkboxes .checkbox', { hasText: 'domain' }).locator('input[type="checkbox"]').check();
    await form.getByLabel('From (path to the old source file)').fill(oldFile);
    await expect(form.getByRole('textbox', { name: 'Provider' })).toHaveCount(0);
    await form.getByLabel(/Have the LLM write the ported logic/).check();
    await form.getByRole('button', { name: 'Run import' }).click();
    await expect(form.locator('.command-result')).toContainText('via "ollama"', { timeout: 200_000 });
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'settings-llm-import-ollama.png'), fullPage: true });
  });

  test('planAnalysis can never be ollama: API rejects it and the Settings dropdown does not offer it', async ({ page, request }) => {
    const res = await request.post(`${API}/api/settings`, { data: { llmProviders: { planAnalysis: 'ollama' } } });
    expect(res.status()).toBeGreaterThanOrEqual(400);
    await page.goto('/settings');
    const options = await page.locator('#llm-planAnalysis option').allTextContents();
    expect(options.join(' ')).not.toContain('ollama');
    const importOptions = await page.locator('#llm-importFill option').allTextContents();
    expect(importOptions.join(' ')).toContain('ollama');
    await expect(page.getByText('Writes the ported logic when you ask for it on an import')).toBeVisible();
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'settings-llm-settings-page.png'), fullPage: true });
  });

  test('Wizard: analysis on planAnalysis (claude), per-file fill on Settings importFill (ollama)', async ({ page, request }) => {
    const s = await request.post(`${API}/api/settings`, { data: { projectDir, llmProviders: { planAnalysis: 'claude', importFill: 'ollama' } } });
    expect(s.ok()).toBeTruthy();
    await page.goto('/wizard');
    await expect(page.locator('h1')).toHaveText('Import Route Wizard');
    await page.getByPlaceholder('/v2/home').fill(routeDir);
    await page.getByRole('button', { name: 'Start wizard session' }).click();
    const answer = async (text) => {
      const input = page.locator('.chat-input input');
      await expect(input).toBeVisible({ timeout: 120_000 });
      if (text) await input.fill(text);
      await page.getByRole('button', { name: 'Send' }).click();
    };
    await expect(page.locator('.chat-question').last()).toContainText('Destination feature');
    await answer('wizpricing');
    await expect(page.locator('.chat-question').last()).toContainText('Another route to include');
    await answer('');
    await expect(page.locator('.chat-question').last()).toContainText('LLM also write the ported logic');
    await answer('y');
    await expect(page.locator('.chat-question').last()).toContainText('Approve this plan', { timeout: 180_000 });
    await expect(page.locator('.chat')).toContainText('Analyzing via "claude"');
    await answer('y');
    await expect(page.locator('.chat')).toContainText('via "ollama"', { timeout: 240_000 });
    await expect(page.locator('.chat-system').last()).toContainText('Session finished', { timeout: 60_000 });
    await page.locator('.chat').evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'settings-llm-wizard.png'), fullPage: true });
  });
});
