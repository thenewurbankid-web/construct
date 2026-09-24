import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.resolve(__dirname, '../screenshots');
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
const API_BASE = process.env.E2E_API_BASE || 'http://localhost:4000';

// #599: while the Import Wizard runs, the framework's blocks are listed in order in a right-hand
// panel with the current one highlighted, the model's own streamed output is shown separately from
// the framework's step markers, and a Cancel control stops the run. The socket is mocked so the
// test can send real `step` and `thought` events deterministically (the real events come from
// packages/core/cli.mjs; that path is covered by the node tests and a live-Ollama check).
test.describe('Import Wizard live progress (#599)', () => {
  let tmpProjectDir;

  // The whole UI is gated until a project is open (#365), same setup as wizard-blank-answer.spec.js.
  test.beforeAll(async ({ request }) => {
    tmpProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-ui-e2e-wizard-live-'));
    const settingsRes = await request.post(`${API_BASE}/api/settings`, { data: { projectDir: tmpProjectDir } });
    expect(settingsRes.ok()).toBeTruthy();
    const initRes = await request.post(`${API_BASE}/api/init`);
    expect(initRes.ok()).toBeTruthy();
  });

  test.afterAll(() => {
    fs.rmSync(tmpProjectDir, { recursive: true, force: true });
  });

  test('blocks in order with the current one highlighted; model thoughts stream and stay distinct from framework steps; Cancel is sent', async ({ page }) => {
    const received = [];
    let send;
    await page.routeWebSocket('**/ws/wizard', (ws) => {
      send = (event) => ws.send(JSON.stringify(event));
      ws.onMessage((raw) => {
        const msg = JSON.parse(String(raw));
        received.push(msg);
        if (msg.type === 'start') {
          send({ type: 'step', phase: 'tracing', detail: { routes: ['/en/portfolio-health'] } });
          send({ type: 'step', phase: 'analyzing', detail: { provider: 'claude', files: 4 } });
          send({ type: 'step', phase: 'filling', detail: { unit: 'Health', file: 'features/health/controllers/HealthController.tsx', layer: 'controller', index: 1, total: 3 } });
          send({ type: 'thought', text: 'Porting the data ' });
        }
      });
    });

    await page.goto('/wizard');
    await page.getByRole('button', { name: 'Start wizard session' }).click();

    // The blocks panel lists every framework block in run order.
    const tracker = page.getByRole('complementary', { name: 'Import blocks' });
    const items = tracker.locator('li');
    await expect(items).toHaveCount(7);
    await expect(items.nth(0)).toContainText('Trace route files');
    await expect(items.nth(4)).toContainText('Model fills each file');

    // The current block is highlighted (and announced), earlier ones are done, later ones pending.
    const active = tracker.locator('li[aria-current="step"]');
    await expect(active).toHaveCount(1);
    await expect(active).toHaveAttribute('data-phase', 'filling');
    await expect(active).toContainText('Filling features/health/controllers/HealthController.tsx (1/3)');
    await expect(items.nth(0)).toHaveClass(/--done/);
    await expect(items.nth(1)).toHaveClass(/--done/);
    await expect(items.nth(2)).toHaveClass(/--skipped/); // plan approval was never asked in this run
    await expect(items.nth(5)).toHaveClass(/--pending/);

    // The model's output streams into ONE message as pieces arrive, not one message per piece.
    const thought = page.locator('.chat-thought');
    await expect(thought).toHaveCount(1);
    await expect(thought).toContainText('Porting the data');
    send({ type: 'thought', text: 'layer into the controller.' });
    await expect(thought).toContainText('Porting the data layer into the controller.');
    await expect(thought).toHaveCount(1);

    // Framework steps and model thoughts are told apart by label AND by style, not colour alone.
    const step = page.locator('.chat-step').first();
    await expect(step.locator('.chat-badge')).toHaveText('Framework');
    await expect(thought.locator('.chat-badge')).toHaveText('Model');
    const styleOf = (loc) => loc.evaluate((el) => ({ fontStyle: getComputedStyle(el).fontStyle, border: getComputedStyle(el).borderTopStyle }));
    expect((await styleOf(thought)).fontStyle).toBe('italic');
    expect((await styleOf(thought)).border).toBe('dashed');
    expect((await styleOf(step)).fontStyle).toBe('normal');
    expect((await styleOf(step)).border).not.toBe('dashed');

    // A new framework step ends the thought stream: the next thought opens a new message.
    send({ type: 'step', phase: 'validating', detail: { feature: 'health' } });
    await expect(tracker.locator('li[aria-current="step"]')).toHaveAttribute('data-phase', 'validating');
    await expect(items.nth(4)).toHaveClass(/--done/);
    send({ type: 'thought', text: 'second stream' });
    await expect(page.locator('.chat-thought')).toHaveCount(2);

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'wizard-live-progress.png'), fullPage: true });

    // Cancel is offered while the run is live, sends a cancel message, and shows it registered.
    const cancel = tracker.getByRole('button', { name: 'Cancel' });
    await expect(cancel).toBeVisible();
    await cancel.click();
    await expect.poll(() => received.some((m) => m.type === 'cancel')).toBe(true);
    await expect(tracker.getByRole('button', { name: 'Cancelling…' })).toBeDisabled();

    // The server reports the cancel: the active block shows cancelled, the rest were skipped.
    send({ type: 'step', phase: 'cancelled', detail: { during: 'filling' } });
    send({ type: 'done' });
    await expect(tracker.locator('li[aria-current="step"]')).toHaveCount(0);
    await expect(items.nth(5)).toHaveClass(/--cancelled/);
    await expect(items.nth(6)).toHaveClass(/--skipped/);
    await expect(tracker.getByRole('button', { name: /Cancel/ })).toHaveCount(0);
  });
});
