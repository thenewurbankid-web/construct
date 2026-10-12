import { test, expect } from '@playwright/test';
import { gotoCockpit } from './support/cockpit.js';
import { runAxe, isBlocking, format } from './support/axe.js';
import { startUnderTheHood } from './support/lineModes.js';

// Two modes: this spec checks the screen's regular view, so it starts Under the hood (screens open in Chat by default).
startUnderTheHood(test);

// Line cu2: one AI layer. Settings lists every AI step (Cockpit's fills, Trace's tasks, Construct's chooser and fix
// picker) from Line's one profile set, read-only: what the step does, its model (the 1.5B by default), how it decides
// (static first; the picker only where the step is on with a measured win), its win or "off", and that it falls back to
// static. Real server, no mock, no model call. The owner's walk (merged here from uat/cu2.spec.js): two clicks from the
// profile menu, every step in plain sentences, one step's Details, no console error and no failed request.
const API = process.env.E2E_API_BASE || 'http://localhost:4000';

test('GET /api/line/ai-profiles answers every step with the 1.5B as the default model', async ({ request }) => {
  const r = await request.get(`${API}/api/line/ai-profiles`);
  expect(r.status()).toBe(200);
  const body = await r.json();
  expect(body.defaultModel).toBe('qwen2.5-coder:1.5b');
  const steps = body.profiles.map((p) => p.step);
  for (const s of ['cockpit.importFill', 'cockpit.createFill', 'trace.choose', 'construct.chooser', 'construct.fix', 'construct.repair']) expect(steps).toContain(s);
  expect(steps).not.toContain('cockpit.planAnalysis');
  const on = Object.fromEntries(body.profiles.map((p) => [p.step, [p.on, p.win]]));
  expect(on['construct.fix'][0]).toBe(true);
  expect(on['construct.chooser']).toEqual([false, 'off']);
  for (const p of body.profiles) expect(p.fallback).toBe('static');
});

test('Settings shows the AI steps read-only: plain English first, the model, how it decides, technical detail under Details', async ({ page }) => {
  await gotoCockpit(page, '/settings');
  const panel = page.getByTestId('ai-steps');
  await expect(panel).toBeVisible({ timeout: 30_000 });
  await expect(panel.getByRole('heading', { name: 'AI steps' })).toBeVisible();
  await expect(panel.getByTestId('ai-steps-status')).toHaveText(/^(jev and the ladder|.*static path\.$)/);

  const choose = panel.locator('[data-testid="ai-step"][data-step="trace.choose"]');
  await expect(choose).toContainText('Picks where one part of a page gets its data from');
  await expect(choose.getByTestId('ai-step-model')).toHaveText("Model: qwen2.5-coder:1.5b (Line's default)");
  await expect(choose).toContainText('Off: static checks decide');
  await expect(choose.getByTestId('ai-step-win')).toHaveText('Win over static: off');
  // The step id sits in a collapsed Details until asked for.
  await expect(choose.getByText('Step id: trace.choose')).toBeHidden();
  await choose.getByText('Details').click();
  await expect(choose.getByText('Step id: trace.choose')).toBeVisible();

  const fix = panel.locator('[data-testid="ai-step"][data-step="construct.fix"]');
  await expect(fix.getByTestId('ai-step-win')).toContainText('9/10');
  // Read-only: nothing in the panel can be edited.
  await expect(panel.locator('input, select, textarea, button')).toHaveCount(0);

  const found = await runAxe(page, { include: '[data-testid="ai-steps"]' });
  expect(found.filter(isBlocking), format(found.filter(isBlocking))).toEqual([]);
});

test('owner walk: two clicks from the profile menu; every step in plain sentences with its model and fallback; Details on one', async ({ page }) => {
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  page.on('response', (r) => { if (r.status() >= 400) problems.push(`${r.status()} ${r.url()}`); });
  await gotoCockpit(page, '/');
  await page.getByTestId('user-menu-trigger').click();
  await page.getByTestId('profile-settings').click();
  const panel = page.getByTestId('ai-steps');
  await expect(panel).toBeVisible({ timeout: 30_000 });
  const steps = panel.getByTestId('ai-step');
  await expect(steps.first()).toBeVisible({ timeout: 30_000 });
  expect(await steps.count()).toBeGreaterThanOrEqual(10);
  for (const s of await steps.all()) {
    expect((await s.locator('.ais-label').innerText()).trim()).toMatch(/^[A-Z].*\.$/);
    expect((await s.locator('.ais-how').innerText()).trim()).toMatch(/^[A-Z].*\.$/);
    // #871: memory embeddings are one step too, on an embedding model (the only local step not on the 1.5B).
    const embed = (await s.getAttribute('data-step')) === 'construct.memory-embed';
    await expect(s.getByTestId('ai-step-model')).toHaveText(embed ? 'Model: nomic-embed-text (an embedding model, chosen for this step)' : /^Model: (qwen2\.5-coder:1\.5b \(Line's default\)|The hosted model you choose)$/);
    await expect(s.getByTestId('ai-step-win')).toHaveText(/^Win over static: /);
    // #871: embeddings are a recall step, never described as a picker.
    if (embed) await expect(s.locator('.ais-how')).toHaveText(/^Off until it measures a win: Line recalls past decisions without a model/);
  }
  const chooser = panel.locator('[data-testid="ai-step"][data-step="construct.chooser"]');
  await chooser.getByText('Details').click();
  await expect(chooser.getByText('Reply cap: 800 tokens')).toBeVisible();
  expect(problems, problems.join('\n')).toEqual([]);
});
