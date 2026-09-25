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
const WIZARD = 'A user wants a step by step signup';
const BILLING = 'A logged-in user needs to see their current subscription plan and be able to click a button to manage their billing details safely via Stripe.';
const SCAFFOLD_FILES = ['features/products/components/Products.tsx', 'features/products/pages/ProductsPage.tsx'];
const LIST_FILES = [
  'features/products/domain/Products.domain.ts',
  'features/products/domain/ProductsStore.domain.ts', // #621: the rules default is the local source, whose store is a second domain file
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
    await expect(page.locator('[data-testid="requirement-shape-option"][data-option="list"]')).toContainText('Creates real files that validate');
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

  test('choosing scaffold shows fewer files; choosing list shows the 12-step plan, the typed file names and who decided (person)', async ({ page }) => {
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
    expect(list.body.plan.steps.map((s) => s.flow)).toEqual(['create.feature', ...Array(6).fill('create.unit'), 'sync', 'create.route', 'check.types', 'create.proof', 'test.proof']);
    expect(list.body.plan.steps.slice(1, 7).every((s) => s.args.shape === 'list' && s.args.entity === 'Product')).toBe(true); // then sync and the route entry (#654), the proof and its run (#623)
    await expect(page.getByTestId('requirement-shape-list')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('requirement-shape-scaffold')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('requirement-shape-status')).toHaveText('Chosen: List screen, generated with typed code. Decided by: person.');
    await expect(page.getByTestId('requirement-files').locator('summary')).toHaveText('11 files will be created');
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
    expect(detail.process.steps.map((s) => s.flow)).toEqual(['create.feature', ...Array(6).fill('create.unit'), 'sync', 'create.route', 'check.types', 'create.proof', 'test.proof']);
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
      files: ['features/product/domain/Product.domain.ts', 'features/product/domain/ProductStore.domain.ts', 'features/product/types.ts', 'features/product/services/Product.service.ts', 'features/product/hooks/useProduct.state.ts', 'features/product/controllers/ProductController.controller.tsx', 'features/product/components/ProductDetailRow.component.tsx', 'features/product/components/ProductDetails.component.tsx', 'features/product/components/ProductNotice.component.tsx', 'features/product/pages/ProductPage.page.tsx', 'features/product/expressions/ProductByStatus.expression.tsx'],
    },
    {
      shape: 'form', text: 'A user wants to add a product with a name and a price', label: 'Form shape', reason: 'writes the data object', unit: 'AddProduct', feature: 'add-product', steps: 12,
      files: ['features/add-product/domain/AddProduct.domain.ts', 'features/add-product/domain/AddProductStore.domain.ts', 'features/add-product/types.ts', 'features/add-product/services/AddProduct.service.ts', 'features/add-product/hooks/useAddProduct.state.ts', 'features/add-product/controllers/AddProductController.controller.tsx', 'features/add-product/components/AddProductField.component.tsx', 'features/add-product/components/AddProductForm.component.tsx', 'features/add-product/components/AddProductNotice.component.tsx', 'features/add-product/components/AddProductAgain.component.tsx', 'features/add-product/pages/AddProductPage.page.tsx', 'features/add-product/expressions/AddProductByStatus.expression.tsx'],
    },
    {
      // #627: a read worded as an overview of one data object. Its fields are the measures the sentence names ("with totals" is a total).
      shape: 'dashboard', text: 'A manager wants an overview of orders with totals', label: 'Dashboard shape', reason: 'as an overview', unit: 'OrdersDashboard', feature: 'orders-dashboard', steps: 12, entity: 'Order', fields: 'id:string,total:number',
      files: ['features/orders-dashboard/domain/OrdersDashboard.domain.ts', 'features/orders-dashboard/domain/OrdersDashboardStore.domain.ts', 'features/orders-dashboard/types.ts', 'features/orders-dashboard/services/OrdersDashboard.service.ts', 'features/orders-dashboard/hooks/useOrdersDashboard.state.ts', 'features/orders-dashboard/controllers/OrdersDashboardController.controller.tsx', 'features/orders-dashboard/components/OrdersDashboardTile.component.tsx', 'features/orders-dashboard/components/OrdersDashboardTiles.component.tsx', 'features/orders-dashboard/components/OrdersDashboardPanel.component.tsx', 'features/orders-dashboard/components/OrdersDashboardLine.component.tsx', 'features/orders-dashboard/components/OrdersDashboardNotice.component.tsx', 'features/orders-dashboard/pages/OrdersDashboardPage.page.tsx', 'features/orders-dashboard/expressions/OrdersDashboardByStatus.expression.tsx', 'features/orders-dashboard/expressions/OrdersDashboardTileRow.expression.tsx', 'features/orders-dashboard/expressions/OrdersDashboardPanelList.expression.tsx'],
    },
    {
      // #628: a flow worded as steps. Its plan has one more unit than the others: the workflow (the state machine) sits between the service and the hook.
      shape: 'wizard', text: 'A user wants a step by step signup', label: 'Wizard shape', reason: 'step by step', unit: 'Signup', feature: 'signup', steps: 13, units: 7, entity: 'Signup', fields: 'id:string,name:string',
      files: ['features/signup/domain/Signup.domain.ts', 'features/signup/domain/SignupValidity.domain.ts', 'features/signup/domain/SignupScreen.domain.ts', 'features/signup/domain/SignupStore.domain.ts', 'features/signup/types.ts', 'features/signup/services/Signup.service.ts', 'features/signup/workflows/Signup.workflow.ts', 'features/signup/hooks/useSignup.state.ts', 'features/signup/controllers/SignupController.controller.tsx', 'features/signup/components/SignupField.component.tsx', 'features/signup/components/SignupFrame.component.tsx', 'features/signup/components/SignupDetailsStep.component.tsx', 'features/signup/components/SignupReviewStep.component.tsx', 'features/signup/components/SignupDoneStep.component.tsx', 'features/signup/components/SignupNotice.component.tsx', 'features/signup/components/SignupAgain.component.tsx', 'features/signup/pages/SignupPage.page.tsx', 'features/signup/expressions/SignupByStep.expression.tsx'],
    },
  ];
  const entityOf = (s) => s.entity ?? 'Product';
  const unitsOf = (s) => s.units ?? 6;
  const fieldsOf = (s) => s.fields ?? 'id:string,name:string,price:number';
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
      expect(chosen.body.offers[0]).toMatchObject({ id: 'q-shape', chosen: s.shape, default: s.shape, shape: s.shape, unit: s.unit, entity: entityOf(s), fields: fieldsOf(s) });
      expect(chosen.body.offers[0].options.map((o) => o.id)).toEqual([s.shape, 'scaffold']);
      expect(chosen.body.plan.steps.map((x) => x.flow)).toEqual(['create.feature', ...Array(unitsOf(s)).fill('create.unit'), 'sync', 'create.route', 'check.types', 'create.proof', 'test.proof']);
      expect(chosen.body.plan.steps.slice(1, 1 + unitsOf(s)).every((x) => x.args.shape === s.shape && x.args.name === s.unit && x.args.entity === entityOf(s) && x.args.fields === fieldsOf(s))).toBe(true);
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
      for (const c of sent.slice(1, 1 + unitsOf(s))) expect(c).toContain(`--shape ${s.shape} --entity ${entityOf(s)} --fields ${fieldsOf(s)}`);
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

  // #621: where the screen reads its data from is a closed question drawn beside the shape (a second card, its own test ids), with the same
  // suggestion, one-click answers and decision trace. The client draws whatever `offers` carries: nothing here is mocked.
  const chooseSource = async (page, option) => {
    const done = page.waitForResponse(isRead);
    await page.getByTestId(`requirement-source-${option}`).click();
    const res = await done;
    expect(res.status()).toBe(200);
    return { res, body: await res.json() };
  };

  test('the data source card appears once a shape is chosen: local is suggested (no OpenAPI file), nothing is chosen, and choosing changes the files and the steps', async ({ page }) => {
    await gotoCockpit(page, '/requirement');
    await readSentence(page, PRODUCTS);
    await expect(page.getByTestId('requirement-source')).toHaveCount(0); // no shape chosen, no shaped unit: nothing to ask yet
    await choose(page, 'list');
    const card = page.getByTestId('requirement-source');
    await expect(card).toBeVisible();
    await expect(card.getByRole('heading', { name: 'Data source', level: 2 })).toBeVisible();
    await expect(card.getByRole('button')).toHaveText(['Local data, no backend', 'Call GET /api/products']);
    await expect(page.locator('[data-testid="requirement-source-option"][data-option="local"]').getByTestId('requirement-source-suggested')).toHaveText('suggested by rules');
    await expect(page.getByTestId('requirement-source-suggested')).toHaveCount(1);
    await expect(page.getByTestId('requirement-source-reason')).toContainText('No OpenAPI operation for this screen was found');
    await expect(card.getByRole('button', { pressed: true })).toHaveCount(0);
    await expect(page.getByTestId('requirement-source-status')).toHaveText("Not chosen yet, so the plan below uses the rules' default: local data, no backend.");
    await expect(page.getByTestId('requirement-approve-plan')).toBeEnabled();
    // The card after the shape card, before the timeline.
    const order = await page.getByTestId('requirement-stage').locator('[data-testid="requirement-shape"], [data-testid="requirement-source"], [data-testid="requirement-timeline"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
    expect(order).toEqual(['requirement-shape', 'requirement-source', 'requirement-timeline']);
    await expect(page.getByTestId('requirement-files').locator('summary')).toHaveText('11 files will be created');

    const endpoint = await chooseSource(page, 'endpoint');
    expect(endpoint.body.offers.map((o) => [o.id, o.chosen])).toEqual([['q-shape', 'list'], ['q-source', 'endpoint'], ['q-states', null], ['q-verify', null]]);
    expect(endpoint.body.plan.steps.filter((s) => s.flow === 'create.unit').every((s) => s.args.source === 'endpoint')).toBe(true);
    expect(endpoint.res.request().postDataJSON().answers).toEqual([{ id: 'q-shape', option: 'list' }, { id: 'q-source', option: 'endpoint' }]);
    await expect(page.getByTestId('requirement-source-endpoint')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('requirement-source-local')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('requirement-source-status')).toHaveText('Chosen: Call GET /api/products. Decided by: person.');
    await expect(page.getByTestId('requirement-source-status')).toHaveAttribute('data-decided-by', 'person');
    await expect(page.getByTestId('requirement-files').locator('summary')).toHaveText('10 files will be created'); // no local store
    expect(await listedFiles(page)).toEqual(LIST_FILES.filter((f) => !f.includes('Store')));
    await expect(page.getByTestId('requirement-shape-list')).toHaveAttribute('aria-pressed', 'true'); // the shape answer is kept

    const local = await chooseSource(page, 'local'); // a changed mind replaces the earlier answer
    expect(local.res.request().postDataJSON().answers).toEqual([{ id: 'q-shape', option: 'list' }, { id: 'q-source', option: 'local' }]);
    await expect(page.getByTestId('requirement-source-status')).toHaveText('Chosen: Local data, no backend. Decided by: person.');
    expect(await listedFiles(page)).toEqual(LIST_FILES);
  });

  test('Approve with the endpoint source starts a process whose steps carry --source endpoint; with nothing chosen the steps carry the default, --source local; and the choice is recorded', async ({ page }) => {
    await gotoCockpit(page, '/requirement');
    await readSentence(page, PRODUCTS);
    await choose(page, 'list');
    await chooseSource(page, 'endpoint');
    const ran = page.waitForResponse((r) => r.url().endsWith('/api/plan/run') && r.request().method() === 'POST');
    await page.getByTestId('requirement-approve-plan').click();
    const res = await ran;
    expect(res.status()).toBe(200);
    const sent = res.request().postDataJSON().plan.steps.map((x) => planToCommand(x).argv.join(' '));
    for (const c of sent.slice(1, 7)) expect(c).toContain('--shape list --entity Product --fields id:string,name:string,price:number --source endpoint');
    expect(sent.at(-2)).toContain('--source endpoint --kind render'); // the proof step is written from the same source
    for (const f of LIST_FILES) expect(fs.existsSync(path.join(project.repo, f)), f).toBe(false); // approving starts a process; nothing is written by this route
    const recordedSource = readTraces(project.repo, { stateDir: STATE_DIR }).decisions.filter((d) => d.chooser.id === 'requirement.plan.source' && d.chosen === 'endpoint');
    expect(recordedSource[0]).toMatchObject({ by: 'person', suggestion: { option: 'local' }, provider: { name: 'rules', version: '1' }, outcome: { accepted: false } });

    await gotoCockpit(page, '/requirement');
    await readSentence(page, PRODUCTS);
    await choose(page, 'list');
    const again = page.waitForResponse((r) => r.url().endsWith('/api/plan/run') && r.request().method() === 'POST');
    await page.getByTestId('requirement-approve-plan').click();
    const second = (await again).request().postDataJSON().plan.steps.map((x) => planToCommand(x).argv.join(' '));
    for (const c of second.slice(1, 7)) expect(c).toContain('--source local');
  });

  test('a project with an OpenAPI file that has the operation is offered the contract first, and it is the rules default; a spec without the operation is not offered', async ({ page }) => {
    const spec = path.join(project.repo, 'openapi.yaml');
    fs.writeFileSync(spec, "openapi: 3.0.3\ninfo: { title: Shop, version: '1' }\nservers: [{ url: /v1 }]\npaths:\n  /products:\n    get: { operationId: listProducts, responses: { '200': { description: ok } } }\n");
    try {
      await gotoCockpit(page, '/requirement');
      await readSentence(page, PRODUCTS);
      await choose(page, 'list');
      const card = page.getByTestId('requirement-source');
      await expect(card.getByRole('button')).toHaveText(['Use the contract in openapi.yaml', 'Local data, no backend', 'Call GET /api/products']);
      await expect(page.locator('[data-testid="requirement-source-option"][data-option="openapi"]').getByTestId('requirement-source-suggested')).toHaveText('suggested by rules');
      await expect(page.locator('[data-testid="requirement-source-option"][data-option="openapi"]')).toContainText('Requests GET /v1/products (listProducts)');
      await expect(page.getByTestId('requirement-source-status')).toHaveText("Not chosen yet, so the plan below uses the rules' default: use the contract in openapi.yaml.");
      const chosen = await chooseSource(page, 'openapi');
      expect(chosen.body.plan.steps.filter((s) => s.flow === 'create.unit').every((s) => s.args.source === 'openapi')).toBe(true);
      expect(JSON.stringify(chosen.body)).not.toContain(project.repo); // no server path leaves the server
      // A spec that has no operation for this entity: the option is not offered.
      fs.writeFileSync(spec, "openapi: 3.0.3\ninfo: { title: Shop, version: '1' }\npaths:\n  /orders:\n    get: { operationId: listOrders, responses: { '200': { description: ok } } }\n");
      await gotoCockpit(page, '/requirement');
      await readSentence(page, PRODUCTS);
      await choose(page, 'list');
      await expect(page.getByTestId('requirement-source').getByRole('button')).toHaveText(['Local data, no backend', 'Call GET /api/products']);
    } finally {
      fs.rmSync(spec, { force: true });
    }
  });

  // #632: the other closed questions of the plan (the type-check, the environment variables) come back in `offers` and are drawn as cards of the kind
  // `plan` with no client rule of their own but a heading: the same buttons, the same suggested badge, the same status words, the same answer route.
  const planCard = (page, id) => page.locator(`[data-testid="requirement-plan"][data-offer="${id}"]`);
  const choosePlan = async (page, id, option) => {
    const done = page.waitForResponse(isRead);
    await planCard(page, id).locator(`[data-option="${option}"] button`).click();
    const res = await done;
    expect(res.status()).toBe(200);
    return { res, body: await res.json() };
  };

  test('the verification card (q-verify) appears once a shape is chosen: the type-check is suggested, nothing is chosen, and choosing changes the plan and is recorded', async ({ page }) => {
    await gotoCockpit(page, '/requirement');
    await readSentence(page, PRODUCTS);
    await expect(page.getByTestId('requirement-plan')).toHaveCount(0); // no shape chosen, no shaped unit: nothing to verify yet
    await choose(page, 'list');
    const card = planCard(page, 'q-verify');
    await expect(card).toBeVisible();
    await expect(card.getByRole('heading', { name: 'Verification', level: 2 })).toBeVisible();
    // #659: the questions of the plan sit under one heading, in the order they were asked; the shape card is above the group, and every test id is what it was.
    const group = page.getByTestId('requirement-plan-questions');
    await expect(group.getByRole('heading', { name: 'Plan questions', level: 2 })).toBeVisible();
    await expect(page.getByTestId('requirement-plan-questions-note')).toContainText("an unanswered one uses the rules' default, and Approve never waits for it");
    await expect(group.getByTestId('requirement-source')).toHaveCount(1);
    await expect(group.getByTestId('requirement-plan')).toHaveCount(2); // #622: how the screen shows its states, then the verification
    await expect(group.getByTestId('requirement-shape')).toHaveCount(0);
    await expect(group).toHaveAttribute('aria-labelledby', 'rq-plan-questions-h');
    await expect(card.getByRole('button')).toHaveText(['Type-check after the wiring', 'No verification step']); // building is not offered: this project has no build script
    await expect(card.locator('[data-option="types"]').getByTestId('requirement-plan-suggested')).toHaveText('suggested by rules');
    await expect(card.getByRole('button', { pressed: true })).toHaveCount(0);
    await expect(card.getByTestId('requirement-plan-status')).toHaveText("Not chosen yet, so the plan below uses the rules' default: type-check after the wiring.");
    await expect(page.getByTestId('requirement-approve-plan')).toBeEnabled(); // a closed question never blocks Approve
    const order = await page.getByTestId('requirement-stage').locator('[data-testid="requirement-shape"], [data-testid="requirement-source"], [data-testid="requirement-plan"], [data-testid="requirement-timeline"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
    expect(order).toEqual(['requirement-shape', 'requirement-source', 'requirement-plan', 'requirement-plan', 'requirement-timeline']);

    const none = await choosePlan(page, 'q-verify', 'none');
    expect(none.res.request().postDataJSON().answers).toEqual([{ id: 'q-shape', option: 'list' }, { id: 'q-verify', option: 'none' }]);
    expect(none.body.plan.steps.some((s) => s.flow === 'check.types')).toBe(false);
    expect(none.body.offers.map((o) => [o.id, o.chosen])).toEqual([['q-shape', 'list'], ['q-source', null], ['q-states', null], ['q-verify', 'none']]);
    await expect(card.locator('[data-option="none"] button')).toHaveAttribute('aria-pressed', 'true');
    await expect(card.getByTestId('requirement-plan-status')).toHaveText('Chosen: No verification step. Decided by: person.');
    await expect(card.getByTestId('requirement-plan-status')).toHaveAttribute('data-decided-by', 'person');

    const types = await choosePlan(page, 'q-verify', 'types'); // a changed mind replaces the earlier answer
    expect(types.res.request().postDataJSON().answers).toEqual([{ id: 'q-shape', option: 'list' }, { id: 'q-verify', option: 'types' }]);
    expect(types.body.plan.steps.slice(-3).map((s) => s.flow)).toEqual(['check.types', 'create.proof', 'test.proof']); // after the wiring, the proof stays last
    expect(types.body.plan.steps.find((s) => s.flow === 'check.types').touches).toEqual({ features: [], files: [] }); // read-only
    expect(JSON.stringify(types.body)).not.toContain(project.repo); // no server path leaves the server
    await expect(card.getByTestId('requirement-plan-status')).toHaveText('Chosen: Type-check after the wiring. Decided by: person.');
    await expect(page.getByTestId('requirement-shape-list')).toHaveAttribute('aria-pressed', 'true'); // the earlier answers are kept

    const ran = page.waitForResponse((r) => r.url().endsWith('/api/plan/run') && r.request().method() === 'POST');
    await page.getByTestId('requirement-approve-plan').click();
    const sent = (await ran).request().postDataJSON().plan.steps.map((x) => planToCommand(x).argv.join(' '));
    expect(sent.at(-2)).toMatch(/^create proof /);
    expect(sent.at(-1)).toMatch(/^test proof /);
    expect(sent.indexOf('test types')).toBe(sent.length - 3); // the step is the real command, before the proof
    const [d] = recorded('requirement.plan.verify', 'types');
    expect(d).toMatchObject({ by: 'person', suggestion: { option: 'types' }, provider: { name: 'rules', version: '1' }, outcome: { accepted: true } });
  });

  test('a card that needs a secret gets a card per environment variable: add is suggested, skipping one removes its step, and the add.env steps are the real commands', async ({ page }) => {
    await gotoCockpit(page, '/requirement');
    const read = page.waitForResponse(isRead);
    await page.getByTestId('requirement-text').fill('A logged-in user wants to safely manage billing details Stripe');
    await page.getByTestId('requirement-read').click();
    const body = await (await read).json();
    expect(body.offers.map((o) => o.id)).toEqual(['q-env-stripe-secret-key', 'q-env-allowed-redirect-origins']);
    expect(body.plan.steps.filter((s) => s.flow === 'add.env').map((s) => s.args)).toEqual([{ name: 'STRIPE_SECRET_KEY', scope: 'server' }, { name: 'ALLOWED_REDIRECT_ORIGINS', scope: 'server' }]);
    await expect(page.getByTestId('requirement-plan')).toHaveCount(2);
    const stripe = planCard(page, 'q-env-stripe-secret-key');
    await expect(stripe.getByRole('heading', { name: 'Environment variable', level: 2 })).toBeVisible();
    await expect(stripe).toContainText('STRIPE_SECRET_KEY');
    await expect(stripe.getByRole('button')).toHaveText(['Add STRIPE_SECRET_KEY to .env.example', 'Do not add it']);
    await expect(stripe.locator('[data-option="add"]').getByTestId('requirement-plan-suggested')).toHaveText('suggested by rules');
    await expect(stripe.getByTestId('requirement-plan-status')).toHaveText("Not chosen yet, so the plan below uses the rules' default: add STRIPE_SECRET_KEY to .env.example.");
    await expect(page.getByTestId('requirement-approve-plan')).toBeEnabled();

    const skipped = await choosePlan(page, 'q-env-stripe-secret-key', 'skip');
    expect(skipped.res.request().postDataJSON().answers).toEqual([{ id: 'q-env-stripe-secret-key', option: 'skip' }]);
    expect(skipped.body.plan.steps.filter((s) => s.flow === 'add.env').map((s) => s.args.name)).toEqual(['ALLOWED_REDIRECT_ORIGINS']);
    await expect(stripe.getByTestId('requirement-plan-status')).toHaveText('Chosen: Do not add it. Decided by: person.');
    await expect(planCard(page, 'q-env-allowed-redirect-origins').getByRole('button', { pressed: true })).toHaveCount(0); // the other card is untouched
    const ran = page.waitForResponse((r) => r.url().endsWith('/api/plan/run') && r.request().method() === 'POST');
    await page.getByTestId('requirement-approve-plan').click();
    const sent = (await ran).request().postDataJSON().plan.steps.map((x) => planToCommand(x).argv.join(' '));
    expect(sent.filter((c) => c.startsWith('create env'))).toEqual(['create env ALLOWED_REDIRECT_ORIGINS --scope server']);
    expect(fs.existsSync(path.join(project.repo, '.env.example'))).toBe(false); // approving starts a process; nothing is written by this route
    const [d] = recorded('requirement.plan.env', 'skip');
    expect(d).toMatchObject({ by: 'person', suggestion: { option: 'add' }, outcome: { accepted: false } });
  });

  test('the wizard step count (q-steps, #659) is a plan card with a plain line about steps: three is suggested, nothing is chosen, and choosing four changes every unit and is recorded', async ({ page }) => {
    await gotoCockpit(page, '/requirement');
    await readSentence(page, WIZARD);
    await expect(page.getByTestId('requirement-plan-questions')).toHaveCount(0); // no shape chosen, no wizard yet: nothing to ask
    const first = await choose(page, 'wizard');
    expect(first.body.offers.map((o) => [o.id, o.chosen])).toEqual([['q-shape', 'wizard'], ['q-source', null], ['q-steps', null], ['q-dependency', null], ['q-verify', null]].filter(([id]) => first.body.offers.some((o) => o.id === id)));
    const card = planCard(page, 'q-steps');
    await expect(card).toBeVisible();
    await expect(card.getByRole('heading', { name: 'Wizard steps', level: 2 })).toBeVisible();
    await expect(card.getByTestId('requirement-plan-hint')).toHaveText('A step is one screen of the wizard: Next and Back move between steps, each step but the last takes some of the fields, and the last one shows them all and submits.');
    await expect(card.getByRole('button')).toHaveText(['3 steps: details, review, done', '2 steps: details, done', '4 steps: details, options, review, done']);
    await expect(card.locator('[data-option="three"]').getByTestId('requirement-plan-suggested')).toHaveText('suggested by rules');
    await expect(card.getByTestId('requirement-plan-suggested')).toHaveCount(1);
    await expect(card.getByRole('button', { pressed: true })).toHaveCount(0);
    await expect(card.getByTestId('requirement-plan-status')).toHaveText("Not chosen yet, so the plan below uses the rules' default: 3 steps: details, review, done.");
    await expect(page.getByTestId('requirement-approve-plan')).toBeEnabled(); // a closed question never blocks Approve
    // The group: the shape card, then "Plan questions" with the data source, the steps and the rest, then the timeline.
    const order = await page.getByTestId('requirement-stage').locator('[data-testid="requirement-shape"], [data-testid="requirement-plan-questions"], [data-testid="requirement-timeline"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
    expect(order).toEqual(['requirement-shape', 'requirement-plan-questions', 'requirement-timeline']);
    expect(await page.getByTestId('requirement-plan-questions').locator('[data-offer]').evaluateAll((els) => els.map((e) => e.getAttribute('data-offer')))).toEqual(first.body.offers.filter((o) => o.id !== 'q-shape').map((o) => o.id));
    const stepsOf = (body) => [...new Set(body.plan.steps.filter((s) => s.flow === 'create.unit' || (s.flow === 'create.proof' && s.args.kind === 'render')).map((s) => s.args.steps))];
    expect(stepsOf(first.body)).toEqual(['details,review,done']);

    const four = await choosePlan(page, 'q-steps', 'four');
    expect(four.res.request().postDataJSON().answers).toEqual([{ id: 'q-shape', option: 'wizard' }, { id: 'q-steps', option: 'four' }]);
    expect(stepsOf(four.body)).toEqual(['details,options,review,done']); // every unit and the proof carry the four steps
    expect(four.body.plan.steps.filter((s) => s.flow === 'create.unit').map((s) => planToCommand(s).argv.join(' ')).every((c) => c.includes('--steps details,options,review,done'))).toBe(true);
    expect(four.body.placement.decisions.at(-1)).toEqual({ question: 'q-steps', option: 'four', by: 'person' });
    await expect(card.locator('[data-option="four"] button')).toHaveAttribute('aria-pressed', 'true');
    await expect(card.getByTestId('requirement-plan-status')).toHaveText('Chosen: 4 steps: details, options, review, done. Decided by: person.');
    await expect(card.getByTestId('requirement-plan-status')).toHaveAttribute('data-decided-by', 'person');
    await expect(page.getByTestId('requirement-shape-wizard')).toHaveAttribute('aria-pressed', 'true'); // the earlier answer is kept
    expect(await listedFiles(page)).toContain('features/signup/components/SignupOptionsStep.component.tsx'); // the fourth step is a component
    expect(JSON.stringify(four.body)).not.toContain(project.repo); // no server path leaves the server
    const two = await choosePlan(page, 'q-steps', 'two'); // a changed mind replaces the earlier answer
    expect(two.res.request().postDataJSON().answers).toEqual([{ id: 'q-shape', option: 'wizard' }, { id: 'q-steps', option: 'two' }]);
    expect(stepsOf(two.body)).toEqual(['details,done']);
    const [d] = recorded('requirement.plan.steps', 'four');
    expect(d).toMatchObject({ by: 'person', suggestion: { option: 'three' }, provider: { name: 'rules', version: '1' }, outcome: { accepted: false } });
    expect(recorded('requirement.plan.steps', 'two')).toHaveLength(1);
  });

  test('the screen states card (q-states, #622) is a plan card with a plain line about states: default views are suggested, nothing is chosen, and choosing a skip warns, changes the files and is recorded', async ({ page }) => {
    await gotoCockpit(page, '/requirement');
    await readSentence(page, PRODUCTS);
    await expect(planCard(page, 'q-states')).toHaveCount(0); // no shape chosen, no screen yet: nothing to ask
    const first = await choose(page, 'list');
    expect(first.body.offers.map((o) => o.id).slice(0, 3)).toEqual(['q-shape', 'q-source', 'q-states']);
    const card = planCard(page, 'q-states');
    await expect(card).toBeVisible();
    await expect(card.getByRole('heading', { name: 'Screen states', level: 2 })).toBeVisible();
    await expect(card.getByTestId('requirement-plan-hint')).toHaveText('A state is what the screen shows in one situation: while the data loads, when there is nothing to show (or the item is not found), and when the request fails. Skipping one leaves it without a view.');
    await expect(card.getByRole('button')).toHaveText(['Default views, a short message for each state', 'A component of your own for each state', 'Skip the empty view (a warning)', 'Skip every state view (a warning)']);
    await expect(card.locator('[data-option="default"]').getByTestId('requirement-plan-suggested')).toHaveText('suggested by rules');
    await expect(card.getByTestId('requirement-plan-suggested')).toHaveCount(1);
    await expect(card.getByRole('button', { pressed: true })).toHaveCount(0);
    await expect(card.getByTestId('requirement-plan-status')).toHaveText("Not chosen yet, so the plan below uses the rules' default: default views, a short message for each state.");
    await expect(page.getByTestId('requirement-warning')).toHaveCount(0);
    await expect(page.getByTestId('requirement-approve-plan')).toBeEnabled(); // a closed question never blocks Approve
    expect(await listedFiles(page)).toContain('features/products/components/ProductsNotice.component.tsx');

    const custom = await choosePlan(page, 'q-states', 'custom');
    expect(custom.res.request().postDataJSON().answers).toEqual([{ id: 'q-shape', option: 'list' }, { id: 'q-states', option: 'custom' }]);
    expect(await listedFiles(page)).toEqual(expect.arrayContaining(['features/products/components/ProductsLoading.component.tsx', 'features/products/components/ProductsEmpty.component.tsx', 'features/products/components/ProductsFailed.component.tsx']));
    await expect(page.getByTestId('requirement-warning')).toHaveCount(0); // a view of your own is not a gap

    const skipped = await choosePlan(page, 'q-states', 'skip-all'); // a changed mind replaces the earlier answer
    expect(skipped.res.request().postDataJSON().answers).toEqual([{ id: 'q-shape', option: 'list' }, { id: 'q-states', option: 'skip-all' }]);
    expect(skipped.body.plan.steps.filter((s) => s.flow === 'create.unit' || s.flow === 'create.proof').every((s) => s.args.states === 'skip-all')).toBe(true);
    expect(skipped.body.plan.steps.filter((s) => s.flow === 'create.unit').map((s) => planToCommand(s).argv.join(' ')).every((c) => c.includes('--states skip-all'))).toBe(true);
    expect(skipped.body.placement.decisions.at(-1)).toEqual({ question: 'q-states', option: 'skip-all', by: 'person' });
    await expect(card.locator('[data-option="skip-all"] button')).toHaveAttribute('aria-pressed', 'true');
    await expect(card.getByTestId('requirement-plan-status')).toHaveText('Chosen: Skip every state view (a warning). Decided by: person.');
    await expect(page.getByTestId('requirement-warning')).toContainText('The Products screen has no view for any state');
    await expect(page.getByTestId('requirement-approve-plan')).toBeEnabled(); // a skip is a warning, never a block
    expect(await listedFiles(page)).not.toContain('features/products/components/ProductsNotice.component.tsx'); // nothing uses the notice
    await expect(page.getByTestId('requirement-shape-list')).toHaveAttribute('aria-pressed', 'true'); // the earlier answer is kept
    expect(JSON.stringify(skipped.body)).not.toContain(project.repo); // no server path leaves the server
    const [d] = recorded('requirement.plan.states', 'skip-all');
    expect(d).toMatchObject({ by: 'person', suggestion: { option: 'default' }, provider: { name: 'rules', version: '1' }, outcome: { accepted: false } });
    expect(recorded('requirement.plan.states', 'custom')).toHaveLength(1);
  });

  test('the plan cards pass the accessibility check at 390 px in both themes, and do not scroll sideways', async ({ page }) => {
    for (const theme of ['dark', 'light']) {
      await page.addInitScript((t) => localStorage.setItem('construct.theme', t), theme);
      await page.setViewportSize({ width: 390, height: 844 });
      for (const [sentence, shape] of [[PRODUCTS, 'list'], ['A logged-in user wants to safely manage billing details Stripe', null], [WIZARD, 'wizard']]) {
        await gotoCockpit(page, '/requirement');
        await readSentence(page, sentence);
        if (shape) await choose(page, shape);
        await expect(page.getByTestId('requirement-plan').first()).toBeVisible();
        await expect(page.getByTestId('requirement-plan-questions')).toBeVisible(); // #659: the group, its heading and its line are part of what axe reads
        await page.getByTestId('requirement-files').locator('summary').evaluate((el) => el.scrollIntoView({ block: 'center' }));
        const found = await runAxe(page);
        expect(found.filter(isBlocking), `${theme} ${shape ?? 'env'}: ${format(found.filter(isBlocking))}`).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${theme} ${shape ?? 'env'}: page scroll`).toBe(true);
        expect(await page.getByTestId('requirement-plan-questions').evaluate((el) => el.scrollWidth <= el.clientWidth + 1), `${theme} ${shape ?? 'env'}: group scroll`).toBe(true);
        for (const card of await page.getByTestId('requirement-plan').all()) expect(await card.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), `${theme}: card scroll`).toBe(true);
      }
    }
  });

  test('the data source card passes the accessibility check at 390 px in both themes, and does not scroll sideways', async ({ page }) => {
    for (const theme of ['dark', 'light']) {
      await page.addInitScript((t) => localStorage.setItem('construct.theme', t), theme);
      await page.setViewportSize({ width: 390, height: 844 });
      await gotoCockpit(page, '/requirement');
      await readSentence(page, PRODUCTS);
      await choose(page, 'list');
      for (const step of ['unanswered', 'endpoint chosen']) {
        if (step === 'endpoint chosen') {
          await chooseSource(page, 'endpoint');
          await expect(page.getByTestId('requirement-source-endpoint')).toHaveAttribute('aria-pressed', 'true'); // the redraw has landed
        }
        // axe reads target-size at the current scroll position (the narrow layout has a fixed bottom bar): put the files summary mid-screen first.
        await page.getByTestId('requirement-files').locator('summary').evaluate((el) => el.scrollIntoView({ block: 'center' }));
        const found = await runAxe(page);
        expect(found.filter(isBlocking), `${theme} ${step}: ${format(found.filter(isBlocking))}`).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${theme} ${step}: page scroll`).toBe(true);
        expect(await page.getByTestId('requirement-source').evaluate((el) => el.scrollWidth <= el.clientWidth + 1), `${theme} ${step}: card scroll`).toBe(true);
      }
    }
  });

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
