import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { gotoCockpit } from './support/cockpit.js';
import { makeBrowseProject, openProject } from './support/browseProject.js';
import { runAxe, isBlocking, format } from './support/axe.js';
import { planToCommand } from '../../../packages/core/plan.mjs';
import { openProcessStore } from '../../../packages/engine/processStore.mjs';

// #651 (part of #616) -- the Requirement screen shows the screen-shape offer (q-shape) and takes the answer, end to end in a
// real browser against the real server and a real throwaway git project. Nothing is mocked: the offer, the plan and the files
// are what placeCard and planFromBlocks return, and Approve starts a real process through the Plan run route.
// Ports (this spec's own): E2E_CLIENT_PORT=49470 E2E_SERVER_PORT=49471 E2E_DEVSERVER_PORT_BASE=49480.
const API = process.env.E2E_API_BASE || 'http://localhost:4000';
const STATE_DIR = process.env.E2E_STATE_DIR;
const PRODUCTS = 'A user wants to see a list of products';
const BILLING = 'A logged-in user needs to see their current subscription plan and be able to click a button to manage their billing details safely via Stripe.';
const SCAFFOLD_FILES = ['features/products/components/Products.tsx', 'features/products/pages/ProductsPage.tsx'];
const LIST_FILES = [
  'features/products/domain/Products.domain.ts',
  'features/products/types.ts',
  'features/products/services/Products.service.ts',
  'features/products/hooks/useProducts.state.ts',
  'features/products/controllers/ProductsController.controller.tsx',
  'features/products/components/ProductRow.component.tsx',
  'features/products/components/ProductList.component.tsx',
  'features/products/components/ProductsNotice.component.tsx',
  'features/products/pages/ProductsPage.page.tsx',
  'features/products/expressions/ProductsByStatus.expression.tsx',
];

const isRead = (r) => r.url().endsWith('/api/requirement/read') && r.request().method() === 'POST';
const readSentence = async (page, text) => {
  await page.getByTestId('requirement-text').fill(text);
  const done = page.waitForResponse(isRead);
  await page.getByTestId('requirement-read').click();
  await done;
  await expect(page.getByTestId('requirement-card')).toBeVisible();
};
/** Click one option of the shape card and return the read response it caused. */
const choose = async (page, option) => {
  const done = page.waitForResponse(isRead);
  await page.getByTestId(`requirement-shape-${option}`).click();
  const res = await done;
  expect(res.status()).toBe(200);
  return { res, body: await res.json() };
};
const listedFiles = async (page) => {
  const details = page.getByTestId('requirement-files');
  if (!(await details.evaluate((el) => el.open))) await details.locator('summary').click();
  return page.getByTestId('requirement-file').allTextContents();
};

test.describe.serial('Requirement: the screen-shape offer (q-shape) is drawn and answered (#651)', () => {
  let project;
  let restore;

  test.beforeAll(async () => {
    project = makeBrowseProject('og651-shape-');
    restore = await openProject(API, project.repo);
  });
  test.afterAll(async () => {
    await restore?.();
    project?.remove();
  });

  test('the products sentence shows the Screen shape card between the placement and the timeline; list is suggested, nothing is chosen, Approve stays on', async ({ page }) => {
    await gotoCockpit(page, '/requirement');
    await readSentence(page, PRODUCTS);
    const card = page.getByTestId('requirement-shape');
    await expect(card).toBeVisible();
    await expect(card.getByRole('heading', { name: 'Screen shape', level: 2 })).toBeVisible();
    // Its place: after the placement blocks, before the timeline.
    const order = await page.getByTestId('requirement-stage').locator('[data-testid="requirement-placement"], [data-testid="requirement-shape"], [data-testid="requirement-timeline"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
    expect(order).toEqual(['requirement-placement', 'requirement-shape', 'requirement-timeline']);
    // Two options as buttons; "suggested" is on list only; one plain line says what each gives.
    await expect(card.getByRole('button')).toHaveText(['List screen, generated with typed code', 'Empty scaffold']);
    await expect(page.getByTestId('requirement-shape-option')).toHaveCount(2);
    await expect(page.locator('[data-testid="requirement-shape-option"][data-option="list"]').getByTestId('requirement-shape-suggested')).toHaveText('suggested');
    await expect(page.locator('[data-testid="requirement-shape-option"][data-option="scaffold"]').getByTestId('requirement-shape-suggested')).toHaveCount(0);
    await expect(page.getByTestId('requirement-shape-suggested')).toHaveCount(1);
    await expect(page.locator('[data-testid="requirement-shape-option"][data-option="list"]')).toContainText('Creates 10 real files that validate');
    await expect(page.locator('[data-testid="requirement-shape-option"][data-option="scaffold"]')).toContainText('Creates empty stubs');
    await expect(card.getByRole('button', { pressed: true })).toHaveCount(0);
    await expect(page.getByTestId('requirement-shape-status')).toContainText('Not chosen yet, so the plan below is the empty scaffold');
    // An offer is not an open question: no open card, Approve is on, and the plan shown is the plain scaffold.
    await expect(page.getByTestId('requirement-open')).toHaveCount(0);
    await expect(page.getByTestId('requirement-approve-plan')).toBeEnabled();
    await expect(page.getByTestId('requirement-approve-hint')).toHaveCount(0);
    expect(await listedFiles(page)).toEqual(SCAFFOLD_FILES);
  });

  test('choosing scaffold shows fewer files; choosing list shows the 9-step plan, the typed file names and who decided (person)', async ({ page }) => {
    await gotoCockpit(page, '/requirement');
    await readSentence(page, PRODUCTS);

    const scaffold = await choose(page, 'scaffold');
    expect(scaffold.body.offers[0].chosen).toBe('scaffold');
    expect(scaffold.body.plan.steps).toHaveLength(3);
    await expect(page.getByTestId('requirement-shape-scaffold')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('requirement-shape-list')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('requirement-shape-status')).toHaveText('Chosen: Empty scaffold. Decided by: person.');
    await expect(page.getByTestId('requirement-shape-status')).toHaveAttribute('data-decided-by', 'person');
    await expect(page.getByTestId('requirement-files').locator('summary')).toHaveText('2 files will be created');
    expect(await listedFiles(page)).toEqual(SCAFFOLD_FILES);

    const list = await choose(page, 'list');
    expect(list.body.offers[0].chosen).toBe('list');
    expect(list.body.plan.steps.map((s) => s.flow)).toEqual(['create.feature', ...Array(6).fill('create.unit'), 'create.proof', 'test.proof']);
    expect(list.body.plan.steps.slice(1, 7).every((s) => s.args.shape === 'list' && s.args.entity === 'Product')).toBe(true); // then the proof and its run (#623)
    await expect(page.getByTestId('requirement-shape-list')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('requirement-shape-scaffold')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('requirement-shape-status')).toHaveText('Chosen: List screen, generated with typed code. Decided by: person.');
    await expect(page.getByTestId('requirement-files').locator('summary')).toHaveText('10 files will be created');
    expect(await listedFiles(page)).toEqual(LIST_FILES);
    expect(await listedFiles(page)).toContain('features/products/services/Products.service.ts');
    // The placement and the timeline redrew with the answer: a server read now sits before the screen.
    await expect(page.getByTestId('requirement-block')).toHaveCount(2);
    expect(await page.getByTestId('timeline-step').evaluateAll((els) => els.map((e) => e.getAttribute('data-kind')))).toEqual(['page-load', 'server-read', 'presentation']);
    await expect(page.getByTestId('requirement-approve-plan')).toBeEnabled();
    // The request carried the answers list extended by { id: 'q-shape', option }, and a changed mind replaced it.
    expect(list.res.request().postDataJSON().answers).toEqual([{ id: 'q-shape', option: 'list' }]);
    expect(scaffold.res.request().postDataJSON().answers).toEqual([{ id: 'q-shape', option: 'scaffold' }]);
  });

  test('Approve with the shape chosen starts a process whose steps carry --shape list, and nothing reaches the project', async ({ page, request }) => {
    const before = project.git('status', '--porcelain=v2', '--untracked-files=all');
    await gotoCockpit(page, '/requirement');
    await readSentence(page, PRODUCTS);
    await choose(page, 'list');
    const ran = page.waitForResponse((r) => r.url().endsWith('/api/plan/run') && r.request().method() === 'POST');
    await page.getByTestId('requirement-approve-plan').click();
    const res = await ran;
    expect(res.status()).toBe(200);
    const { processId } = await res.json();
    await expect(page.getByTestId('requirement-started')).toContainText(processId);
    const detail = await (await request.get(`${API}/api/processes/${processId}`)).json();
    expect(detail.ok).toBe(true);
    expect(detail.process.steps.map((s) => s.flow)).toEqual(['create.feature', ...Array(6).fill('create.unit'), 'create.proof', 'test.proof']);
    // The API shows a step without its arguments; the saved record (the server's own store) keeps the plan verbatim, and its steps are what runs.
    const record = openProcessStore(project.repo, { stateDir: STATE_DIR }).load(processId);
    const commands = record.plan.steps.map((s) => planToCommand(s).argv.join(' '));
    expect(commands[0]).toMatch(/^create feature/);
    for (const c of commands.slice(1, 7)) expect(c).toContain('--shape list --entity Product --fields id:string,name:string,price:number');
    expect(project.git('status', '--porcelain=v2', '--untracked-files=all')).toEqual(before);
    for (const f of LIST_FILES) expect(fs.existsSync(path.join(project.repo, f)), f).toBe(false);
  });

  test('Approve with nothing chosen sends exactly the plan the screen shows (the plain scaffold)', async ({ page }) => {
    await gotoCockpit(page, '/requirement');
    const done = page.waitForResponse(isRead);
    await page.getByTestId('requirement-text').fill(PRODUCTS);
    await page.getByTestId('requirement-read').click();
    const shown = (await (await done).json()).plan;
    expect(shown.steps).toHaveLength(3);
    await expect(page.getByTestId('requirement-approve-plan')).toBeEnabled();
    const ran = page.waitForResponse((r) => r.url().endsWith('/api/plan/run') && r.request().method() === 'POST');
    await page.getByTestId('requirement-approve-plan').click();
    const res = await ran;
    expect(res.status()).toBe(200);
    expect(res.request().postDataJSON().plan).toEqual(shown);
    expect(res.request().postDataJSON().plan.steps.some((s) => s.args?.shape)).toBe(false);
  });

  test('a sentence without an offer shows no card, and new words drop the earlier shape answer', async ({ page }) => {
    await gotoCockpit(page, '/requirement');
    await readSentence(page, PRODUCTS);
    await choose(page, 'list');
    await readSentence(page, BILLING);
    await expect(page.getByTestId('requirement-shape')).toHaveCount(0);
    await expect(page.getByTestId('requirement-placement')).toBeVisible();
    await expect(page.getByTestId('requirement-approve-plan')).toBeEnabled();
    // Back to the products sentence: the earlier answer was dropped with the old words, so it is unanswered again.
    await readSentence(page, PRODUCTS);
    await expect(page.getByTestId('requirement-shape-status')).toContainText('Not chosen yet');
    await expect(page.getByTestId('requirement-shape').getByRole('button', { pressed: true })).toHaveCount(0);
  });

  for (const theme of ['dark', 'light']) {
    test(`accessibility and layout at 390 px: ${theme}, the offer unanswered, then list chosen`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem('construct.theme', t), theme);
      await page.setViewportSize({ width: 390, height: 844 });
      await gotoCockpit(page, '/requirement');
      await readSentence(page, PRODUCTS);
      await expect(page.getByTestId('requirement-shape')).toBeVisible();
      const stage = page.getByTestId('requirement-stage');
      for (const step of ['unanswered', 'list chosen']) {
        if (step === 'list chosen') {
          await choose(page, 'list');
          await expect(page.getByTestId('requirement-shape-list')).toHaveAttribute('aria-pressed', 'true');
        }
        const found = await runAxe(page);
        expect(found.filter(isBlocking), `${step}: ${format(found.filter(isBlocking))}`).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${step}: page scroll`).toBe(true);
        expect(await stage.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), `${step}: stage scroll`).toBe(true);
        expect(await page.getByTestId('requirement-shape').evaluate((el) => el.scrollWidth <= el.clientWidth + 1), `${step}: card scroll`).toBe(true);
      }
    });
  }
});
