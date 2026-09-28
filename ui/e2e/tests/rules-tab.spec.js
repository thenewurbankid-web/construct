import { test, expect } from '@playwright/test';
import { gotoCockpit } from './support/cockpit.js';
import { makeBrowseProject, openProject } from './support/browseProject.js';

// #781 (part of the #395 Rules composer epic): a read-only Rules tab in the Features screen's Browser pane, one row
// per rule with its severity, plain-words "why" and live violation count, reusing the same `/api/validate` call
// Diagnostics already makes. Editing (severity, exceptions, presets) is a later slice.
const API = process.env.E2E_API_BASE || 'http://localhost:4000';
const browserTabs = (page) => page.getByRole('tablist', { name: 'Browser' });
const list = (page) => page.getByTestId('rules-list');
const rows = (page) => list(page).getByTestId('rule-row');

test.describe.serial('Rules tab: read-only rules list (#781)', () => {
  let project;
  let restore;

  test.beforeAll(async () => {
    project = makeBrowseProject('og781-rules-');
    restore = await openProject(API, project.repo);
  });
  test.afterAll(async () => {
    await restore?.();
    project?.remove();
  });

  test('lists every configured rule with its severity and live violation count, matching /api/validate', async ({ page }) => {
    const validate = await (await fetch(`${API}/api/validate`, { credentials: 'include' })).json();
    const summary = validate.summary ?? {};
    const ids = Object.keys(summary).sort();
    expect(ids.length).toBeGreaterThan(0);

    await gotoCockpit(page, '/');
    await browserTabs(page).getByRole('tab', { name: 'Rules' }).click();
    await expect(rows(page)).toHaveCount(ids.length);

    // A rule with zero violations and (if any exists) a rule with several both render correctly.
    const zero = ids.find((id) => summary[id].count === 0);
    const some = ids.find((id) => summary[id].count > 0);
    for (const id of [zero, some].filter(Boolean)) {
      const row = list(page).locator(`[data-rule="${id}"]`);
      await expect(row.getByTestId('rule-count')).toHaveText(String(summary[id].count));
      const expectedSeverity = summary[id].severity === 'error' ? 'Error' : summary[id].severity === 'warning' ? 'Warning' : 'Off';
      await expect(row.getByTestId('rule-severity')).toHaveText(expectedSeverity);
      await expect(row.getByTestId('rule-why')).not.toHaveText('');
    }
  });

  test('a project reachable but a validate that cannot run shows the error state, not an empty list', async ({ page }) => {
    await page.route('**/api/validate', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Boom.' }) }));
    await gotoCockpit(page, '/');
    await browserTabs(page).getByRole('tab', { name: 'Rules' }).click();
    await expect(page.getByTestId('rules-error')).toContainText('Boom.');
  });
});
