import { expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// What every owner walk shares (playwright.uat.config.js). The owner's bar (11 Oct): no API shortcuts, a walk fails on
// any console error, uncaught exception or 4xx/5xx answer the page gets (unless the walk provokes that refusal on
// purpose and says so), every action takes at most two clicks, and what the owner reads is plain English (a rule id
// or a file:line only inside a closed Details).
export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const WS = process.env.E2E_WORKSPACE_ROOT;

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
  const ok = (line) => allow.some((re) => re.test(line));
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
