import { test, expect } from '@playwright/test';

// Trivial harness check: does a real browser navigating to the real dev
// server even render *something* recognizable? Everything else in
// walkthrough.spec.js builds on this working. Deliberately tolerant of
// which of the two possible top-of-page states shows up (a valid project
// -> "Dashboard", no architecture.yml yet -> ProjectGate's "No Construct
// project here yet"), since that depends on whatever directory the backend
// happened to start in.
test('home page loads and shows Dashboard or the ProjectGate heading', async ({ page }) => {
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(String(err)));

  await page.goto('/');

  const heading = page.locator('h1');
  await expect(heading).toBeVisible();
  const text = await heading.textContent();
  expect(['Dashboard', 'No Construct project here yet']).toContain(text.trim());

  // Nav should render regardless of project state.
  await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Import Wizard' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Help' })).toBeVisible();

  expect(consoleErrors, `console errors: ${consoleErrors.join('\n')}`).toEqual([]);
  expect(pageErrors, `page errors: ${pageErrors.join('\n')}`).toEqual([]);
});
