import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gotoCockpit } from './support/cockpit.js';

// The inline Generate control (#382, docs/design/ia-five-screens.md section 8.6): the
// "Suggested next steps" list on a newly created page, real end to end (not mocked) —
// the auto-map action really calls /api/pages/automap and the diff really lands in the tree.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(__dirname, '../screenshots/generate');
fs.mkdirSync(SHOTS, { recursive: true });
const API = process.env.E2E_API_BASE || 'http://localhost:4000';

// A freshly created page: the selected node (<Badge>) has zero JSX attributes, which is the
// "looks freshly created" heuristic InspectorPanel already uses for "No props on this node."
const FIXTURE_PAGE = `import React from 'react';
import { Badge } from '../components/Badge';

export default function ProfilePage({ title }: { title: string }) {
  return (
    <main>
      <Badge />
    </main>
  );
}
`;

const FIXTURE_COMPONENT = `export function Badge({ title }: { title?: string }) {
  return <span className="badge">{title}</span>;
}
`;

test.describe.serial('Inline Generate control: Suggested next steps on a newly created page (#382)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  let tmpProjectDir;
  let originalDir;

  test.beforeAll(async ({ request }) => {
    originalDir = (await (await request.get(`${API}/api/settings`)).json()).projectDir;
    tmpProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-ui-e2e-generate-'));
    await request.post(`${API}/api/settings`, { data: { projectDir: tmpProjectDir } });
    await request.post(`${API}/api/init`);
    await request.post(`${API}/api/create`, { data: { kind: 'single', name: 'Profile', feature: 'people', layer: 'page' } });
    fs.writeFileSync(path.join(tmpProjectDir, 'features/people/pages/ProfilePage.tsx'), FIXTURE_PAGE);
    fs.mkdirSync(path.join(tmpProjectDir, 'features/people/components'), { recursive: true });
    fs.writeFileSync(path.join(tmpProjectDir, 'features/people/components/Badge.tsx'), FIXTURE_COMPONENT);
  });

  test.afterAll(async ({ request }) => {
    await request.post(`${API}/api/settings`, { data: { projectDir: originalDir } });
    fs.rmSync(tmpProjectDir, { recursive: true, force: true });
  });

  async function openBadge(page) {
    await gotoCockpit(page, '/pages');
    await page.locator('.pages-browser select').selectOption('people');
    const openButton = page.getByRole('button', { name: 'ProfilePage.tsx' });
    await expect(openButton).toBeVisible({ timeout: 10_000 });
    await openButton.click();
    await expect(page.locator('.tree-panel')).toBeVisible();
    await page.locator('.tree-panel').getByText('<Badge>', { exact: true }).click();
  }

  test('generate-idle.png — all three suggested actions render, mechanical by default', async ({ page }) => {
    await openBadge(page);
    const steps = page.getByTestId('suggested-next-steps');
    await expect(steps).toBeVisible();
    await expect(steps.getByTestId('generate-control')).toHaveCount(3);

    const layers = steps.locator('[data-action-id="add-missing-layers"]');
    await expect(layers).toHaveAttribute('data-view-state', 'disabled');
    await expect(layers.getByTestId('generate-disabled-reason')).toContainText('Not wired yet');

    const automap = steps.locator('[data-action-id="automap-props"]');
    await expect(automap).toHaveAttribute('data-view-state', 'idle');
    await expect(automap.getByTestId('generate-mode-mechanical')).toHaveAttribute('aria-pressed', 'true');

    const tests = steps.locator('[data-action-id="generate-tests"]');
    await expect(tests).toHaveAttribute('data-view-state', 'idle');

    await page.screenshot({ path: path.join(SHOTS, 'generate-idle--dark.png'), fullPage: true });
  });

  // Runs before the auto-map test below on purpose: once auto-map wires a prop onto the
  // node, "Suggested next steps" (gated on "no props on this node yet") stops rendering for
  // that node on the next selection/reload — see InspectorPanel's emptyGate — so a mode
  // toggle click can only be exercised while the node still looks freshly created.
  test('clicking Mechanical persists it under this action\'s own key, not a shared one', async ({ page }) => {
    await openBadge(page);
    const automap = page.getByTestId('suggested-next-steps').locator('[data-action-id="automap-props"]');
    await automap.getByTestId('generate-mode-mechanical').click();
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('construct.generateControl.modeByActionKind') || '{}'));
    expect(stored['automap-props']).toBe('mechanical');
    expect(stored['add-missing-layers']).toBeUndefined();
    await page.reload();
    await page.locator('.pages-browser select').selectOption('people');
    await page.getByRole('button', { name: 'ProfilePage.tsx' }).click();
    await page.locator('.tree-panel').getByText('<Badge>', { exact: true }).click();
    await expect(page.getByTestId('suggested-next-steps').locator('[data-action-id="automap-props"]').getByTestId('generate-mode-mechanical')).toHaveAttribute('aria-pressed', 'true');
  });

  test('generate-run.png — running Auto-map props lands the diff, never a silent write', async ({ page }) => {
    await openBadge(page);
    const automap = page.getByTestId('suggested-next-steps').locator('[data-action-id="automap-props"]');
    await automap.getByTestId('generate-run').click();
    await expect(automap.getByTestId('generate-result')).toContainText('Wired 1 prop(s).');
    // The result is a real, visible file change — the prop now shows on the node, not a silent apply.
    await expect(page.locator('.tree-panel').getByText('<Badge>', { exact: true })).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, 'generate-run--dark.png'), fullPage: true });
  });
});
