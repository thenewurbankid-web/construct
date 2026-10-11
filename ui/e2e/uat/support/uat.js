import { test as base, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAxe, isBlocking, format } from '../../tests/support/axe.js';
import { waitForCockpitReady } from '../../tests/support/cockpit.js';

// Shared pieces of the pre-UAT walks: a fresh copy of the Line sample in the UAT workspace, opening it from the
// project picker as a person does, and a page that fails the walk on anything the owner would call broken.
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, '../../../..');
export const SAMPLE_SRC = path.join(REPO, 'examples/line-sample');
export const WORKSPACE = process.env.E2E_UAT_WORKSPACE;
export const SAMPLE = path.join(WORKSPACE || '/nonexistent', 'line-sample');
export const CLI = path.join(REPO, 'packages/cli/construct.mjs');

/** "rm -rf <workspace>/line-sample && cp -R examples/line-sample <workspace>/" (review.md, "start from a fresh sample"). */
export function freshSample() {
  if (!WORKSPACE) throw new Error('E2E_UAT_WORKSPACE is not set: run the walks through playwright.uat.config.js.');
  fs.rmSync(SAMPLE, { recursive: true, force: true });
  fs.cpSync(SAMPLE_SRC, SAMPLE, { recursive: true });
  return {
    dir: SAMPLE,
    read: (rel) => fs.readFileSync(path.join(SAMPLE, rel), 'utf8'),
    exists: (rel) => fs.existsSync(path.join(SAMPLE, rel)),
  };
}

/** Runs the construct CLI the way the owner types it in a terminal; returns { code, out }. */
export function cli(args, cwd = REPO) {
  try {
    const out = execFileSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

// Console lines that are the headless browser's or the dev server's own noise, not Cockpit's.
const NOISE = [
  /GL Driver Message/,
  /Download the React DevTools/,
  /was preloaded using link preload but not used/,
  // React StrictMode mounts effects twice in dev: the first processes socket is closed before it connects.
  /WebSocket connection to .* failed: WebSocket is closed before the connection is established/,
  /\[Fast Refresh\]/,
  /\[HMR\]/,
  // axe-core tries to inject itself into the preview's sandboxed frame (sandbox="" runs no scripts, by design); the
  // rendered component itself carries no script. Only the accessibility check causes this line.
  /Blocked script execution in 'about:srcdoc' because the document's frame is sandboxed/,
];

/** `page` that records every console error/warning, uncaught error and 4xx/5xx answer; the walk fails on any of
 * them at the end (a step may `allowHttp(status, urlPart)` an answer it provokes on purpose, e.g. a refusal). */
export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    const problems = [];
    const allowed = [];
    page.on('console', (m) => {
      if (!['error', 'warning'].includes(m.type())) return;
      const text = m.text();
      if (NOISE.some((r) => r.test(text))) return;
      // A refused request the step provoked on purpose also logs "Failed to load resource"; the response check
      // below decides about it.
      if (/Failed to load resource: the server responded with a status of/.test(text)) return;
      problems.push(`console.${m.type()}: ${text.slice(0, 400)}`);
    });
    page.on('pageerror', (e) => problems.push(`uncaught: ${e.message.slice(0, 400)}`));
    page.on('response', (r) => {
      const s = r.status();
      if (s < 400) return;
      const url = r.url();
      if (allowed.some((a) => a.status === s && url.includes(a.url))) return;
      problems.push(`HTTP ${s} ${r.request().method()} ${url}`);
    });
    page.allowHttp = (status, url) => {
      const entry = { status, url };
      allowed.push(entry);
      return () => allowed.splice(allowed.indexOf(entry), 1);
    };
    await use(page);
    const overlay = await page.locator('[data-nextjs-dialog], [data-nextjs-dialog-overlay]').count().catch(() => 0);
    if (overlay) problems.push('the Next.js error overlay is showing');
    if (problems.length) await testInfo.attach('problems', { body: problems.join('\n'), contentType: 'text/plain' });
    expect(problems, 'console errors, React warnings, 4xx/5xx answers or an error overlay during the walk').toEqual([]);
  },
});
export { expect };

/** UAT step "Open the project line-sample from the project picker": from wherever Cockpit is, back to the picker
 * (switcher -> Close project when one is open) and Select line-sample. */
export async function openSampleFromPicker(page) {
  await page.goto('/');
  const picker = page.getByRole('heading', { name: 'Open a project' });
  const switcher = page.getByTestId('project-switcher');
  await expect(picker.or(switcher)).toBeVisible({ timeout: 60_000 });
  // A poll already in flight when the project closes answers 409 "No Construct project is open"; that is the
  // harness getting back to the picker, not part of the step.
  const stopAllowing = page.allowHttp(409, '/api/');
  if (await switcher.isVisible()) {
    await waitForCockpitReady(page);
    await switcher.click();
    await page.getByTestId('close-project').click();
    await expect(picker).toBeVisible({ timeout: 30_000 });
  }
  const row = page.getByRole('listitem').filter({ hasText: 'line-sample' });
  await row.getByRole('button', { name: /^Select/ }).click();
  await expect(switcher).toContainText('line-sample', { timeout: 30_000 });
  await waitForCockpitReady(page);
  await page.waitForTimeout(500);
  stopAllowing();
}

/** Goes to a screen by clicking it in the left menu, as a person does. */
export async function goToScreen(page, name) {
  const link = page.getByRole('navigation', { name: 'Screens', exact: true }).getByRole('link', { name, exact: true });
  await link.click();
  await expect(link).toHaveAttribute('aria-current', 'page', { timeout: 30_000 });
}

/** No serious or critical axe finding inside `include`. */
export async function expectAxeClean(page, include, exclude = []) {
  const found = await runAxe(page, { include, exclude });
  expect(found.filter(isBlocking), format(found.filter(isBlocking))).toEqual([]);
}

/** Layout at 1280px and 375px: no horizontal page scroll, and `selector` (the screen under test) fits the width.
 * Leaves the page at 1280px. Saves a screenshot of each width with the test's output. */
export async function expectLayoutFits(page, selector, testInfo, name) {
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 800 });
    // A width change can remount the screen (the shell swaps to its narrow layout); wait for it to come back.
    await page.locator(selector).first().waitFor({ state: 'attached', timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(300);
    const m = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      const box = el ? el.getBoundingClientRect() : null;
      const wide = el ? [...el.querySelectorAll('*')].filter((n) => {
        const b = n.getBoundingClientRect();
        if (!(b.width > 0 && b.right > window.innerWidth + 1) || getComputedStyle(n).position === 'fixed') return false;
        // Inside a box that scrolls or clips sideways (a code block, a table wrapper) is fine: the page does not move.
        for (let a = n.parentElement; a && a !== document.body; a = a.parentElement) {
          if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(a).overflowX) && a.getBoundingClientRect().right <= window.innerWidth + 1) return false;
        }
        return true;
      }).slice(0, 3).map((n) => `${n.tagName.toLowerCase()}${n.getAttribute('data-testid') ? `[data-testid=${n.getAttribute('data-testid')}]` : ''}${n.className && typeof n.className === 'string' ? `.${n.className.split(' ')[0]}` : ''}`) : [];
      return { scroll: document.documentElement.scrollWidth, inner: window.innerWidth, found: !!el, right: box ? box.right : 0, wide };
    }, selector);
    await page.screenshot({ path: testInfo.outputPath(`${name}-${width}.png`) });
    expect(m.found, `${selector} is on the screen at ${width}px`).toBe(true);
    expect(m.scroll, `no horizontal page scroll at ${width}px`).toBeLessThanOrEqual(m.inner);
    expect(m.wide, `nothing in ${selector} runs off the right edge at ${width}px`).toEqual([]);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
}
