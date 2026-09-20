import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// #252 -- the shell fires one `construct validate` as soon as the project
// resolves, and on a busy machine its result lands seconds later, while the
// user is already doing something. The rule this spec enforces is the same one
// #248 and #247 arrived at from the other side: an async result must never move
// or refocus something the user is interacting with.
//
// Stated as a layout invariant, because that is the form that cannot itself
// break an interaction (a timing gate can -- d8af847's pointer-down deferral
// was reverted in 97b1e67 for exactly that):
//
//   a background result may change what the shell's status readouts SAY;
//   it may never change how much ROOM they take.
//
// So these tests hold /api/validate open, drive a real interaction, release the
// result at a chosen moment, and assert that nothing outside the result panel
// itself moved by a single pixel.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(__dirname, '../screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const API = process.env.E2E_API_BASE || 'http://localhost:4000';

const v = (rule, severity, file) => ({ rule, module: 'slice', severity, file, line: 1, message: `${rule} was violated` });
const result = (violations) => ({ ok: true, total: violations.length, truncated: false, durationMs: 1234, violations });

const THREE = result([
  v('SLICE-001', 'error', 'features/demo/hooks/useThing.tsx'),
  v('PAGE-006', 'error', 'features/demo/pages/DemoPage.tsx'),
  v('HOOK-002', 'warning', 'features/demo/hooks/useThing.tsx'),
]);

/**
 * Takes over /api/validate so the landing moment is chosen, not raced.
 * Each queued run is released by one `release()` call, and `bodies` supplies
 * the result for the 1st, 2nd, ... run in turn (the last one repeats).
 */
async function holdValidate(page, bodies = [THREE]) {
  const held = []; // runs that have arrived and are waiting
  let credits = 0; // release() calls that arrived before their run did
  let n = 0;
  const pump = () => {
    while (credits > 0 && held.length) {
      credits -= 1;
      held.shift()();
    }
  };
  await page.route('**/api/validate*', async (route) => {
    const i = n++;
    await new Promise((resolve) => {
      held.push(resolve);
      pump();
    });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(bodies[Math.min(i, bodies.length - 1)]) });
  });
  return () => {
    credits += 1;
    pump();
  };
}

/**
 * Every control the user can aim at, by exact geometry. The result panel itself
 * is excluded on purpose -- that is where a validate result is SUPPOSED to
 * appear, and it is the one region the user asked to watch change.
 */
const controls = (page) =>
  page.evaluate(() => {
    const out = {};
    for (const el of document.querySelectorAll('button, a[href], [role="tab"], input, [role="separator"]')) {
      if (el.closest('[role="tabpanel"]')) continue;
      const r = el.getBoundingClientRect();
      const key = el.getAttribute('data-testid') || el.dataset.tabId || el.getAttribute('aria-label') || el.textContent.trim().slice(0, 24) || el.tagName;
      out[key] = `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`;
    }
    return out;
  });

/** Readable diff so a failure names the control that moved, not just "not equal". */
function movements(before, after) {
  const moved = [];
  for (const k of Object.keys(before)) if (k in after && after[k] !== before[k]) moved.push(`${k}: ${before[k]} -> ${after[k]}`);
  for (const k of Object.keys(after)) if (!(k in before)) moved.push(`${k}: appeared at ${after[k]}`);
  for (const k of Object.keys(before)) if (!(k in after)) moved.push(`${k}: vanished from ${before[k]}`);
  return moved;
}

const checking = (page) => expect(page.getByTestId('status-validate')).toContainText('checking', { timeout: 20_000 });

test.describe('A background validate must not disturb what you are doing (#252)', () => {
  let base;
  let original;

  test.beforeAll(async ({ request }) => {
    original = (await (await request.get(`${API}/api/settings`)).json()).projectDir;
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'construct-252-')));
    const write = (rel, text) => {
      fs.mkdirSync(path.dirname(path.join(base, rel)), { recursive: true });
      fs.writeFileSync(path.join(base, rel), text);
    };
    write('architecture.yml', fs.readFileSync(path.resolve(__dirname, '../../client/architecture.yml'), 'utf8'));
    write('features/demo/hooks/useThing.tsx', 'export function useThing() { return 1; }\n');
    write('features/demo/pages/DemoPage.tsx', "import { useThing } from '../hooks/useThing';\n\nexport function DemoPage() {\n  useThing();\n  return <main><h1>Demo</h1></main>;\n}\n");
    const res = await request.post(`${API}/api/settings`, { data: { browseRoots: [base], projectDir: base } });
    expect(res.ok()).toBeTruthy();
  });

  test.afterAll(async ({ request }) => {
    await request.post(`${API}/api/settings`, { data: { browseRoots: [], projectDir: original } });
    fs.rmSync(base, { recursive: true, force: true });
  });

  // The defect this issue was filed for: with the drawer open, the count badge
  // arriving on the Diagnostics tab pushed Logs and Processes 26px to the right.
  test('the result landing moves nothing: the Logs and Processes tabs stay where you were reaching for them', async ({ page }) => {
    const release = await holdValidate(page);
    await page.goto('/help');
    await checking(page);
    await page.keyboard.press('Control+j');
    const drawer = page.getByRole('region', { name: 'Drawer' });
    await expect(drawer).toBeVisible();
    const logs = drawer.getByRole('tab', { name: 'Logs' });
    await expect(logs).toBeVisible();

    const before = await controls(page);
    const logsBox = await logs.boundingBox();
    // The room is reserved, but nothing is announced or shown yet: the slot is
    // aria-hidden and empty until there is a count, so the tab still reads just
    // "Diagnostics" and #249's badge locator finds nothing.
    const diagnostics = drawer.getByRole('tab', { name: /Diagnostics/ });
    await expect(diagnostics).toHaveText('Diagnostics');
    await expect(diagnostics.getByLabel(/Diagnostics$/)).toHaveCount(0);

    release();
    await expect(page.getByTestId('status-validate')).toContainText('3 problems', { timeout: 20_000 });
    await expect(drawer.getByTestId('diagnostic-row').first()).toBeVisible();
    await page.waitForTimeout(300); // let any late layout settle rather than sampling mid-frame

    // The result really did land and really is shown -- otherwise "nothing moved" is worthless.
    // The count and its label are #249's contract, kept by the reserved slot.
    await expect(diagnostics).toContainText('3');
    await expect(diagnostics.getByLabel(/Diagnostics$/)).toBeVisible();
    expect(movements(before, await controls(page))).toEqual([]);
    expect(await logs.boundingBox()).toEqual(logsBox);

    await page.screenshot({ path: path.join(SHOTS, '252-validate-landed-nothing-moved.png') });
  });

  // Half the jump came from tabBadge() blanking while a run is in flight, even
  // though the reducer deliberately keeps the previous result visible. A re-run
  // therefore moved the tabs twice: left on start, right on finish.
  test('re-running keeps the last known count, so the tabs do not jump out and back', async ({ page }) => {
    const release = await holdValidate(page, [THREE, result([v('SLICE-001', 'error', 'features/demo/hooks/useThing.tsx')])]);
    await page.goto('/help');
    await checking(page);
    await page.keyboard.press('Control+j');
    const drawer = page.getByRole('region', { name: 'Drawer' });
    await expect(drawer).toBeVisible();
    release();
    await expect(page.getByTestId('status-validate')).toContainText('3 problems', { timeout: 20_000 });
    await page.waitForTimeout(300);

    const settled = await controls(page);
    const badge = drawer.getByRole('tab', { name: /Diagnostics/ });
    await expect(badge).toContainText('3');

    // Kick a second run off from inside the panel and watch the whole cycle.
    await drawer.getByTestId('diagnostics-run').click();
    await expect(page.getByTestId('status-validate')).toContainText('checking', { timeout: 20_000 });
    await expect(badge).toContainText('3'); // the previous count stays while re-running
    expect(movements(settled, await controls(page))).toEqual([]);

    release();
    await expect(page.getByTestId('status-validate')).toContainText('1 problem', { timeout: 20_000 });
    await page.waitForTimeout(300);
    await expect(badge).toContainText('1');
    expect(movements(settled, await controls(page))).toEqual([]); // a 1 and a 3 take the same room
  });

  // The status readout is itself a click target ("Open Diagnostics"), and it is
  // the only thing the drawer-closed and narrow layouts show of a validate at all.
  test('the status readout changes what it says without changing its size, drawer closed and narrow', async ({ page }) => {
    for (const width of [1280, 700]) {
      await page.setViewportSize({ width, height: 800 });
      const release = await holdValidate(page);
      await page.goto('/help');
      await checking(page);
      await page.waitForTimeout(300);
      const before = await controls(page);
      const readout = page.getByTestId('status-validate');
      const box = await readout.boundingBox();

      release();
      await expect(readout).toContainText('3 problems', { timeout: 20_000 });
      await page.waitForTimeout(300);

      expect(movements(before, await controls(page)), `at ${width}px`).toEqual([]);
      expect(await readout.boundingBox(), `at ${width}px`).toEqual(box);
      await page.unrouteAll({ behavior: 'ignoreErrors' });
    }
  });

  // Not a reproduction -- a guard. These four were all measured to be correct
  // already; the point is that they stay correct, since they are the obvious
  // ways a later change could reintroduce this class of defect.
  test('guard: the result does not steal focus, scroll a pane, undo a pane toggle or reset the open palette', async ({ page }) => {
    const release = await holdValidate(page);
    await page.goto('/help');
    await checking(page);

    await page.keyboard.press('Control+b'); // the user collapses the Browser pane
    await expect(page.locator('#sh-pane-left')).toHaveCount(0);
    await page.getByTestId('palette-trigger').click();
    const dialog = page.getByRole('dialog', { name: 'Command palette' });
    await expect(dialog).toBeVisible();
    const input = dialog.getByRole('combobox', { name: 'Search commands' });
    await input.fill('toggle');
    await page.keyboard.press('ArrowDown');
    await page.evaluate(() => document.querySelectorAll('.cp-results').forEach((e) => (e.scrollTop = 24)));

    const snap = () =>
      page.evaluate(() => {
        const el = document.activeElement;
        const cp = document.querySelector('.cp-input');
        return {
          focused: el?.getAttribute('aria-label') ?? el?.getAttribute('data-testid') ?? el?.tagName ?? null,
          caret: el && 'selectionStart' in el ? el.selectionStart : null,
          scrolls: Array.from(document.querySelectorAll('.sh-tabpanel, .cp-results, .main')).map((e) => e.scrollTop),
          leftPane: !!document.getElementById('sh-pane-left'),
          palette: cp ? { query: cp.value, option: cp.getAttribute('aria-activedescendant') } : null,
        };
      });
    const before = await snap();
    expect(before.leftPane).toBe(false);
    expect(before.palette.query).toBe('toggle');

    release();
    await expect(page.getByTestId('status-validate')).toContainText('3 problems', { timeout: 20_000 });
    await page.waitForTimeout(400);

    expect(await snap()).toEqual(before);
    await expect(input).toBeFocused();
  });
});
