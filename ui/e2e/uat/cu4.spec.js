import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gotoCockpit } from '../tests/support/cockpit.js';
import { openProject } from '../tests/support/browseProject.js';

// UAT walk for cu4 (docs/line/review.md, "cu4"), as a non-technical owner: only clicks and typing in the browser,
// counting the clicks each decision takes (at most two), and failing on any console error or any 4xx/5xx answer except
// the one refusal the walk asks for. The project is a copy of ~/Repositories/import-samples/contact-manager-ui when it
// opens as a Line project; it is not one (no `preset: line` architecture.yml: it needs the Import flow first), so the
// walk falls back to a copy of examples/line-sample plus the cu4 overlay and says which one it used.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const CONTACTS = path.join(os.homedir(), 'Repositories/import-samples/contact-manager-ui');
const SAMPLE = path.join(REPO, 'examples/line-sample');
const OVERLAY = path.join(REPO, 'fixtures/line-cu4');
const API = process.env.E2E_API_BASE || 'http://localhost:4000';
const isLineProject = (dir) => {
  try { return /^\s*preset:\s*line\b/m.test(fs.readFileSync(path.join(dir, 'architecture.yml'), 'utf8')); } catch { return false; }
};

/** A copy of contact-manager-ui (its code, not its node_modules) when it is a Line project, else the sample + overlay. */
function projectCopy() {
  const tmp = process.env.E2E_WORKSPACE_ROOT ?? os.tmpdir();
  if (fs.existsSync(CONTACTS)) {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(tmp, 'contact-manager-ui-')));
    fs.cpSync(CONTACTS, dir, { recursive: true, filter: (src) => !src.includes(`${path.sep}node_modules`) && !src.includes(`${path.sep}.next`) });
    if (isLineProject(dir)) return { dir, used: 'contact-manager-ui' };
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(tmp, 'line-sample-cu4-')));
  fs.cpSync(SAMPLE, dir, { recursive: true });
  for (const sub of ['library', 'features']) fs.cpSync(path.join(OVERLAY, sub), path.join(dir, sub), { recursive: true });
  return { dir, used: 'examples/line-sample + fixtures/line-cu4 (contact-manager-ui is not a Line project: no "preset: line")' };
}

test('cu4 UAT: open a component, give it a behaviour, add a When -> Do, change its state, try a library item, make a new component', async ({ page }) => {
  test.setTimeout(480_000);
  const { dir: base, used } = projectCopy();
  test.info().annotations.push({ type: 'project', description: used });
  console.log(`cu4 UAT project: ${used}`);
  const restore = await openProject(API, base);
  const problems = [];
  let refusalAllowed = false;
  page.on('console', (m) => { if (m.type() === 'error' && !(refusalAllowed && /status of 400/.test(m.text()))) problems.push(`console: ${m.text()}`); });
  page.on('response', (r) => { if (r.status() >= 400 && !(refusalAllowed && r.status() === 400 && r.url().endsWith('/plan/step'))) problems.push(`${r.status()} ${r.request().method()} ${r.url()}`); });
  let clicks = 0;
  const click = async (locator) => { clicks += 1; await locator.click({ timeout: 60_000 }); };
  const plan = page.getByTestId('line-plan');
  const approve = async () => {
    await click(plan.locator('[data-testid="plan-step"][data-state="waiting"]').first().getByRole('button', { name: /^Approve step/ }));
    await expect(plan.locator('[data-testid="plan-step"][data-state="waiting"]')).toHaveCount(0, { timeout: 60_000 });
    await expect(plan.locator('[data-testid="plan-step"][data-state="ready"], [data-testid="plan-step"][data-state="running"]')).toHaveCount(0, { timeout: 60_000 });
  };
  try {
    // 1. Components: the library cards, the editor and New component. Open OrderDetails (orders, based on Disclosure).
    await gotoCockpit(page, '/components');
    await click(page.getByRole('button', { name: 'Open in the editor: OrderDetails' }));
    await expect(page.getByTestId('lc-headline')).toHaveText('OrderDetails: a component of orders, based on Disclosure.', { timeout: 60_000 });

    // 2. Behaviour: Add this behaviour (disclosure), then Approve: two clicks.
    clicks = 0;
    await click(page.locator('[data-line-control="components.attachBehaviour"][data-line-target="disclosure"]'));
    await approve();
    expect(clicks).toBeLessThanOrEqual(2);
    await expect(page.getByTestId('lc-behaviour')).toContainText('Clicking the trigger opens and closes it.', { timeout: 60_000 });

    // 3. Events: When the trigger is clicked, Do open or close it; Add, then Approve.
    await click(page.getByRole('tab', { name: 'Events' }));
    await page.locator('[data-line-control="components.whenSource"]').selectOption('click:trigger');
    await page.locator('[data-line-control="components.whenAction"]').selectOption('primitive:disclosure-1:toggle');
    clicks = 0;
    await click(page.locator('[data-line-control="components.addWhenDo"]'));
    await approve();
    expect(clicks).toBeLessThanOrEqual(2);
    await expect(page.getByTestId('lc-whendo')).toHaveCount(1, { timeout: 60_000 });

    // 4. States: it is closed now; click "open" on the graph, then Approve.
    await click(page.getByRole('tab', { name: 'States' }));
    await expect(page.getByTestId('lc-current-state')).toHaveText('closed');
    clicks = 0;
    await click(page.getByRole('button', { name: 'Set to open' }));
    await approve();
    expect(clicks).toBeLessThanOrEqual(2);
    await expect(page.getByTestId('lc-current-state')).toHaveText('open', { timeout: 60_000 });

    // 5. A library item stays as it is: try a When -> Do on Disclosure; one sentence, and its fix is one click away.
    await click(page.getByRole('button', { name: 'Open in the editor: Disclosure' }));
    await click(page.getByRole('tab', { name: 'Events' }));
    refusalAllowed = true;
    await click(page.locator('[data-line-control="components.addWhenDo"]'));
    await expect(page.getByTestId('lc-refusal')).toContainText('base a feature item on it and change that.', { timeout: 60_000 });
    refusalAllowed = false;

    // 6. New component: based on Disclosure in billing, named InvoiceFaq; Create, then Approve.
    const form = page.getByTestId('lc-new');
    await form.locator('[data-line-control="components.newBase"]').selectOption('components/Disclosure');
    await form.locator('[data-line-control="components.newFeature"]').selectOption('billing');
    await form.locator('[data-line-control="components.newName"]').fill('InvoiceFaq');
    clicks = 0;
    await click(form.locator('[data-line-control="components.newCreate"]'));
    await approve();
    expect(clicks).toBeLessThanOrEqual(2);
    await expect(page.getByRole('button', { name: 'Open in the editor: InvoiceFaq' })).toBeVisible({ timeout: 60_000 });
    expect(fs.existsSync(path.join(base, 'features/billing/components/InvoiceFaq.tsx'))).toBe(true);

    expect(problems, problems.join('\n')).toEqual([]);
  } finally {
    await restore?.();
    fs.rmSync(base, { recursive: true, force: true });
  }
});
