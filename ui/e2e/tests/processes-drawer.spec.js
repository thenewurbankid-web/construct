import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// #292 — the Processes drawer, driven against a real process engine.
//
// Run with playwright.processes.config.js: it starts ui/server with a fake
// step executor and two test-only routes (support/processes-server.mjs), so a
// process here is genuinely running / paused / cancelled / failed in the real
// engine and store, and everything the page shows arrives through the real
// REST routes and the real /ws/processes socket. Starting a process from the
// UI is Plan mode (#289), which is not built, hence the harness route.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(__dirname, '../screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const API = process.env.E2E_API_BASE || 'http://localhost:4000';

const drawer = (page) => page.getByRole('region', { name: 'Drawer' });
const shot = (page, name) => drawer(page).screenshot({ path: path.join(SHOTS, `292-${name}.png`) });

async function create(request, options = {}) {
  const res = await request.post(`${API}/__test/create`, { data: options });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).id;
}
async function release(request, id, step) {
  await expect.poll(async () => {
    const waiting = (await (await request.get(`${API}/__test/waiting`)).json()).waiting;
    return waiting.includes(`${id}:${step}`);
  }, { message: `step ${step} to be in flight` }).toBe(true);
  expect((await request.post(`${API}/__test/release`, { data: { id, step } })).ok()).toBeTruthy();
}
async function openProcesses(page) {
  await page.getByTestId('pill-processes').click();
  await expect(drawer(page)).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Processes' })).toHaveAttribute('aria-selected', 'true');
}
const stateOf = (page) => page.getByTestId('process-state');
const buttonNames = async (page) => page.getByRole('group', { name: 'Process controls' }).getByRole('button').allTextContents();

test.describe.serial('Processes drawer (#292)', () => {
  test('with nothing running the pill says 0 and the drawer says so', async ({ page }) => {
    await page.goto('/help');
    await expect(page.getByTestId('pill-processes')).toHaveText('Processes: 0');
    await openProcesses(page);
    await expect(page.getByTestId('processes-empty')).toContainText('No processes running');
  });

  test('a running process: real count, steps tagged by who does them, log streaming, pause and resume', async ({ page, request }) => {
    await page.goto('/help');
    await openProcesses(page);
    const id = await create(request);

    // The top-bar pill is the real running count, live, with the drawer open.
    await expect(page.getByTestId('pill-processes')).toHaveText('Processes: 1');
    await expect(page.getByTestId('process-row')).toHaveCount(1);
    await expect(stateOf(page)).toHaveText('Running');

    // The plan's steps, each tagged Deterministic / Local model / You.
    const steps = page.getByTestId('process-step');
    await expect(steps).toHaveCount(3);
    await expect(steps.nth(0)).toContainText('Deterministic');
    await expect(steps.nth(2)).toContainText('Local model');
    await expect(steps.nth(0)).toHaveAttribute('data-status', 'running');
    await expect(steps.nth(1)).toHaveAttribute('data-status', 'pending');

    // The controls are exactly what the machine offers while running.
    expect(await buttonNames(page)).toEqual(['Pause', 'Cancel']);

    // The log streams in with an ok badge for the step that started.
    await expect(page.locator('[data-testid="process-log"] [data-provenance="ok"]').first()).toContainText('started');
    await shot(page, '1-running');

    // Pause is cooperative: the state says so, and settles once the step yields.
    await page.getByTestId('process-pause').click();
    await expect(stateOf(page)).toHaveText('Pausing after the current step');
    await release(request, id, 'feature');
    await expect(stateOf(page)).toHaveText('Paused');
    expect(await buttonNames(page)).toEqual(['Resume', 'Cancel']);
    await expect(page.getByTestId('pill-processes')).toHaveText('Processes: 0');
    await expect(steps.nth(0)).toHaveAttribute('data-status', 'done');
    await expect(page.locator('[data-testid="process-log"]')).toContainText('block finished');
    await shot(page, '2-paused');

    // A reload does not lose it: the server remembers, the drawer reads it back.
    await page.reload();
    await openProcesses(page);
    await expect(page.getByTestId('process-row')).toHaveCount(1);
    await expect(stateOf(page)).toHaveText('Paused');

    // Resume runs the rest; the local-model step shows an llm badge and an artifact awaiting approval.
    await page.getByTestId('process-resume').click();
    await expect(stateOf(page)).toHaveText('Running');
    await release(request, id, 'domain');
    await release(request, id, 'fill');
    await expect(stateOf(page)).toHaveText('Done');
    await expect(page.locator('[data-testid="process-log"] [data-provenance="llm"]').filter({ hasText: 'qwen2.5-coder' })).toHaveCount(1);
    await expect(steps.nth(2)).toContainText('Model: ollama, 2 call(s)');
    expect(await buttonNames(page)).toEqual([]);

    const artifact = page.getByTestId('process-artifact');
    await expect(artifact).toContainText('features/checkout/services/Totals.ts');
    await expect(artifact).toContainText('Awaiting approval');
    // Read-only by construction: nothing in the drawer can apply or approve a file.
    await expect(drawer(page).getByRole('button', { name: /approve|apply|accept|reject/i })).toHaveCount(0);
    await shot(page, '3-done-artifacts');
  });

  test('cancel stops a running process and leaves nothing to click but the record', async ({ page, request }) => {
    await page.goto('/help');
    await openProcesses(page);
    await create(request, { title: 'Cancel me' });
    await expect(page.getByTestId('process-row').first()).toContainText('Cancel me');
    await expect(stateOf(page)).toHaveText('Running');
    await page.getByTestId('process-cancel').click();
    await expect(stateOf(page)).toHaveText('Cancelled');
    expect(await buttonNames(page)).toEqual([]);
    await expect(page.getByTestId('pill-processes')).toHaveText('Processes: 0');
    await shot(page, '4-cancelled');
  });

  test('a failed process offers Retry, the failure is a warn line, and retry runs it to the end', async ({ page, request }) => {
    await page.goto('/help');
    await openProcesses(page);
    const id = await create(request, { title: 'Flaky plan', failOnce: true });
    await expect(page.getByTestId('process-row').first()).toContainText('Flaky plan');
    await release(request, id, 'feature');
    await expect(stateOf(page)).toHaveText('Failed');
    expect(await buttonNames(page)).toEqual(['Retry', 'Cancel']);
    await expect(page.locator('[data-testid="process-log"] [data-provenance="warn"]').first()).toBeVisible();
    await expect(page.getByTestId('process-step').first()).toContainText('could not be scaffolded');
    await shot(page, '5-failed-retry');

    await page.getByTestId('process-retry').click();
    await expect(stateOf(page)).toHaveText('Running');
    await release(request, id, 'feature');
    await release(request, id, 'domain');
    await release(request, id, 'fill');
    await expect(stateOf(page)).toHaveText('Done');
  });

  test('a refused control is shown as the server refused it, not hidden', async ({ page, request }) => {
    await page.goto('/help');
    await openProcesses(page);
    // The list is newest first; ask the server to cancel something already cancelled.
    const list = await (await request.get(`${API}/api/processes`)).json();
    const cancelled = list.processes.find((p) => p.state === 'cancelled');
    const res = await request.post(`${API}/api/processes/${cancelled.id}/pause`);
    expect(res.status()).toBe(409);
    expect((await res.json()).error).toMatch(/does not accept pause/);
  });

  test('the light theme reads just as well', async ({ page }) => {
    await page.goto('/help');
    await page.getByRole('banner').getByTestId('theme-toggle').click();
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('light');
    await openProcesses(page);
    await expect(page.getByTestId('process-row').first()).toBeVisible();
    await shot(page, '6-light');
    await page.screenshot({ path: path.join(SHOTS, '292-7-light-full.png') });
  });
});
