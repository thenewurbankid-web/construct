import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { caption, clearCaption, card, pause, saveRecording, startTimeline, writeTimeline, loadDurations } from './support.mjs';
import { startMockOllama } from './mockOllama.mjs';

// Episode 1 (v2): one continuous example, a wishlist for the sample shop, from sign-in to a running app (docs/MEDIA.md).
// A real run of the real Cockpit, real clicks only. The captions below ARE the script.
// Mock, and said on screen: the demo login (GitHub OAuth cannot be automated) and the local model (a stand-in server on
// Ollama's port that answers with fixed code, so a re-record is identical). Everything else is the product.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '../../../../site/assets/video');
const SLUG = '01-ticket-to-story';
const WS = process.env.E2E_WORKSPACE_ROOT;
const SAMPLE = process.env.E2E_SAMPLE_SHOP || path.join(os.homedir(), 'workspace', 'shop');
const SHOP_MODULES = process.env.E2E_SHOP_MODULES; // a node_modules for the sample shop, hard-linked into the copy
const APP_PORT = Number(process.env.E2E_APP_PORT) || 5820;

export const CAPTIONS = {
  introTitle: 'Build a feature, start to finish',
  introSub: 'One example: a wishlist for a small shop',
  signIn: 'First, sign in. Only accounts the owner allowed get in. (This recording uses the demo login.)',
  gate: 'Nothing is open yet. Let us try the sample shop.',
  features: 'Here is the shop, with three features: catalog, cart and checkout.',
  settings: 'Before we start: which model may help? Fill-in work can go to a local model. The plan analysis never does.',
  settingsSaved: 'Saved. Today the model is chosen per kind of job, not yet per block. (This recording uses a stand-in for the local model, so every take is identical.)',
  ticket: 'Now write the ticket, in plain words.',
  propose: 'Ask the Cockpit which parts of the shop it touches.',
  confirm: 'It makes a guess. You confirm it before anything uses it.',
  impact: 'Here is what the change reaches: files and features. Worked out from your code, no AI model.',
  steps: 'It suggests a first step: read the catalog. Now add the real work.',
  stepFeature: 'Step two: create the wishlist feature. A Construct block does it, no model.',
  stepLayers: 'Step three: create its domain, component, page and controller, and let the local model write the code.',
  stepModel: 'The plan says before it runs that a model is used, and which one.',
  plan: 'That is the plan: a checklist, and nothing changes until something runs. Let us do the first steps by hand.',
  createFeature: 'First the mechanical way: create the feature. A Construct block, no model.',
  createdMechanical: 'Done in a blink, with zero model calls. The folders and stubs are there.',
  fillIntro: 'Now the pages and logic. Create a slice: domain, component, page and controller.',
  fillCheck: 'Tick the box to let the local model write the code. It is off unless you choose it, each time.',
  filled: 'Four files written by the model, and each one checked against the rules. (Stand-in model in this recording.)',
  pages: 'The Pages screen shows the real page the model wrote, and its tree of elements.',
  preview: 'Now the best part: open the wishlist in the running shop, at /wishlist.',
  fullscreen: 'Full screen. This is the generated app, running for real.',
  added1: 'Add a product. It appears in the list.',
  added2: 'Add another one.',
  removed: 'Remove one. The list follows.',
  empty: 'Remove the last one: the empty state shows. It all works.',
  route: 'One hand-written line hooks the page up to the /wishlist address. The rest was generated.',
  workflows: 'Logic lives in workflows. This is the checkout flow, drawn from its real code.',
  workflowEdit: 'Add a way back: after a rejected order the shopper can start over.',
  workflowDiff: 'You see the exact change before it is written.',
  validate: 'Finally, the rules. No errors. Two warnings on the new feature: it needs a one-line summary, and its controller is not exported yet. Real findings, and quick fixes.',
  greeting: 'Hi there, and welcome! In a few minutes we will build a small feature together, from a plain request to a working app.',
  signOff: 'That is it. Thanks for watching, and have fun building.',
  outroTitle: 'One example, end to end',
  outroSub: 'Next: review a branch, and run a test.',
};

const TICKET_TITLE = 'Wishlist';
const TICKET_BODY = 'Let shoppers save a product from the catalog for later, and see the saved products on their own page.';

const rail = (page) => page.getByRole('navigation', { name: 'Screens', exact: true });
const drawer = (page) => page.getByRole('region', { name: 'Drawer' });
const stepAt = (page, i) => page.getByTestId('plan-step').nth(i);

test('episode 1: one example, end to end', async ({ page }) => {
  test.setTimeout(900_000);
  fs.mkdirSync(OUT, { recursive: true });
  startTimeline();
  loadDurations(path.join(OUT, `${SLUG}.captions.json`));
  // The sample project the gate offers as "Try the sample shop": a copy of the shop in the (otherwise empty) workspace.
  const shop = path.join(WS, 'shop');
  fs.cpSync(SAMPLE, shop, { recursive: true, filter: (s) => !/[\\/](node_modules|\.next)([\\/]|$)/.test(s) });
  if (SHOP_MODULES) execFileSync('cp', ['-al', SHOP_MODULES, path.join(shop, 'node_modules')]);
  else execFileSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd: shop });

  const model = await startMockOllama();
  const app = spawn('npx', ['next', 'dev', '-p', String(APP_PORT)], { cwd: shop, stdio: 'ignore', detached: true });
  try {
    await page.goto('/');
    await expect(page.getByTestId('login-test-user')).toBeVisible();
    await card(page, CAPTIONS.introTitle, CAPTIONS.introSub, 5000, CAPTIONS.greeting);

    // 1. Sign in (the documented demo login).
    await caption(page, CAPTIONS.signIn);
    await page.getByTestId('login-test-user').click();

    // 2. The gate.
    await expect(page.getByRole('heading', { name: 'Open a project' })).toBeVisible();
    await caption(page, CAPTIONS.gate);
    await page.getByTestId('open-sample-shop').click();
    await expect(rail(page)).toBeVisible();
    await expect(page.locator('h1')).toHaveText('Features');
    await caption(page, CAPTIONS.features);

    // 3. Model settings.
    await page.goto('/settings');
    await expect(page.locator('#llm-createFill')).toBeVisible();
    await caption(page, CAPTIONS.settings);
    await page.locator('#llm-createFill').selectOption('ollama');
    await expect(page.locator('#llm-planAnalysis option[value="ollama"]')).toHaveCount(0);
    await pause(page, 1500);
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.locator('.status-ok')).toBeVisible();
    await caption(page, CAPTIONS.settingsSaved);

    // 4. The ticket.
    await rail(page).getByRole('link', { name: 'Features' }).click();
    await expect(page.locator('h1')).toHaveText('Features');
    await page.getByRole('complementary', { name: 'Browser' }).getByRole('tab', { name: 'Notes' }).click();
    await caption(page, CAPTIONS.ticket);
    await page.getByTestId('plan-ticket-title').pressSequentially(TICKET_TITLE, { delay: 90 });
    await page.getByTestId('plan-ticket-body').pressSequentially(TICKET_BODY, { delay: 60 });
    await pause(page, 1500);

    // 5. Impact.
    await caption(page, CAPTIONS.propose);
    await page.getByTestId('plan-propose').click();
    await expect(page.getByTestId('plan-proposal').first()).toBeVisible();
    await caption(page, CAPTIONS.confirm);
    const catalog = page.getByTestId('plan-proposal').filter({ hasText: 'catalog' }).first();
    await expect(catalog).toBeVisible();
    await catalog.getByTestId('plan-proposal-confirm').click();
    await page.getByTestId('plan-analyse').click();
    await expect(page.getByTestId('plan-impact')).toBeVisible();
    await caption(page, CAPTIONS.impact);

    // 6. The plan: read, create the feature, create its layers with the local model.
    await page.getByTestId('plan-add-suggested').click();
    await expect(page.getByTestId('plan-step').first()).toBeVisible();
    await caption(page, CAPTIONS.steps);
    const suggested = await page.getByTestId('plan-step').count();
    await page.getByTestId('plan-add-flow').selectOption('create.feature');
    await page.getByTestId('plan-add').click();
    await stepAt(page, suggested).getByTestId('plan-arg-name').fill('wishlist');
    await expect(stepAt(page, suggested).getByTestId('plan-step-command')).toHaveText('construct create feature wishlist');
    await caption(page, CAPTIONS.stepFeature);
    await page.getByTestId('plan-add-flow').selectOption('create.layer');
    await page.getByTestId('plan-add').click();
    const layers = stepAt(page, suggested + 1);
    await layers.getByTestId('plan-arg-name').fill('Wishlist');
    await layers.getByTestId('plan-arg-feature').fill('wishlist');
    await layers.getByTestId('plan-arg-layers').fill('domain,component,page,controller');
    await layers.getByTestId('plan-arg-llm').fill('ollama');
    await layers.getByTestId('plan-tag-local-model').click();
    await expect(layers.getByTestId('plan-step-errors')).toHaveCount(0);
    await caption(page, CAPTIONS.stepLayers);
    await expect(page.getByTestId('plan-model-notice')).toContainText('the local model');
    await page.getByTestId('plan-model-notice').scrollIntoViewIfNeeded();
    await caption(page, CAPTIONS.stepModel);

    // 7. Do the work: mechanical first, then the local model fills in the code.
    await caption(page, CAPTIONS.plan);
    await rail(page).getByRole('link', { name: 'Features' }).click();
    await page.getByTestId('stage-action-create').click();
    const form = page.locator('.command-form', { has: page.getByRole('heading', { name: 'Create', exact: true }) });
    await form.getByLabel('What to scaffold').selectOption('feature');
    await form.getByPlaceholder('e.g. CpoAccess').pressSequentially('wishlist', { delay: 90 });
    await caption(page, CAPTIONS.createFeature);
    await form.getByRole('button', { name: 'Run create' }).click();
    await expect(form.locator('.command-output')).toContainText('Created feature wishlist');
    await expect(form.locator('.command-result')).toContainText('0 calls');
    expect(fs.existsSync(path.join(shop, 'features/wishlist/index.ts'))).toBe(true);
    await caption(page, CAPTIONS.createdMechanical);

    await form.getByLabel('What to scaffold').selectOption('layer');
    await form.getByPlaceholder('e.g. CpoAccess').fill('Wishlist');
    await form.getByPlaceholder('e.g. cpo-v2').fill('wishlist');
    for (const layer of ['domain', 'component', 'page', 'controller']) await form.locator('.layer-checkboxes .checkbox', { hasText: layer }).locator('input').check();
    await caption(page, CAPTIONS.fillIntro);
    await form.getByLabel(/Have the LLM write the implementation/).check();
    await caption(page, CAPTIONS.fillCheck);
    await form.getByRole('button', { name: 'Run create' }).click();
    await expect(form.locator('.command-result')).toContainText('via "ollama"', { timeout: 60_000 });
    expect(model.calls.sort()).toEqual(['component', 'controller', 'domain', 'page']);
    expect(fs.readFileSync(path.join(shop, 'features/wishlist/domain/Wishlist.tsx'), 'utf8')).toContain('removeItem');
    await caption(page, CAPTIONS.filled);
    // The one hand-made line: a route file that hands /wishlist to the generated controller (the shop's own app/page.tsx does the same).
    fs.mkdirSync(path.join(shop, 'app', 'wishlist'), { recursive: true });
    fs.writeFileSync(path.join(shop, 'app', 'wishlist', 'page.tsx'), "import { WishlistController } from '../../features/wishlist/controllers/WishlistController';\n\nexport default function Page() {\n  return <WishlistController />;\n}\n");
    await caption(page, CAPTIONS.route);

    // 8. The real page, and its code, on the Pages screen.
    await rail(page).getByRole('link', { name: 'Pages' }).click();
    await page.locator('.pages-browser select').selectOption('wishlist');
    await page.getByRole('button', { name: 'WishlistPage.tsx' }).click();
    await expect(page.locator('.tree-panel')).toBeVisible();
    await caption(page, CAPTIONS.pages);

    // 9. The generated app, running, full screen, used for real.
    await page.getByLabel('Preview URL').fill(`http://localhost:${APP_PORT}/wishlist`);
    await caption(page, CAPTIONS.preview);
    await page.getByRole('button', { name: 'Load preview' }).click();
    const frame = page.frameLocator('iframe[title="Live app preview"]');
    await expect(frame.getByText('Nothing saved yet.')).toBeVisible({ timeout: 180_000 });
    await page.getByRole('button', { name: 'Full screen', exact: true }).click();
    await expect(page.locator('.sh-top')).toHaveCount(0);
    await caption(page, CAPTIONS.fullscreen);
    for (const name of ['Logo T-shirt', 'Enamel mug']) {
      await frame.getByLabel('Product name').pressSequentially(name, { delay: 90 });
      await frame.getByRole('button', { name: 'Add', exact: true }).click();
      await expect(frame.getByRole('listitem').filter({ hasText: name })).toBeVisible();
      await caption(page, name === 'Logo T-shirt' ? CAPTIONS.added1 : CAPTIONS.added2);
    }
    await expect(frame.getByRole('listitem')).toHaveCount(2);
    await frame.getByRole('listitem').filter({ hasText: 'Logo T-shirt' }).getByRole('button', { name: 'Remove' }).click();
    await expect(frame.getByRole('listitem')).toHaveCount(1);
    await caption(page, CAPTIONS.removed);
    await frame.getByRole('listitem').getByRole('button', { name: 'Remove' }).click();
    await expect(frame.getByText('Nothing saved yet.')).toBeVisible();
    await caption(page, CAPTIONS.empty);
    await page.getByRole('button', { name: 'Leave full screen (Esc)' }).click();
    await expect(page.locator('.sh-top')).toBeVisible();

    // 10. Logic in a workflow.
    await page.goto('/workflows');
    await page.getByRole('combobox').first().selectOption('checkout');
    await page.getByRole('button', { name: 'Checkout.tsx' }).click();
    await expect(page.getByTestId('wf-state-idle')).toBeVisible();
    await caption(page, CAPTIONS.workflows);
    await page.getByRole('tab', { name: 'Edit' }).click();
    await caption(page, CAPTIONS.workflowEdit);
    await page.getByLabel('Transition from').selectOption('rejected');
    await page.getByLabel('Event for new transitions').fill('START_OVER');
    await page.getByLabel('Transition to').selectOption('idle');
    await page.getByRole('button', { name: 'Add transition' }).click();
    const diff = page.getByTestId('wf-diff-preview');
    await expect(diff).toContainText('START_OVER');
    await caption(page, CAPTIONS.workflowDiff);
    await diff.getByRole('button', { name: 'Confirm save' }).click();
    await expect(page.locator('.react-flow__edge-text').filter({ hasText: 'START_OVER' })).toHaveCount(1);
    expect(fs.readFileSync(path.join(shop, 'features/checkout/workflows/Checkout.tsx'), 'utf8')).toMatch(/START_OVER/);
    await pause(page, 2000);

    // 11. The rules still hold.
    await expect(page.getByTestId('status-validate')).not.toContainText('checking', { timeout: 60_000 });
    await page.getByTestId('status-validate').click();
    await expect(drawer(page).getByText('READ-003')).toBeVisible();
    expect(await drawer(page).innerText()).not.toMatch(/^Error$/m);
    await expect(drawer(page).getByText('SLICE-003')).toBeVisible();
    await caption(page, CAPTIONS.validate);

    await card(page, CAPTIONS.outroTitle, CAPTIONS.outroSub, 6000, CAPTIONS.signOff);

    const video = page.video();
    await page.close();
    const tmp = path.join(WS, '..', `${SLUG}.take.webm`);
    await video.saveAs(tmp);
    if (process.env.MEDIA_DRY !== '1') { saveRecording(fs, OUT, SLUG, tmp); writeTimeline(fs, OUT, SLUG); }
    void clearCaption;
  } finally {
    try { process.kill(-app.pid, 'SIGKILL'); } catch { /* already gone */ }
    await model.close();
  }
});
