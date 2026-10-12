import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gotoCockpit } from './support/cockpit.js';
import { openProject } from './support/browseProject.js';
import { runAxe, isBlocking, format } from './support/axe.js';
import { createMemory } from '../../../packages/engine/line/memory/index.mjs';

// "What Line knows", Memory tab, on the real server and im3's real store: a copy of examples/line-sample with four
// remembered decisions. The tab shows them in plain words; forgetting one record removes it from the screen AND from
// <state>/memory/drafter.route.jsonl; the log says so. Axe passes on the tab. Fails on any console error or 4xx/5xx.
//   E2E_CLIENT_PORT=3397 E2E_SERVER_PORT=4397 npx playwright test -c playwright.line-knows-memory.config.js --workers=1
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = path.resolve(__dirname, '../../../examples/line-sample');
const API = process.env.E2E_API_BASE || `http://localhost:${process.env.E2E_SERVER_PORT || 4000}`;
const PROPOSAL = { intent: 'use.item', structure: null, slots: ['F:feature'], neighbourhood: [], options: ['via-library:ui:I>F', 'base-on:ui:L>F'], proposed: 'via-library:ui:I>F' };

test('Memory tab: what Line remembered in plain words; forget one record and it is gone from the screen and the store', async ({ page }) => {
  test.setTimeout(120_000);
  const base = fs.realpathSync(fs.mkdtempSync(path.join(process.env.E2E_WORKSPACE_ROOT ?? os.tmpdir(), 'line-knows-memory-')));
  fs.cpSync(SAMPLE, base, { recursive: true });
  const mem = createMemory(base, { words: [] });
  for (let i = 0; i < 3; i++) await mem.recordOutcome('drafter.route', PROPOSAL, { kind: 'picked', chosen: 'via-library:ui:I>F', by: 'person' });
  await mem.recordOutcome('drafter.route', PROPOSAL, { kind: 'picked', chosen: 'base-on:ui:L>F', by: 'person' });
  const memFile = path.join(base, 'line/memory/drafter.route.jsonl');
  const restore = await openProject(API, base);
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()} (${m.location()?.url})`); });
  page.on('response', (r) => { if (r.status() >= 400) problems.push(`${r.status()} ${r.url()}`); });
  try {
    await gotoCockpit(page, '/knows?tab=memory');
    const tab = page.getByTestId('knows-memory');
    await expect(tab.getByTestId('memory-record')).toHaveCount(4, { timeout: 30_000 });
    await expect(tab.getByTestId('memory-summary').filter({ hasText: "You picked 'via the library' 3 times for 'use item'." })).toHaveCount(1);
    await expect(tab.getByRole('switch', { name: /Embeddings/ })).toHaveAttribute('aria-checked', 'false');
    // #871: the help never claims comparisons from the switch alone; they need a measured win (the API's `runs`).
    await expect(tab.locator('#lkm-embed-help')).toHaveText(/^Off by default\. When on, and once it measures a win/);

    const axe = await runAxe(page, { include: '[data-testid="knows-memory"]' });
    expect(axe.filter(isBlocking), format(axe.filter(isBlocking))).toEqual([]);

    // Forget the one 'a new item based on the library' decision.
    const target = tab.locator('[data-testid="memory-record"]').filter({ hasText: "You picked 'a new item based on the library'" });
    await expect(target).toHaveCount(1);
    const id = await target.getAttribute('data-id');
    expect(id).toMatch(/^m-/);
    await target.getByRole('button', { name: /^Forget this decision/ }).click();
    await expect(tab.getByTestId('memory-message')).toHaveText('Line forgot that decision.');
    await expect(tab.locator(`[data-testid="memory-record"][data-id="${id}"]`)).toHaveCount(0);
    await expect(tab.getByTestId('memory-record')).toHaveCount(3);

    // Gone from the store too, and logged as a person's act.
    const left = fs.readFileSync(memFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(left).toHaveLength(3);
    expect(left.some((r) => r.id === id)).toBe(false);
    await expect(tab.getByTestId('memory-log')).toContainText(`You forgot one decision (${id})`);

    // After a reload it stays gone.
    await page.reload();
    await expect(page.getByTestId('knows-memory').getByTestId('memory-record')).toHaveCount(3, { timeout: 30_000 });
    expect(problems, problems.join('\n')).toEqual([]);
  } finally {
    await restore?.();
    fs.rmSync(base, { recursive: true, force: true });
  }
});
