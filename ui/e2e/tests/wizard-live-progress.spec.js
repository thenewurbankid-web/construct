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
    // A small Next.js-shaped tree for the path picker (#600).
    fs.mkdirSync(path.join(tmpProjectDir, 'src/app/[locale]/portfolio'), { recursive: true });
    fs.mkdirSync(path.join(tmpProjectDir, 'src/app/[locale]/plain'), { recursive: true });
    fs.writeFileSync(path.join(tmpProjectDir, 'src/app/[locale]/portfolio/page.tsx'), 'export default function P() { return null; }\n');
    fs.writeFileSync(path.join(tmpProjectDir, 'src/app/[locale]/plain/notes.txt'), 'x');
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
          send({ type: 'step', phase: 'tracing', detail: { routes: ['/en/portfolio-health'] }, reason: 'Follows the real import statements from the route entry file.' });
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

    // The framework explains itself: a step's reason shows under it, in the framework's own voice.
    await expect(page.locator('.chat-step .chat-reason').first()).toContainText('Follows the real import statements');

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

  // #605: the start panel lets the user pick the mechanical planner; the choice is sent with `start`.
  test('the planner choice is sent with the start message (AI by default, mechanical when selected)', async ({ page }) => {
    const starts = [];
    await page.routeWebSocket('**/ws/wizard', (ws) => {
      ws.onMessage((raw) => {
        const msg = JSON.parse(String(raw));
        if (msg.type === 'start') starts.push(msg);
      });
    });

    await page.goto('/wizard');
    const planner = page.getByTestId('wizard-planner');
    await expect(planner).toHaveValue('ai');
    await planner.selectOption('mechanical');
    await page.getByRole('button', { name: 'Start wizard session' }).click();
    await expect.poll(() => starts.length).toBe(1);
    expect(starts[0].planner).toBe('mechanical');
  });
  // #600: a question that wants a route offers "Browse project…"; the picker lists only the open project, marks
  // routes, refuses a folder with no page, and the picked path becomes the answer.
  test('the route question offers a project picker that fills the answer with a real route folder', async ({ page }) => {
    const answers = [];
    await page.routeWebSocket('**/ws/wizard', (ws) => {
      ws.onMessage((raw) => {
        const msg = JSON.parse(String(raw));
        if (msg.type === 'start') ws.send(JSON.stringify({ type: 'question', text: 'Route to import: ', expects: 'route' }));
        if (msg.type === 'answer') answers.push(msg.text);
      });
    });

    await page.goto('/wizard');
    await page.getByRole('button', { name: 'Start wizard session' }).click();
    await page.getByRole('button', { name: 'Browse project…' }).click();

    const picker = page.getByTestId('project-picker');
    await picker.getByRole('button', { name: 'src/' }).click();
    await picker.getByRole('button', { name: 'app/' }).click();
    await picker.getByRole('button', { name: '[locale]/' }).click();
    await expect(picker.getByRole('button', { name: /^portfolio\/\s*route$/ })).toBeVisible();
    await expect(picker.getByText('no page file here')).toBeVisible();
    await expect(picker.getByRole('button', { name: 'Use src/app/[locale]/plain' })).toHaveCount(0);

    await picker.getByRole('button', { name: 'Use src/app/[locale]/portfolio' }).click();
    await expect(picker).toHaveCount(0);
    await expect(page.getByPlaceholder('Type your answer…')).toHaveValue('src/app/[locale]/portfolio');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect.poll(() => answers).toEqual(['src/app/[locale]/portfolio']);
  });
});
