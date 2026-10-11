import fs from 'node:fs';
import path from 'node:path';
import { test, expect, WORKSPACE, expectAxeClean, expectLayoutFits } from './support/uat.js';

// UAT: the New project form on "Open a project" (ec00e35f: typing in it used to loop React forever, because the
// form's useSyncExternalStore read a new object every time). The owner types a name and presses Create and open.
test('New project: typing a name keeps every letter, a bad name says why in plain words, Create and open opens it', async ({ page }, testInfo) => {
  const name = `uat-shop-${process.pid}`;
  fs.rmSync(path.join(WORKSPACE, name), { recursive: true, force: true });
  await page.goto('/');
  const switcher = page.getByTestId('project-switcher');
  const heading = page.getByRole('heading', { name: 'Open a project' });
  await expect(heading.or(switcher)).toBeVisible({ timeout: 60_000 });
  if (await switcher.isVisible()) {
    await switcher.click();
    await page.getByTestId('close-project').click();
  }
  await expect(heading).toBeVisible({ timeout: 30_000 });
  await expectLayoutFits(page, 'main', testInfo, 'open-a-project');

  const field = page.getByLabel('Project name');
  // Typed key by key, as a person does: the crash showed on the first keystroke.
  await field.pressSequentially('my shop');
  await expect(field).toHaveValue('my shop');
  await expect(page.getByText('A project name has no spaces. Use "-" or "_" instead.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create and open' })).toBeDisabled();

  await field.fill('');
  await field.pressSequentially(name);
  await expect(field).toHaveValue(name);
  await expectAxeClean(page, 'main');
  await page.getByRole('button', { name: 'Create and open' }).click();
  await expect(switcher).toContainText(name, { timeout: 60_000 });
  expect(fs.existsSync(path.join(WORKSPACE, name, 'architecture.yml'))).toBe(true);
});
