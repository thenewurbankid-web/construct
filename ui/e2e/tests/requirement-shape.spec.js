import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { gotoCockpit } from './support/cockpit.js';
import { makeBrowseProject, openProject } from './support/browseProject.js';
import { runAxe, isBlocking, format } from './support/axe.js';
import { planToCommand } from '../../../packages/core/plan.mjs';
import { openProcessStore } from '../../../packages/engine/processStore.mjs';
import { readTraces } from '../../../packages/core/decision-trace-store.mjs';

// #651 (part of #616) -- the Requirement screen shows the screen-shape offer (q-shape) and takes the answer, end to end in a
// real browser against the real server and a real throwaway git project. Nothing is mocked: the offer, the plan and the files
// are what placeCard and planFromBlocks return, and Approve starts a real process through the Plan run route.
// Ports (this spec's own): E2E_CLIENT_PORT=49470 E2E_SERVER_PORT=49471 E2E_DEVSERVER_PORT_BASE=49480.
const API = process.env.E2E_API_BASE || 'http://localhost:4000';
const STATE_DIR = process.env.E2E_STATE_DIR;
const PRODUCTS = 'A user wants to see a list of products';
const FROB = 'A customer wants to frobnicate the invoice list.';
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
    await expect(page.locator('[data-testid="requirement-shape-option"][data-option="list"]').getByTestId('requirement-shape-suggested')).toHaveText('suggested by rules');
    await expect(page.getByTestId('requirement-shape-reason')).toContainText('is plural'); // #633: the provider's reason, next to the option
    await expect(page.locator('[data-testid="requirement-shape-option"][data-option="scaffold"]').getByTestId('requirement-shape-suggested')).toHaveCount(0);
    await expect(page.getByTestId('requirement-shape-suggested')).toHaveCount(1);
    await expect(page.locator('[data-testid="requirement-shape-option"][data-option="list"]')).toContainText('Creates 10 real files that validate');
    await expect(page.locator('[data-testid="requirement-shape-option"][data-option="scaffold"]')).toContainText('Creates empty stubs');
    await expect(card.getByRole('button', { pressed: true })).toHaveCount(0);
    await expect(page.getByTestId('requirement-shape-status')).toContainText('Not chosen yet, so the plan below is the empty scaffold');
    await expect(page.getByTestId('requirement-shape-status')).toContainText('Suggested by rules: list screen');
    // An offer is not an open question: no open card, Approve is on, and the plan shown is the plain scaffold.
    await expect(page.getByTestId('requirement-open')).toHaveCount(0);
    await expect(page.getByTestId('requirement-approve-plan')).toBeEnabled();
    await expect(page.getByTestId('requirement-approve-hint')).toHaveCount(0);
    expect(await listedFiles(page)).toEqual(SCAFFOLD_FILES);
  });

  test('choosing scaffold shows fewer files; choosing list shows the 11-step plan, the typed file names and who decided (person)', async ({ page }) => {
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
    expect(list.body.plan.steps.map((s) => s.flow)).toEqual(['create.feature', ...Array(6).fill('create.unit'), 'sync', 'create.route', 'create.proof', 'test.proof']);
    expect(list.body.plan.steps.slice(1, 7).every((s) => s.args.shape === 'list' && s.args.entity === 'Product')).toBe(true); // then sync and the route entry (#654), the proof and its run (#623)
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
    expect(detail.process.steps.map((s) => s.flow)).toEqual(['create.feature', ...Array(6).fill('create.unit'), 'sync', 'create.route', 'create.proof', 'test.proof']);
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

  // #620, #626: the same card draws the other offers with no client change: the options belong to the card (server-side rules).
  const SHAPED = [
    {
      shape: 'detail', text: 'A user wants to see the details of a product', label: 'Detail shape', reason: 'one item that is only read', unit: 'Product', feature: 'product', steps: 12,
      files: ['features/product/domain/Product.domain.ts', 'features/product/types.ts', 'features/product/services/Product.service.ts', 'features/product/hooks/useProduct.state.ts', 'features/product/controllers/ProductController.controller.tsx', 'features/product/components/ProductDetailRow.component.tsx', 'features/product/components/ProductDetails.component.tsx', 'features/product/components/ProductNotice.component.tsx', 'features/product/pages/ProductPage.page.tsx', 'features/product/expressions/ProductByStatus.expression.tsx'],
    },
    {
      shape: 'form', text: 'A user wants to add a product with a name and a price', label: 'Form shape', reason: 'writes the data object', unit: 'AddProduct', feature: 'add-product', steps: 12,
      files: ['features/add-product/domain/AddProduct.domain.ts', 'features/add-product/types.ts', 'features/add-product/services/AddProduct.service.ts', 'features/add-product/hooks/useAddProduct.state.ts', 'features/add-product/controllers/AddProductController.controller.tsx', 'features/add-product/components/AddProductField.component.tsx', 'features/add-product/components/AddProductForm.component.tsx', 'features/add-product/components/AddProductNotice.component.tsx', 'features/add-product/components/AddProductAgain.component.tsx', 'features/add-product/pages/AddProductPage.page.tsx', 'features/add-product/expressions/AddProductByStatus.expression.tsx'],
    },
  ];
  for (const s of SHAPED) {
    test(`a ${s.shape} sentence: the Screen shape card offers ${s.shape} (suggested by rules, with its reason) or the scaffold; choosing ${s.shape} shows the typed plan and who decided`, async ({ page }) => {
      await gotoCockpit(page, '/requirement');
      await readSentence(page, s.text);
      const card = page.getByTestId('requirement-shape');
      await expect(card).toBeVisible();
      await expect(card.getByRole('button')).toHaveText([s.label, 'Empty scaffold']);
      await expect(page.locator(`[data-testid="requirement-shape-option"][data-option="${s.shape}"]`).getByTestId('requirement-shape-suggested')).toHaveText('suggested by rules');
      await expect(page.getByTestId('requirement-shape-suggested')).toHaveCount(1);
      await expect(page.getByTestId('requirement-shape-reason')).toContainText(s.reason);
      await expect(card.getByRole('button', { pressed: true })).toHaveCount(0);
      await expect(page.getByTestId('requirement-shape-status')).toContainText('Not chosen yet, so the plan below is the empty scaffold');
      await expect(page.getByTestId('requirement-open')).toHaveCount(0);
      await expect(page.getByTestId('requirement-approve-plan')).toBeEnabled();
      // Only the offers of this card: no list option on a card that is not a list.
      await expect(page.getByTestId('requirement-shape-list')).toHaveCount(0);

      const chosen = await choose(page, s.shape);
      expect(chosen.body.offers[0]).toMatchObject({ id: 'q-shape', chosen: s.shape, default: s.shape, shape: s.shape, unit: s.unit });
      expect(chosen.body.offers[0].options.map((o) => o.id)).toEqual([s.shape, 'scaffold']);
      expect(chosen.body.plan.steps.map((x) => x.flow)).toEqual(['create.feature', ...Array(6).fill('create.unit'), 'sync', 'create.route', 'create.proof', 'test.proof']);
      expect(chosen.body.plan.steps.slice(1, 7).every((x) => x.args.shape === s.shape && x.args.name === s.unit && x.args.entity === 'Product')).toBe(true);
      expect(chosen.body.placement.decisions).toEqual([{ question: 'q-shape', option: s.shape, by: 'person' }]);
      await expect(page.getByTestId(`requirement-shape-${s.shape}`)).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('requirement-shape-status')).toHaveText(`Chosen: ${s.label}. Decided by: person.`);
      await expect(page.getByTestId('requirement-files').locator('summary')).toHaveText(`${s.files.length} files will be created`);
      expect(await listedFiles(page)).toEqual(s.files);
      await expect(page.getByTestId('requirement-approve-plan')).toBeEnabled();
      expect(chosen.res.request().postDataJSON().answers).toEqual([{ id: 'q-shape', option: s.shape }]);

      // The other option of the card is the plain scaffold: fewer files, no shape on any step.
      const scaffold = await choose(page, 'scaffold');
      expect(scaffold.body.plan.steps.some((x) => x.args?.shape)).toBe(false);
      await expect(page.getByTestId('requirement-shape-status')).toHaveText('Chosen: Empty scaffold. Decided by: person.');
      // Approve with the shape chosen starts a process whose steps carry --shape <name>; nothing reaches the project.
      await choose(page, s.shape);
      const ran = page.waitForResponse((r) => r.url().endsWith('/api/plan/run') && r.request().method() === 'POST');
      await page.getByTestId('requirement-approve-plan').click();
      const res = await ran;
      expect(res.status()).toBe(200);
      const sent = res.request().postDataJSON().plan.steps.map((x) => planToCommand(x).argv.join(' '));
      for (const c of sent.slice(1, 7)) expect(c).toContain(`--shape ${s.shape} --entity Product --fields id:string,name:string,price:number`);
      expect(sent.at(-1)).toBe(`test proof ${s.feature} --name ${s.unit}Screen.proof.test.ts`);
      for (const f of s.files) expect(fs.existsSync(path.join(project.repo, f)), f).toBe(false);
    });
  }

  test('the detail and form cards pass the accessibility check at 390 px in both themes, and do not scroll sideways', async ({ page }) => {
    for (const theme of ['dark', 'light']) {
      await page.addInitScript((t) => localStorage.setItem('construct.theme', t), theme);
      await page.setViewportSize({ width: 390, height: 844 });
      for (const s of SHAPED) {
        await gotoCockpit(page, '/requirement');
        await readSentence(page, s.text);
        await choose(page, s.shape);
        const found = await runAxe(page);
        expect(found.filter(isBlocking), `${theme} ${s.shape}: ${format(found.filter(isBlocking))}`).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${theme} ${s.shape}: page scroll`).toBe(true);
        expect(await page.getByTestId('requirement-shape').evaluate((el) => el.scrollWidth <= el.clientWidth + 1), `${theme} ${s.shape}: card scroll`).toBe(true);
      }
    }
  });

  // #633: the decision provider's suggestion is one click to take and one click to change, and the answer is recorded with it.
  const recorded =(chooser, chosen) => readTraces(project.repo, { stateDir: STATE_DIR }).decisions.filter((d) => d.chooser.id === chooser && d.chosen === chosen);

  test('the shape suggestion is marked "suggested by rules" with its reason; choosing another is recorded as overriding, taking it as accepted', async ({ page }) => {
    await gotoCockpit(page, '/requirement');
    const read = page.waitForResponse(isRead);
    await page.getByTestId('requirement-text').fill(PRODUCTS);
    await page.getByTestId('requirement-read').click();
    const body = await (await read).json();
    expect(body.suggestions['q-shape']).toMatchObject({ option: 'list', provider: { name: 'rules', version: '1' } });
    expect(body.decisionProvider).toMatchObject({ name: 'rules', requested: 'rules', fellBackFrom: null });
    await expect(page.getByTestId('requirement-shape-suggested')).toHaveText('suggested by rules');
    await expect(page.getByTestId('requirement-shape').getByRole('button', { pressed: true })).toHaveCount(0); // suggest-only: nothing is chosen for the person

    await choose(page, 'scaffold'); // a person overriding the suggestion
    const [overridden] = recorded('requirement.placement.shape', 'scaffold');
    expect(overridden).toMatchObject({ by: 'person', suggestion: { option: 'list' }, provider: { name: 'rules', version: '1' }, outcome: { accepted: false } });
    await choose(page, 'list'); // a person taking it
    const [accepted] = recorded('requirement.placement.shape', 'list');
    expect(accepted).toMatchObject({ by: 'person', suggestion: { option: 'list' }, provider: { name: 'rules', version: '1' }, outcome: { accepted: true } });
  });

  test('an open question marks the suggested option "suggested by rules" with its reason; every option stays one click, and the answer is recorded with accepted false when another is chosen', async ({ page }) => {
    await gotoCockpit(page, '/requirement');
    await readSentence(page, FROB);
    const question = page.getByTestId('requirement-question');
    await expect(question.getByRole('button')).toHaveCount(5);
    await expect(page.getByTestId('requirement-suggested')).toHaveCount(1);
    await expect(page.locator('[data-testid="requirement-question"] [data-option="read"]').getByTestId('requirement-suggested')).toHaveText('suggested by rules');
    await expect(page.getByTestId('requirement-suggestion-reason')).toHaveText('Why: first available step');
    await expect(question.getByRole('button', { pressed: true })).toHaveCount(0);
    const done = page.waitForResponse(isRead);
    await page.getByTestId('requirement-answer-interact').click();
    expect((await done).status()).toBe(200);
    const [d] = recorded('requirement.card.verb', 'interact');
    expect(d).toMatchObject({ by: 'person', suggestion: { option: 'read', reason: 'first available step' }, outcome: { accepted: false } });
    // Taking the suggestion: a fresh page and a fresh read of the same words, answered with the suggested option.
    await gotoCockpit(page, '/requirement');
    await readSentence(page, FROB);
    const again = page.waitForResponse(isRead);
    await page.getByTestId('requirement-answer-read').click();
    await again;
    const [taken] = recorded('requirement.card.verb', 'read');
    expect(taken).toMatchObject({ by: 'person', suggestion: { option: 'read' }, outcome: { accepted: true } });
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

  test('a plugin named in architecture.yml is "suggested by jev": its own reason, still one click to take or change, recorded with its name and version', async ({ page }) => {
    // Last in the file: this changes the project's architecture.yml (the decision block) and adds a plugin file to it.
    fs.writeFileSync(path.join(project.repo, 'decision-jev.mjs'), "export default { name: 'jev', version: '0.1', suggest(summary) { const o = summary.options.find((x) => x.id === 'write') ?? summary.options[1]; return { option: o.id, reason: 'Changing data is the usual meaning.' }; } };\n");
    fs.appendFileSync(path.join(project.repo, 'architecture.yml'), '\ndecision:\n  provider: jev\n  plugin: decision-jev.mjs\n');
    await gotoCockpit(page, '/requirement');
    const read = page.waitForResponse(isRead);
    await page.getByTestId('requirement-text').fill(FROB);
    await page.getByTestId('requirement-read').click();
    const body = await (await read).json();
    expect(body.decisionProvider).toMatchObject({ name: 'jev', version: '0.1', fellBackFrom: null });
    await expect(page.locator('[data-testid="requirement-question"] [data-option="write"]').getByTestId('requirement-suggested')).toHaveText('suggested by jev');
    await expect(page.getByTestId('requirement-suggestion-reason')).toHaveText('Why: Changing data is the usual meaning.');
    await expect(page.getByTestId('requirement-question').getByRole('button')).toHaveCount(5);
    await expect(page.getByTestId('requirement-answer-navigate')).toBeEnabled(); // any other option is one click
    const done = page.waitForResponse(isRead);
    await page.getByTestId('requirement-answer-navigate').click();
    await done;
    const [d] = recorded('requirement.card.verb', 'navigate');
    expect(d).toMatchObject({ by: 'person', provider: { name: 'jev', version: '0.1' }, suggestion: { option: 'write', reason: 'Changing data is the usual meaning.' }, outcome: { accepted: false } });
  });
});
