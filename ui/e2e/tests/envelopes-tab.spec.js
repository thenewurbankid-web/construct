import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { gotoCockpit } from './support/cockpit.js';
import { makeBrowseProject, openProject } from './support/browseProject.js';

// #395/#771: a read-only Envelopes tab in the Features screen's Browser pane, one row per saved flow (name +
// step count), reading GET /api/envelopes (ui/server/src/envelopesApi.mjs) -- a thin adapter over #759's
// packages/core/flows.mjs save/load primitive. Compose (add/reorder/remove steps, a step picker, save/run) is
// #772, a later slice; this one only lists what `construct pipeline save` already produced.
const API = process.env.E2E_API_BASE || 'http://localhost:4000';
const browserTabs = (page) => page.getByRole('tablist', { name: 'Browser' });
const list = (page) => page.getByTestId('envelopes-list');
const rows = (page) => list(page).getByTestId('envelope-row');

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
});
