import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { gotoCockpit } from './support/cockpit.js';
import { makeBrowseProject, openProject } from './support/browseProject.js';

// LIN-150: owner decision 2026-09-30 -- the Features screen's main panel, which used to carry a generic
// card for every layer including the adapter (the one layer that touches the real API), now shows the
// view model layer there instead; the API moves into a detail card a view model's own action opens.
const API = process.env.E2E_API_BASE || 'http://localhost:4000';
const details = (page) => page.getByTestId('fc-details');

function makeViewModelProject() {
  const project = makeBrowseProject('lin150-viewmodel-api-');
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(project.repo, rel)), { recursive: true });
    fs.writeFileSync(path.join(project.repo, rel), text);
  };
  write(
    'features/billing/adapters/ChargeAdapter.ts',
    "/** Fetches a charge from the real API and translates its wire shape. */\nexport function ChargeAdapter() {\n  return fetch('/api/charge').then((r) => r.json());\n}\n",
  );
  write(
    'features/billing/controllers/ChargeController.tsx',
    "import { ChargeAdapter } from '../adapters/ChargeAdapter';\nexport function ChargeController() {\n  return ChargeAdapter();\n}\n",
  );
  write(
    'features/billing/viewmodels/ChargeViewModel.ts',
    "import { ChargeController } from '../controllers/ChargeController';\n/** Shapes the charge for the page. */\nexport function ChargeViewModel() {\n  return ChargeController();\n}\n",
  );
  return project;
}

test.describe.serial('Features screen: the view-model panel and its API detail card (LIN-150)', () => {
  let project;
  let restore;

  test.beforeAll(async () => {
    project = makeViewModelProject();
    restore = await openProject(API, project.repo);
  });
  test.afterAll(async () => {
    await restore?.();
    project?.remove();
  });

  test('the view model shows in the main panel; the adapter does not get its own card there', async ({ page }) => {
    await gotoCockpit(page, '/?feature=billing');
    await expect(details(page).locator('[data-testid="fc-layer"][data-layer="viewmodel"]')).toHaveCount(1);
    await expect(details(page).locator('[data-testid="fc-layer"][data-layer="adapter"]')).toHaveCount(0);
  });

  test('a view model\'s API action opens its adapter file in the right-panel detail card', async ({ page }) => {
    await gotoCockpit(page, '/?feature=billing');
    const viewModelLayer = details(page).locator('[data-testid="fc-layer"][data-layer="viewmodel"]');
    await viewModelLayer.getByTestId('fc-viewmodel-api').click();
    const tools = page.getByRole('complementary', { name: 'Right panel: Inspect' });
    await tools.getByRole('tab', { name: /^API/ }).click();
    const card = page.getByTestId('fc-api-detail-card');
    await expect(card).toBeVisible();
    await expect(card.getByTestId('fc-api-file')).toContainText('features/billing/adapters/ChargeAdapter.ts');
  });
});
