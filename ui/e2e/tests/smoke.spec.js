import { test, expect } from '@playwright/test';

// Trivial harness check: does a real browser navigating to the real dev
// server even render *something* recognizable? Everything else in
// walkthrough.spec.js builds on this working. Deliberately tolerant of
// which of the two possible top-of-page states shows up (a valid project
// -> "Features" (the landing since #370), no architecture.yml yet -> ProjectGate's "No Construct
// project here yet"), since that depends on whatever directory the backend
// happened to start in.
test('home page loads and shows Features or the ProjectGate heading', async ({ page }) => {
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
  expect(['Features', 'No Construct project here yet']).toContain(text.trim());

  // Nav should render regardless of project state: the five screens in the top bar, and Settings / Local model /
  // Help in the profile menu (#369, #370: the Browser pane's Screens tab is gone).
  const screens = page.getByRole('navigation', { name: 'Screens' });
  for (const name of ['Features', 'Pages', 'Components', 'Git', 'Tests']) await expect(screens.getByRole('link', { name })).toBeVisible();
  await page.getByTestId('user-menu-trigger').click();
  await expect(page.getByTestId('profile-settings')).toBeVisible();
  await expect(page.getByTestId('profile-local-model')).toBeVisible();
  await expect(page.getByTestId('profile-help')).toBeVisible();

  expect(consoleErrors, `console errors: ${consoleErrors.join('\n')}`).toEqual([]);
  expect(pageErrors, `page errors: ${pageErrors.join('\n')}`).toEqual([]);
});
