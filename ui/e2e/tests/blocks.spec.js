import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { gotoCockpit } from './support/cockpit.js';
import { makeBrowseProject, openProject } from './support/browseProject.js';
import { runAxe, isBlocking, format } from './support/axe.js';
import { openBlockSettingsStore } from '../../server/src/blockSettingsStore.mjs';

// #407 -- Blocks: the mechanical blocks in place, per-project settings, and "Run this block", end to end in a real browser
// against the real server and a real throwaway git project. Nothing is mocked. The settings are a file in the per-user
// state directory; the refusal of a turned-off block is the server's real plan check, proven by a real POST that starts
// no process.
const API = process.env.E2E_API_BASE || 'http://localhost:4000';
const STATE_DIR = process.env.E2E_STATE_DIR;
const browser = (page) => page.getByRole('complementary', { name: 'Browser' });
const cards = (page) => browser(page).getByTestId('block-card');
const card = (page, id) => browser(page).locator(`[data-testid="block-card"][data-block-id="${id}"]`);
const openBlocks = async (page) => {
  await gotoCockpit(page, '/');
  await browser(page).getByRole('tab', { name: 'Blocks' }).click();
  await expect(cards(page).first()).toBeVisible();
};

test.describe.serial('Blocks: catalogue, per-project settings, refusal (#407)', () => {
  let project;
  let restore;
  const store = () => openBlockSettingsStore(project.repo, { stateDir: STATE_DIR });

  test.beforeAll(async () => {
    project = makeBrowseProject('og407-blocks-');
    restore = await openProject(API, project.repo);
  });
  test.afterAll(async () => {
    await restore?.();
    project?.remove();
  });

  test('the Blocks tab lists every block once, in plain words, with what it reads and writes and whether it can use a model', async ({ page }) => {
    await openBlocks(page);
    await expect(browser(page).getByRole('tab', { name: 'Blocks' })).toHaveAttribute('aria-selected', 'true');
    await expect(cards(page)).toHaveCount(25);
    await expect(page.getByTestId('blocks-summary')).toHaveText('25 blocks');

    const validate = card(page, 'validate');
    await expect(validate.getByTestId('block-kind')).toHaveText('Read-only');
    await expect(validate.getByTestId('block-model-calls')).toHaveText('model calls: 0');
    await expect(validate).toContainText('Check the whole project against its architecture rules');
    await expect(validate.getByTestId('block-runs')).toHaveText('Not run in this project yet');
    await expect(validate.getByTestId('block-toggle')).toBeChecked();

    const create = card(page, 'create.unit');
    await expect(create.getByTestId('block-kind')).toHaveText('Writes files');
    await expect(create.getByTestId('block-model-calls')).toHaveText('can use a model');
    await expect(browser(page).getByText('can use a model')).toHaveCount(4);
    await expect(browser(page).getByText('model calls: 0')).toHaveCount(21);
    await expect(browser(page).getByText('Read-only')).toHaveCount(9);

    // Details fold away: reads, writes, arguments and one concrete example (the exact command).
    await expect(create.getByTestId('block-details')).not.toHaveAttribute('open', '');
    await create.getByText('Details').click();
    await expect(create.getByTestId('block-reads')).toContainText('architecture.yml');
    await expect(create.getByTestId('block-writes')).toHaveText('One new file in the feature.');
    await expect(create.getByTestId('block-args')).toContainText('layer (needed)');
    await expect(create.getByTestId('block-args')).toContainText('feature (needed)');
    await expect(create.getByTestId('block-example')).toContainText('construct create domain Cart --feature checkout');
    // Default engine only where there is a model path.
    await expect(create.getByTestId('block-engine')).toBeVisible();
    await expect(create.getByTestId('block-engine-mechanical')).toHaveAttribute('aria-pressed', 'true');
    await validate.getByText('Details').click();
    await expect(validate.getByTestId('block-engine')).toHaveCount(0);
    await expect(validate.getByTestId('block-engine-fixed')).toContainText('no model path');

    // The one block the Cockpit never offers cannot be switched.
    const pipe = card(page, 'pipeline.run');
    await expect(pipe.getByTestId('block-toggle')).toBeDisabled();
    await expect(pipe.getByTestId('block-off-note')).toContainText('not offered in the Cockpit');

    // The filter narrows the list by words in the id or the purpose.
    await page.getByTestId('blocks-filter').fill('wizard');
    await expect(cards(page)).toHaveCount(1);
    await expect(cards(page).first()).toHaveAttribute('data-block-id', 'import.route');
    await page.getByTestId('blocks-filter').fill('zzzz');
    await expect(page.getByTestId('blocks-empty')).toHaveText('No block matches that.');
    await page.getByTestId('blocks-filter').fill('');
    await expect(cards(page)).toHaveCount(25);
  });

  test('turn a block off: the card, the summary and the file in the state directory agree, and a reload keeps it', async ({ page }) => {
    await openBlocks(page);
    expect(store().disabledFlows().flows).toEqual([]);
    await card(page, 'create.unit').getByTestId('block-toggle').click();
    await expect(card(page, 'create.unit').getByTestId('block-toggle')).not.toBeChecked();
    await expect(page.getByTestId('blocks-summary')).toHaveText('25 blocks, 1 turned off');
    await expect(card(page, 'create.unit').getByTestId('block-off-note')).toContainText('Turned off for this project');
    expect(store().disabledFlows().flows).toEqual(['create.unit']);
    expect(project.git('status', '--porcelain').trim()).toBe('');

    await page.reload();
    await browser(page).getByRole('tab', { name: 'Blocks' }).click();
    await expect(card(page, 'create.unit').getByTestId('block-toggle')).not.toBeChecked();
    await expect(page.getByTestId('blocks-summary')).toHaveText('25 blocks, 1 turned off');
  });

  test('a plan that uses the turned-off block is refused with a plain sentence, Run plan stays off, and NOTHING starts', async ({ page, request }) => {
    const before = (await (await request.get(`${API}/api/processes`)).json()).processes.length;
    await gotoCockpit(page, '/');
    await page.getByTestId('plan-add-flow').selectOption('create.unit');
    await page.getByTestId('plan-add').click();
    await expect(page.getByTestId('plan-step')).toHaveCount(1);
    await page.getByTestId('plan-arg-layer').fill('domain');
    await page.getByTestId('plan-arg-name').fill('Cart');
    await page.getByTestId('plan-arg-feature').fill('billing');
    await expect(page.getByTestId('plan-step-errors')).toContainText('The block "create.unit" is turned off for this project');
    await expect(page.getByTestId('plan-run')).toBeDisabled();

    // The same plan sent straight to the server (a script, not this screen) is refused by name, and no process appears.
    const plan = { version: 1, ticket: { source: 'text', title: 'Add a cart' }, steps: [{ id: 's1', title: 'Add Cart', flow: 'create.unit', args: { layer: 'domain', name: 'Cart', feature: 'billing' }, executor: 'deterministic', touches: { features: ['billing'] } }] };
    const refused = await request.post(`${API}/api/plan/run`, { data: { plan } });
    expect(refused.status()).toBe(400);
    const body = await refused.json();
    expect(body.errors.map((e) => e.code)).toContain('COCKPIT_BLOCK_DISABLED');
    expect((await (await request.get(`${API}/api/processes`)).json()).processes).toHaveLength(before);
    expect(project.git('status', '--porcelain').trim()).toBe('');

    // A block that is still on is not affected.
    const ok = await request.post(`${API}/api/plan/validate`, { data: { plan: { ...plan, steps: [{ id: 's1', title: 'List', flow: 'summarize.list', args: { kind: 'feature' }, executor: 'deterministic' }] } } });
    expect((await ok.json()).valid).toBe(true);
  });

  test('turn it back on: the same plan is valid again', async ({ page, request }) => {
    await openBlocks(page);
    await card(page, 'create.unit').getByTestId('block-toggle').click();
    await expect(card(page, 'create.unit').getByTestId('block-toggle')).toBeChecked();
    await expect(page.getByTestId('blocks-summary')).toHaveText('25 blocks');
    expect(store().disabledFlows().flows).toEqual([]);
    const plan = { version: 1, ticket: { source: 'text', title: 'Add a cart' }, steps: [{ id: 's1', title: 'Add Cart', flow: 'create.unit', args: { layer: 'domain', name: 'Cart', feature: 'billing' }, executor: 'deterministic', touches: { features: ['billing'] } }] };
    const v = await (await request.post(`${API}/api/plan/validate`, { data: { plan } })).json();
    expect(v.valid, JSON.stringify(v.errors)).toBe(true);
  });

  test('the default engine and model are saved where a model path exists; the server\'s refusal shows on the card', async ({ page }) => {
    await openBlocks(page);
    const create = card(page, 'create.layer');
    await create.getByText('Details').click();
    await create.getByTestId('block-engine-ai').click();
    await expect(create.getByTestId('block-engine-ai')).toHaveAttribute('aria-pressed', 'true');
    await create.getByTestId('block-model').fill('qwen2.5-coder:7b');
    await create.getByTestId('block-model-save').click();
    await expect(create.getByTestId('block-model-save')).toBeDisabled();
    expect(store().read().record.blocks['create.layer']).toEqual({ engine: 'ai', model: 'qwen2.5-coder:7b' });

    // A model name the server does not accept is refused in its own words, and the saved copy stays.
    await create.getByTestId('block-model').fill('--evil');
    await create.getByTestId('block-model-save').click();
    await expect(create.getByTestId('block-refusal')).toContainText('must be a model name');
    expect(store().read().record.blocks['create.layer'].model).toBe('qwen2.5-coder:7b');

    // Back to the defaults leaves nothing stored.
    await create.getByTestId('block-engine-mechanical').click();
    await expect(create.getByTestId('block-engine-mechanical')).toHaveAttribute('aria-pressed', 'true');
    await create.getByTestId('block-model').fill('');
    await create.getByTestId('block-model-save').click();
    await expect.poll(() => store().read().record.blocks).toEqual({});
  });

  test('damaged settings are reported with a Reset; every plan is refused until then', async ({ page, request }) => {
    fs.mkdirSync(path.dirname(store().file), { recursive: true });
    fs.writeFileSync(store().file, '{broken');
    await openBlocks(page);
    await expect(page.getByTestId('blocks-unreadable')).toContainText('could not be read');
    const plan = { version: 1, ticket: { source: 'text', title: 'List' }, steps: [{ id: 's1', title: 'List', flow: 'summarize.list', args: {}, executor: 'deterministic' }] };
    const refused = await request.post(`${API}/api/plan/run`, { data: { plan } });
    expect(refused.status()).toBe(400);
    expect((await refused.json()).errors.map((e) => e.code)).toContain('COCKPIT_BLOCK_SETTINGS_UNREADABLE');
    await page.getByTestId('blocks-reset').click();
    await expect(page.getByTestId('blocks-unreadable')).toHaveCount(0);
    expect(store().read().unreadable).toBeNull();
    expect((await (await request.post(`${API}/api/plan/validate`, { data: { plan } })).json()).valid).toBe(true);
  });

  test('Run this block opens the Plan tab with that block\'s example as a step, validated by the server, and starts nothing', async ({ page, request }) => {
    const processes = async () => (await (await request.get(`${API}/api/processes`)).json()).processes.length;
    const before = await processes();
    const tools = page.getByRole('complementary', { name: 'Tools' });
    await openBlocks(page);
    // Look at another Tools tab first: Run must bring the Plan tab back.
    await tools.getByRole('tab', { name: 'Project' }).click();
    await expect(tools.getByRole('tab', { name: 'Plan' })).toHaveAttribute('aria-selected', 'false');

    await card(page, 'validate').getByTestId('block-run').click();
    await expect(tools.getByRole('tab', { name: /^Plan/ })).toHaveAttribute('aria-selected', 'true');
    const first = page.getByTestId('plan-step').nth(0);
    await expect(page.getByTestId('plan-step')).toHaveCount(1);
    await expect(first).toHaveAttribute('data-flow', 'validate');
    await expect(first.getByTestId('plan-arg-format')).toHaveValue('text');
    await expect(first.getByTestId('plan-step-command')).toContainText('construct validate --format text');
    await expect(first.getByTestId('plan-step-tag')).toHaveText('Deterministic');
    await expect(page.getByTestId('plan-run')).toBeEnabled();

    // A writing block adds its own example beside it: real arguments, the feature it touches, and the exact command.
    await card(page, 'create.unit').getByTestId('block-run').click();
    const second = page.getByTestId('plan-step').nth(1);
    await expect(page.getByTestId('plan-step')).toHaveCount(2);
    await expect(second).toHaveAttribute('data-flow', 'create.unit');
    await expect(second.getByTestId('plan-arg-layer')).toHaveValue('domain');
    await expect(second.getByTestId('plan-arg-name')).toHaveValue('Cart');
    await expect(second.getByTestId('plan-arg-feature')).toHaveValue('checkout');
    await expect(second.getByTestId('plan-step-touches')).toContainText('checkout');
    await expect(second.getByTestId('plan-step-command')).toContainText('construct create domain Cart --feature checkout');

    // With the default engine set to AI, the step is tagged Local model and the plan says so before anything runs.
    const layer = card(page, 'create.layer');
    await layer.getByText('Details').click();
    await layer.getByTestId('block-engine-ai').click();
    await expect(layer.getByTestId('block-engine-ai')).toHaveAttribute('aria-pressed', 'true');
    await layer.getByTestId('block-run').click();
    const third = page.getByTestId('plan-step').nth(2);
    await expect(third).toHaveAttribute('data-flow', 'create.layer');
    await expect(third.getByTestId('plan-step-tag')).toHaveText('Local model');
    await expect(page.getByTestId('plan-model-notice')).toBeVisible();

    // The step is an ordinary one: it can be edited or removed, and nothing has started.
    await third.getByTestId('plan-step-remove').click();
    await second.getByTestId('plan-step-remove').click();
    await expect(page.getByTestId('plan-step')).toHaveCount(1);
    expect(await processes()).toBe(before);
    expect(project.git('status', '--porcelain').trim()).toBe('');

    // Back to the default engine so later specs see plain settings.
    await layer.getByTestId('block-engine-mechanical').click();
    await expect(layer.getByTestId('block-engine-mechanical')).toHaveAttribute('aria-pressed', 'true');
  });

  test('a turned-off block has no Run: its button is disabled and says why', async ({ page }) => {
    await openBlocks(page);
    await card(page, 'sync').getByTestId('block-toggle').click();
    await expect(card(page, 'sync').getByTestId('block-toggle')).not.toBeChecked();
    await expect(card(page, 'sync').getByTestId('block-run')).toBeDisabled();
    await expect(card(page, 'sync').getByTestId('block-run')).toHaveAttribute('title', 'Turned off for this project.');
    await expect(card(page, 'pipeline.run').getByTestId('block-run')).toBeDisabled();
    await expect(card(page, 'validate').getByTestId('block-run')).toBeEnabled();
    await card(page, 'sync').getByTestId('block-toggle').click();
    await expect(card(page, 'sync').getByTestId('block-run')).toBeEnabled();
  });

  test('at 390px Run this block shows the Tools pane with the new step', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoCockpit(page, '/');
    const panes = page.getByRole('tablist', { name: 'Panes' });
    await panes.getByRole('tab', { name: 'Browser' }).click();
    await browser(page).getByRole('tab', { name: 'Blocks' }).click();
    await card(page, 'summarize.list').getByTestId('block-run').click();
    await expect(panes.getByRole('tab', { name: 'Tools' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('plan-step')).toHaveCount(1);
    await expect(page.getByTestId('plan-step').first()).toHaveAttribute('data-flow', 'summarize.list');
  });

  test('accessible at desktop and narrow widths', async ({ page }) => {
    for (const size of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(size);
      await gotoCockpit(page, '/');
      if (size.width < 900) await page.getByRole('tablist', { name: 'Panes' }).getByRole('tab', { name: 'Browser' }).click();
      await browser(page).getByRole('tab', { name: 'Blocks' }).click();
      await expect(cards(page).first()).toBeVisible();
      await card(page, 'create.unit').getByText('Details').click();
      const found = await runAxe(page);
      expect(found.filter(isBlocking), format(found.filter(isBlocking))).toEqual([]);
    }
  });
});
