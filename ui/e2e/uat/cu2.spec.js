import { test, expect } from '@playwright/test';
import { gotoCockpit } from '../tests/support/cockpit.js';

// UAT walk for cu2 (docs/line/review.md "cu2"), as the owner does it: open the Cockpit, open the profile menu, open
// Settings, read the AI steps, open one step's Details. Only clicks; no API calls. Fails on any console error or any
// 4xx/5xx response, on English that is not a full sentence, and on more than two clicks to reach the panel.
//   cd ui/e2e && npx playwright test -c playwright.uat.config.js uat/cu2.spec.js
test('cu2 UAT: Settings lists every AI step in plain English, 1.5B by default, each with a static fallback', async ({ page }) => {
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  page.on('response', (r) => { if (r.status() >= 400) problems.push(`${r.status()} ${r.url()}`); });

  await gotoCockpit(page, '/');
  let clicks = 0;
  await page.getByTestId('user-menu-trigger').click(); clicks += 1;
  await page.getByTestId('profile-settings').click(); clicks += 1;
  const panel = page.getByTestId('ai-steps');
  await expect(panel).toBeVisible({ timeout: 30_000 });
  expect(clicks).toBeLessThanOrEqual(2);

  // Every step reads as plain sentences: what it does, its model, how it decides and falls back.
  const steps = panel.getByTestId('ai-step');
  expect(await steps.count()).toBeGreaterThanOrEqual(10);
  for (const s of await steps.all()) {
    const label = (await s.locator('.ais-label').innerText()).trim();
    const how = (await s.locator('.ais-how').innerText()).trim();
    expect(label).toMatch(/^[A-Z].*\.$/);
    expect(how).toMatch(/^[A-Z].*\.$/);
    expect(how).toMatch(/static|nothing runs/);
    await expect(s.getByTestId('ai-step-model')).toHaveText(/^Model: (qwen2\.5-coder:1\.5b \(Line's default\)|The hosted model you choose)$/);
  }
  await expect(panel.getByTestId('ai-steps-status')).toHaveText(/\.$/);

  // One more click shows the technical part of a step.
  const chooser = panel.locator('[data-testid="ai-step"][data-step="construct.chooser"]');
  await chooser.getByText('Details').click();
  await expect(chooser.getByText('Reply cap: 800 tokens')).toBeVisible();

  expect(problems, problems.join('\n')).toEqual([]);
});
