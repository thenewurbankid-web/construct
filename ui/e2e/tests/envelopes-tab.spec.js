import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { gotoCockpit } from './support/cockpit.js';
import { makeBrowseProject, openProject } from './support/browseProject.js';

// #395/#771: the Envelopes tab in the Features screen's Browser pane -- a left panel of saved flows (name +
// step count) reading GET /api/envelopes (ui/server/src/envelopesApi.mjs, a thin adapter over #759's
// packages/core/flows.mjs), plus a compose center stage: add/reorder/remove steps from the real plan-flow
// catalogue (reusing the Plan screen's `/api/plan/context`), each step's Mechanical/AI provenance shown as a
// chip, and "Load" seeding the draft from a saved flow. Save/run is #772, a later slice.
const API = process.env.E2E_API_BASE || 'http://localhost:4000';
const browserTabs = (page) => page.getByRole('tablist', { name: 'Browser' });
const list = (page) => page.getByTestId('envelopes-list');
const rows = (page) => list(page).getByTestId('envelope-row');
const stage = (page) => page.getByTestId('compose-stage');
const draftSteps = (page) => stage(page).getByTestId('compose-step');

// Same saved-flow record shape packages/core/flows.mjs's saveFlow() writes -- written directly to the fixture
// repo rather than through the CLI, since the e2e harness only needs a flow already on disk to read back.
function seedFlow(repo, name, steps) {
  const dir = path.join(repo, '.construct', 'flows');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify({ version: 1, name, steps, savedAt: new Date().toISOString() }, null, 2));
}

const STEP = {
  id: 's1',
  title: 'Total',
  flow: 'create.unit',
  args: { layer: 'domain', name: 'Total', feature: 'checkout' },
  executor: 'deterministic',
  touches: { features: ['checkout'], files: [{ path: 'features/checkout/domain/Total.ts', change: 'create' }] },
};

const OTHER_STEP = {
  id: 's2',
  title: 'Cart',
  flow: 'create.unit',
  args: { layer: 'service', name: 'Cart', feature: 'checkout' },
  executor: 'deterministic',
  touches: { features: ['checkout'], files: [{ path: 'features/checkout/service/Cart.ts', change: 'create' }] },
};

test.describe.serial('Envelopes tab: read-only saved-flows list (#395/#771)', () => {
  let project;
  let restore;

  test.beforeAll(async () => {
    project = makeBrowseProject('og771-envelopes-');
    restore = await openProject(API, project.repo);
  });
  test.afterAll(async () => {
    await restore?.();
    project?.remove();
  });

  test('a project with no saved flows shows the empty state, not an error', async ({ page }) => {
    await gotoCockpit(page, '/');
    await browserTabs(page).getByRole('tab', { name: 'Envelopes' }).click();
    await expect(page.getByTestId('envelopes-empty')).toBeVisible();
    await expect(rows(page)).toHaveCount(0);
  });

  test('lists every saved flow with its step count', async ({ page }) => {
    seedFlow(project.repo, 'scaffold-checkout', [STEP]);
    seedFlow(project.repo, 'another-flow', [STEP, OTHER_STEP]);

    await gotoCockpit(page, '/');
    await browserTabs(page).getByRole('tab', { name: 'Envelopes' }).click();
    await expect(rows(page)).toHaveCount(2);

    const first = list(page).locator('[data-flow="scaffold-checkout"]');
    await expect(first.getByTestId('envelope-step-count')).toHaveText('1 step');
    const second = list(page).locator('[data-flow="another-flow"]');
    await expect(second.getByTestId('envelope-step-count')).toHaveText('2 steps');
  });

  test('a project reachable but a saved-flows read that cannot run shows the error state, not an empty list', async ({ page }) => {
    await page.route('**/api/envelopes', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Boom.' }) }));
    await gotoCockpit(page, '/');
    await browserTabs(page).getByRole('tab', { name: 'Envelopes' }).click();
    await expect(page.getByTestId('envelopes-error')).toContainText('Boom.');
  });

  test('compose: adding a step from the catalogue picker shows it with its Mechanical/AI provenance, reorder and remove work', async ({ page }) => {
    await gotoCockpit(page, '/');
    await browserTabs(page).getByRole('tab', { name: 'Envelopes' }).click();
    await expect(stage(page).getByTestId('compose-empty')).toBeVisible();

    const picker = stage(page).getByTestId('compose-picker');
    await picker.getByTestId('compose-picker-select').selectOption('create.unit');
    await picker.getByTestId('compose-picker-add').click();
    await expect(draftSteps(page)).toHaveCount(1);
    await expect(draftSteps(page).first().getByTestId('compose-step-provenance')).toHaveText('Mechanical');

    // A second step, then reorder it above the first.
    await picker.getByTestId('compose-picker-select').selectOption('create.unit');
    await picker.getByTestId('compose-picker-add').click();
    await expect(draftSteps(page)).toHaveCount(2);
    const secondId = await draftSteps(page).nth(1).getAttribute('data-step');
    await draftSteps(page).nth(1).getByTestId('compose-step-up').click();
    await expect(draftSteps(page).first()).toHaveAttribute('data-step', secondId);

    // Remove both.
    await draftSteps(page).first().getByTestId('compose-step-remove').click();
    await draftSteps(page).first().getByTestId('compose-step-remove').click();
    await expect(draftSteps(page)).toHaveCount(0);
    await expect(stage(page).getByTestId('compose-empty')).toBeVisible();
  });

  test('compose: Load on a saved flow seeds the draft with its steps', async ({ page }) => {
    seedFlow(project.repo, 'scaffold-checkout', [STEP, OTHER_STEP]);

    await gotoCockpit(page, '/');
    await browserTabs(page).getByRole('tab', { name: 'Envelopes' }).click();
    await list(page).locator('[data-flow="scaffold-checkout"]').getByTestId('envelope-row-load').click();

    await expect(stage(page).getByTestId('compose-loaded-from')).toHaveText('Loaded from "scaffold-checkout"');
    await expect(draftSteps(page)).toHaveCount(2);
    await expect(draftSteps(page).first()).toHaveAttribute('data-step', 's1');

    await stage(page).getByTestId('compose-new').click();
    await expect(stage(page).getByTestId('compose-loaded-from')).toHaveText('New flow');
    await expect(draftSteps(page)).toHaveCount(0);
  });

  test('compose: Preview on a step shows the envelope it would receive, matching envelope.v1.json\'s shape', async ({ page }) => {
    await gotoCockpit(page, '/');
    await browserTabs(page).getByRole('tab', { name: 'Envelopes' }).click();

    const picker = stage(page).getByTestId('compose-picker');
    await picker.getByTestId('compose-picker-select').selectOption('create.unit');
    await picker.getByTestId('compose-picker-add').click();
    await expect(draftSteps(page)).toHaveCount(1);

    await draftSteps(page).first().getByTestId('compose-step-preview').click();
    const json = stage(page).getByTestId('compose-preview-json');
    await expect(json).toBeVisible();
    const parsed = JSON.parse(await json.textContent());
    assertEnvelopeShape(parsed);
    // No arg-editing UI exists yet (a later slice), so a freshly added create.unit step carries no
    // layer/name -- flowToEnvelopeSteps (packages/core/flows.mjs) still maps it, just to an empty object.
    expect(parsed.steps).toEqual([{}]);

    await draftSteps(page).first().getByTestId('compose-step-preview').click();
    await expect(json).not.toBeVisible();
  });

  test('compose: Save this flow previews then commits, and the new flow appears in the left panel', async ({ page }) => {
    await gotoCockpit(page, '/');
    await browserTabs(page).getByRole('tab', { name: 'Envelopes' }).click();

    // check.types has no required args and does not write, so it saves successfully with no arg-editing UI
    // (a later slice); create.unit (used elsewhere in this file) would fail real validation with empty args.
    const picker = stage(page).getByTestId('compose-picker');
    await picker.getByTestId('compose-picker-select').selectOption('check.types');
    await picker.getByTestId('compose-picker-add').click();
    await expect(draftSteps(page)).toHaveCount(1);

    const savePanel = stage(page).getByTestId('compose-save');
    await savePanel.getByTestId('compose-save-name').fill('e2e-composed-flow');
    await savePanel.getByTestId('compose-save-preview').click();
    await expect(savePanel.getByTestId('compose-save-confirm')).toBeVisible();

    await savePanel.getByTestId('compose-save-confirm').click();
    await expect(savePanel.getByTestId('compose-save-done')).toBeVisible();
    await expect(list(page).locator('[data-flow="e2e-composed-flow"]')).toBeVisible();
  });

  test('compose: Save this flow is refused with a clear error for a step missing required args', async ({ page }) => {
    await gotoCockpit(page, '/');
    await browserTabs(page).getByRole('tab', { name: 'Envelopes' }).click();

    await page.route('**/api/envelopes/broken-flow', (route) =>
      route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'That flow would be invalid.', errors: ['STEP_ARG_REQUIRED at steps[0].args.name: "name" is required.'] }) }),
    );

    const picker = stage(page).getByTestId('compose-picker');
    await picker.getByTestId('compose-picker-select').selectOption('create.unit');
    await picker.getByTestId('compose-picker-add').click();

    const savePanel = stage(page).getByTestId('compose-save');
    await savePanel.getByTestId('compose-save-name').fill('broken-flow');
    await savePanel.getByTestId('compose-save-preview').click();
    await expect(savePanel.getByTestId('compose-save-error')).toContainText('That flow would be invalid.');
  });

  test('compose: Run this flow starts a process in the Processes drawer through the same Process/Approvals path Plan mode uses', async ({ page }) => {
    await gotoCockpit(page, '/');
    await browserTabs(page).getByRole('tab', { name: 'Envelopes' }).click();

    // summarize.list has no required args, does not write, and is the same flow the Plan mode e2e suite
    // uses for its own "Run plan" test -- proven to actually complete in the fixture project sandbox
    // (unlike check.types, which shells out to a real tsc that this throwaway fixture is not set up for).
    const picker = stage(page).getByTestId('compose-picker');
    await picker.getByTestId('compose-picker-select').selectOption('summarize.list');
    await picker.getByTestId('compose-picker-add').click();
    await expect(draftSteps(page)).toHaveCount(1);

    const runBar = stage(page).getByTestId('compose-run');
    await runBar.getByTestId('compose-run-button').click();
    await expect(runBar.getByTestId('compose-run-started')).toBeVisible();

    // The shell's drawer opens on the Processes tab -- the exact drawer Plan mode's "Run plan" opens (no new
    // or bypass execution UI), with the started process listed.
    const drawer = page.getByRole('region', { name: 'Bottom panel: Run' });
    await expect(drawer.getByRole('tab', { name: /Processes/ })).toHaveAttribute('aria-selected', 'true');
    await expect(drawer.getByTestId('process-row')).toHaveCount(1);
  });

  test('compose: Run this flow is refused with a clear error for an invalid draft, and starts nothing', async ({ page }) => {
    await gotoCockpit(page, '/');
    await browserTabs(page).getByRole('tab', { name: 'Envelopes' }).click();

    await page.route('**/api/envelopes/run', (route) =>
      route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'This flow is not valid, so it was not run.' }) }),
    );

    const picker = stage(page).getByTestId('compose-picker');
    await picker.getByTestId('compose-picker-select').selectOption('create.unit');
    await picker.getByTestId('compose-picker-add').click();

    const runBar = stage(page).getByTestId('compose-run');
    await runBar.getByTestId('compose-run-button').click();
    await expect(runBar.getByTestId('compose-run-error')).toContainText('This flow is not valid, so it was not run.');
  });
});

// The exact shape schemas/envelope.v1.json requires (required: version, feature, status, layers).
function assertEnvelopeShape(envelope) {
  expect(envelope.version).toBe(1);
  expect(envelope.status).toBe('pending');
  expect(envelope.layers).toEqual({});
  expect(Array.isArray(envelope.steps)).toBe(true);
}
