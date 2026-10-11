import { test as base, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAxe, isBlocking, format } from '../../tests/support/axe.js';
import { waitForCockpitReady } from '../../tests/support/cockpit.js';

// The ONE helper every UAT walk shares (ui/e2e/uat). Shared pieces of the pre-UAT walks: a fresh copy of the Line sample in the UAT workspace, opening it from the
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
  // Playwright's Chromium logs this for ANY sandboxed frame without allow-scripts as it attaches, even a static <p>
  // (checked with a bare sandboxed srcdoc frame); the preview's frame runs no scripts on purpose and holds none.
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

// ------------------------------------------------------------------ the integrator's walks (cp1, ca2, ci1, new project)
/** The UAT workspace (playwright.uat.config.js sets both names to the same folder). */
export const WS = process.env.E2E_WORKSPACE_ROOT ?? WORKSPACE;

/** Copy an example into the workspace as a project of the owner's (a fresh copy per walk). */
export function freshProject(example, name) {
  const dir = path.join(WS, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.cpSync(path.join(REPO, 'examples', example), dir, { recursive: true });
  return dir;
}

/** Remove everything from the workspace (the walks share one narrow workspace). */
export function clearWorkspace() {
  for (const name of fs.readdirSync(WS)) fs.rmSync(path.join(WS, name), { recursive: true, force: true });
}

/** Console errors, page exceptions and 4xx/5xx answers, collected per walk; `allow` lists provoked ones. */
export function watchPage(page, { allow = [] } = {}) {
  const problems = [];
  const ok = (line) => [...NOISE, ...allow].some((re) => re.test(line));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const line = `console: ${m.text()} ${m.location().url ?? ''}`.trim();
    if (!ok(line)) problems.push(line);
  });
  page.on('pageerror', (e) => problems.push(`uncaught: ${String(e?.message ?? e)}`));
  page.on('response', (r) => {
    if (r.status() < 400) return;
    const line = `http ${r.status()}: ${r.request().method()} ${r.url()}`;
    if (!ok(line)) problems.push(line);
  });
  return {
    problems,
    check: () => expect(problems, `The page had problems:\n${problems.join('\n')}`).toEqual([]),
  };
}

/** Every click the owner makes goes through here, so a walk can say how many one action took. */
export function clicker() {
  const c = {
    count: 0,
    async click(locator) { c.count += 1; await locator.click(); },
    /** Start counting one action; `done()` asserts it took at most two clicks. */
    action(name) {
      const start = c.count;
      return { done: () => expect(c.count - start, `"${name}" took more than two clicks`).toBeLessThanOrEqual(2) };
    },
  };
  return c;
}

/** The visible text of `locator`, without closed Details, holds no rule id, file:line or tool call. */
export async function expectPlainEnglish(locator) {
  const text = await locator.evaluate((el) => {
    const copy = el.cloneNode(true);
    copy.querySelectorAll('details:not([open])').forEach((d) => { [...d.childNodes].forEach((n) => { if (n.nodeName !== 'SUMMARY') n.remove(); }); });
    return copy.innerText ?? copy.textContent ?? '';
  });
  expect(text, 'technical detail outside Details').not.toMatch(/\b(LINE|SLICE|PAGE|COMPONENT)-[A-Z0-9]+\b|\.tsx?:\d+|\bline\.[a-zA-Z]+\(/);
}

/** Open a project the owner's way: from "Open a project", its row in "Your projects". */
export async function openFromGate(page, me, name) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Open a project' })).toBeVisible({ timeout: 30_000 });
  const list = page.getByRole('region', { name: 'Your projects' });
  const action = me.action(`open ${name}`);
  await me.click(list.getByRole('button', { name: `Select ${name}` }));
  const open = page.getByRole('button', { name: new RegExp(`^Open( ${name})?$`) });
  if (await open.count()) await me.click(open.first());
  await expect(page.getByTestId('project-switcher')).toContainText(name, { timeout: 30_000 });
  action.done();
}

/** Close the open project the owner's way (project switcher, Close project). */
export async function closeProject(page) {
  if (!(await page.getByTestId('project-switcher').count())) return;
  await page.getByTestId('project-switcher').click();
  await page.getByTestId('close-project').click();
  await expect(page.getByRole('heading', { name: 'Open a project' })).toBeVisible({ timeout: 30_000 });
}

/** The screens rail link the owner clicks to move between screens. */
export const screen = (page, name) => page.getByRole('navigation', { name: 'Screens', exact: true }).getByRole('link', { name, exact: true });

// ------------------------------------------------------------------ the cg1/ct1 walks
// What an owner's walk must never meet: a console error or a failed request (4xx/5xx). Collected per page and
// checked at the end of each walk, with the URL or message, so a failure says what went wrong.
export function watchForProblems(page) {
  const problems = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !NOISE.some((r) => r.test(m.text()))) problems.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  page.on('response', (r) => {
    if (r.status() >= 400) problems.push(`${r.status()} ${r.request().method()} ${r.url()}`);
  });
  return { check: () => expect(problems, problems.join('\n')).toEqual([]) };
}

export const API = process.env.E2E_API_BASE || `http://localhost:${process.env.E2E_SERVER_PORT || 4000}`;

/** A fresh copy of the Line sample (the how-to's "open examples/line-sample", without touching the original). */
export function copySample() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(process.env.E2E_WORKSPACE_ROOT ?? os.tmpdir(), 'line-uat-')));
  fs.cpSync(SAMPLE_SRC, dir, { recursive: true });
  return dir;
}

/** cp1: every change is a plan step; the owner approves it in the Plan panel (one click) and then it is saved. */
export async function approveInPlan(page) {
  await page.getByTestId('line-plan').getByRole('button', { name: /^Approve step/ }).first().click();
}
