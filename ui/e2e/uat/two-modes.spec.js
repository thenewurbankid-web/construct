import { test, expect, freshSample, expectLayoutFits } from './support/uat.js';
import { waitForCockpitReady } from '../tests/support/cockpit.js';
import { lmScreen, option, pick, toMode, expectAxeClean } from '../tests/support/lineModes.js';

// UAT walk for cloud-modes (docs/line/review.md, "Two modes: Chat and Under the hood on every screen"), as the owner
// walks it: clicks only. A person who never picked a mode: Cockpit opens in Chat, on "Open a project" too; the chat
// opens line-sample from the picker, then moves to orders -> OrdersPage with the breadcrumb following; the header's
// switch shows Under the hood at the same place; back to Chat, and the pick survives a reload. Axe clean and no
// sideways scroll at 1280 and 375 px. The regular spec with every screen is tests/line-two-modes.spec.js.
const crumbs = (page) => page.getByTestId('lm-crumb');

test('cloud-modes UAT: Chat by default, the breadcrumb follows the chat, the header switch keeps the place, the pick is remembered', async ({ page }, testInfo) => {
  freshSample();
  // Nobody has picked a mode yet: until the walk's first click on the switch, every load drops the fixture's
  // Under-the-hood pick, so the walk sees each screen's default; after that, only the picks it makes with the switch.
  await page.addInitScript(() => {
    if (sessionStorage.getItem('uat-two-modes-picked')) return;
    for (const k of Object.keys(localStorage)) if (k.startsWith('cockpit.mode')) localStorage.removeItem(k);
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  // A project left open by an earlier walk: close it from the switcher, as a person does.
  const switcher = page.getByTestId('project-switcher');
  await expect(lmScreen(page)).toBeVisible({ timeout: 60_000 });
  if (await switcher.isVisible()) {
    const stop = page.allowHttp(409, '/api/');
    await waitForCockpitReady(page);
    await switcher.click();
    await page.getByTestId('close-project').click();
    await expect(crumbs(page)).toHaveText(['Open a project'], { timeout: 30_000 });
    await page.waitForTimeout(500);
    stop();
  }

  // 1. Open a project, in Chat (the default): Start or find a project -> Your projects -> line-sample.
  await expect(lmScreen(page)).toHaveAttribute('data-mode', 'chat', { timeout: 30_000 });
  await expect(page.getByTestId('lm-mode-chat')).toHaveAttribute('aria-pressed', 'true');
  await expect(crumbs(page)).toHaveText(['Open a project']);
  await option(page, 'open.start').click();
  await pick(page, 'projects').click();
  await expect(crumbs(page)).toHaveText(['Open a project', 'Your projects']);
  await expectAxeClean(page);
  const stopAllowing = page.allowHttp(409, '/api/');
  await page.getByRole('region', { name: 'Your projects' }).getByRole('button', { name: 'Open line-sample', exact: true }).click();
  await expect(switcher).toContainText('line-sample', { timeout: 30_000 });
  await waitForCockpitReady(page);
  await page.waitForTimeout(500);
  stopAllowing();

  // 2. Features, still in Chat: orders -> its items -> OrdersPage; the breadcrumb says where we are.
  await expect(lmScreen(page)).toHaveAttribute('data-mode', 'chat', { timeout: 30_000 });
  await expect(crumbs(page)).toHaveText(['Features'], { timeout: 30_000 });
  await pick(page, 'orders').click();
  await expect(crumbs(page)).toHaveText(['Features', 'orders']);
  await option(page, 'feature.items').click();
  await pick(page, 'OrdersPage').click();
  await expect(crumbs(page)).toHaveText(['Features', 'orders', 'OrdersPage']);
  await expect(crumbs(page).last()).toHaveAttribute('aria-current', 'location');
  // The live stage beside the chat: OrdersPage is the page in focus, based on ListPage.
  const focused = page.getByTestId('lm-stage').locator('[data-testid="lm-stage-block"][data-block="item:OrdersPage"]');
  await expect(focused).toHaveAttribute('data-focus', 'true');
  await expect(focused).toContainText('Based on ListPage');
  await expectAxeClean(page);
  await expectLayoutFits(page, '[data-testid="lm-screen"]', testInfo, 'two-modes-chat');
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(crumbs(page)).toHaveText(['Features', 'orders', 'OrdersPage']);
  await expectAxeClean(page);
  await page.setViewportSize({ width: 1280, height: 800 });

  // 3. The header's switch: Under the hood is the regular Features screen at the same place.
  await toMode(page, 'hood');
  await page.evaluate(() => sessionStorage.setItem('uat-two-modes-picked', '1'));
  await expect(page.getByTestId('lm-mode-hood')).toHaveAttribute('aria-pressed', 'true');
  await expect(page).toHaveURL(/\?feature=orders&item=OrdersPage$/);
  await expect(page.getByTestId('lf-detail')).toContainText('Feature: orders');
  await expect(page.locator('[data-testid="lf-item"][data-open]')).toHaveAttribute('data-item', 'OrdersPage');
  await expectAxeClean(page);
  await expectLayoutFits(page, '[data-testid="lm-screen"]', testInfo, 'two-modes-hood');
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.getByTestId('lm-switch')).toBeVisible();
  await expectAxeClean(page);
  await page.setViewportSize({ width: 1280, height: 800 });

  // 4. Back to Chat with the switch: the same breadcrumb. A reload keeps Chat and the place.
  await toMode(page, 'chat');
  await expect(crumbs(page)).toHaveText(['Features', 'orders', 'OrdersPage']);
  await page.reload();
  await waitForCockpitReady(page);
  await expect(lmScreen(page)).toHaveAttribute('data-mode', 'chat', { timeout: 30_000 });
  await expect(page.getByTestId('lm-mode-chat')).toHaveAttribute('aria-pressed', 'true');
  await expect(crumbs(page)).toHaveText(['Features', 'orders', 'OrdersPage']);
  // Under the hood after a reload too: the pick holds on another screen as well.
  await toMode(page, 'hood');
  await page.reload();
  await waitForCockpitReady(page);
  await expect(lmScreen(page)).toHaveAttribute('data-mode', 'hood', { timeout: 30_000 });
  await expect(page.locator('[data-testid="lf-item"][data-open]')).toHaveAttribute('data-item', 'OrdersPage');
  await page.getByRole('navigation', { name: 'Screens', exact: true }).getByRole('link', { name: 'Pages', exact: true }).click();
  await expect(lmScreen(page)).toHaveAttribute('data-mode', 'hood', { timeout: 30_000 });
});
