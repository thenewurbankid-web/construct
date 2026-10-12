import { test, expect, freshSample, openSampleFromPicker, expectAxeClean, expectLayoutFits } from './support/uat.js';

// UAT walk for cloud-knows (docs/line/review.md, "What Line knows", UAT 5 minutes), as the owner walks it: clicks only,
// from the shell. On a fresh examples/line-sample opened from the picker: profile menu -> What Line knows. Map: orders
// reads "OrdersPage is based on ListPage."; what breaks if OrderButton changes lists InvoicesPage. Change: plan "Move
// OrderButton ... into the library", approve it, it is done and no second "Move OrderButton" proposal stays proposed
// (the stale proposal fixed in knows/service.mjs, 9b0d1b1f); billing then uses OrderButton from the library. Memory
// says Line remembers nothing yet, then the one approved change; How smart is it shows 0 cross-feature uses after the
// promote. Axe clean and no sideways scroll at 1280 and 375 px on every tab. The regular spec is tests/line-knows.spec.js.
const KNOWS = '[data-testid="line-knows"]';

test('cloud-knows UAT: Map, Change (promote OrderButton), Memory and How smart is it on the Line sample', async ({ page }, testInfo) => {
  const sample = freshSample();
  await page.setViewportSize({ width: 1280, height: 900 });
  await openSampleFromPicker(page);

  // Profile menu -> What Line knows.
  await page.getByTestId('user-menu-trigger').click();
  await page.getByTestId('profile-knows').click();
  await expect(page).toHaveURL(/\/knows/);
  await expect(page.getByRole('heading', { name: 'What Line knows', level: 1 })).toBeVisible({ timeout: 30_000 });

  // Map: Feature orders, its sentences.
  const map = page.getByTestId('knows-map');
  await expect(map.getByTestId('knows-map-pick')).toBeVisible({ timeout: 60_000 });
  await map.getByTestId('knows-start').filter({ hasText: 'Feature orders' }).click();
  await expect(map.getByTestId('knows-focus')).toHaveText('orders');
  await expect(map.getByTestId('knows-sentence').filter({ hasText: 'OrdersPage is based on ListPage.' })).toBeVisible();
  await expect(map.getByTestId('knows-sentence').first()).toContainText('InvoicesPage uses OrderButton from feature orders, which a feature may not do.');
  await expectAxeClean(page, KNOWS);
  await expectLayoutFits(page, KNOWS, testInfo, 'knows-map');
  await page.setViewportSize({ width: 375, height: 812 });
  await expectAxeClean(page, KNOWS);
  await page.setViewportSize({ width: 1280, height: 900 });

  // Memory: a fresh copy, nothing remembered yet.
  await page.getByTestId('knows-tab-memory').click();
  const memory = page.getByTestId('knows-memory');
  await expect(memory.getByTestId('memory-sentence')).toHaveText('Line remembers nothing here yet; it learns from what you pick, approve and change.', { timeout: 30_000 });
  await expect(memory.getByTestId('memory-record')).toHaveCount(0);
  await expectAxeClean(page, KNOWS);
  await expectLayoutFits(page, KNOWS, testInfo, 'knows-memory');
  await page.setViewportSize({ width: 375, height: 812 });
  await expectAxeClean(page, KNOWS);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByTestId('knows-tab-map').click();

  // OrderButton -> What breaks if I change it?: InvoicesPage.
  await map.getByTestId('knows-start').filter({ hasText: 'OrderButton' }).click();
  await expect(map.getByTestId('knows-focus')).toHaveText('OrderButton');
  await map.getByTestId('knows-what-breaks').click();
  await expect(map.getByTestId('knows-breaks-list').getByTestId('knows-breaks-list-item').filter({ hasText: 'InvoicesPage' })).toBeVisible();

  // Change it: the promote card, Plan it, Approve, Done; no second "Move OrderButton" proposal is left.
  await map.getByTestId('knows-change-it').click();
  await expect(page.getByTestId('knows-tab-change')).toHaveAttribute('aria-selected', 'true');
  const moves = page.getByTestId('knows-change').filter({ hasText: /Move OrderButton.*into the library/ });
  const card = moves.first();
  await expect(card).toHaveAttribute('data-state', 'proposed', { timeout: 60_000 });
  await expectAxeClean(page, KNOWS);
  await expectLayoutFits(page, KNOWS, testInfo, 'knows-change');
  await page.setViewportSize({ width: 375, height: 812 });
  await expectAxeClean(page, KNOWS);
  await page.setViewportSize({ width: 1280, height: 900 });
  await card.getByTestId('knows-change-plan').click();
  await expect(card).toHaveAttribute('data-state', 'waiting');
  expect(sample.exists('library/components/OrderButton.tsx')).toBe(false);
  await card.getByTestId('knows-change-approve').click();
  await expect(card).toHaveAttribute('data-state', 'done', { timeout: 60_000 });
  expect(sample.exists('library/components/OrderButton.tsx')).toBe(true);
  await expect(page.getByTestId('knows-change').filter({ hasText: /Move OrderButton/ }).and(page.locator('[data-state="proposed"]'))).toHaveCount(0);
  // Still none a moment later, once the tab has read the graph again.
  await page.waitForTimeout(1500);
  await expect(page.getByTestId('knows-change').filter({ hasText: /Move OrderButton/ }).and(page.locator('[data-state="proposed"]'))).toHaveCount(0);

  // Map again: billing now uses OrderButton from the library, the red sentence is gone.
  await page.getByTestId('knows-tab-map').click();
  await page.getByTestId('knows-start').filter({ hasText: 'Feature billing' }).click();
  await expect(page.getByTestId('knows-focus')).toHaveText('billing');
  await expect(page.getByTestId('knows-sentence').filter({ hasText: 'which a feature may not do' })).toHaveCount(0);
  await expect(page.getByTestId('knows-sentence').filter({ hasText: /uses OrderButton from the library/ })).toBeVisible();

  // Memory: the approved change is the one decision Line remembers.
  await page.getByTestId('knows-tab-memory').click();
  await expect(page.getByTestId('knows-memory').getByTestId('memory-sentence')).toHaveText('Line remembers 1 decision for this project, on this computer only.', { timeout: 30_000 });

  // How smart is it: after the promote no feature uses another.
  await page.getByTestId('knows-tab-smart').click();
  const smart = page.getByTestId('knows-smart');
  await expect(smart.getByTestId('knows-smart-sentence')).toContainText('nothing leaves it', { timeout: 60_000 });
  await expect(smart.locator('[data-metric="health.crossFeature"]').getByTestId('knows-metric-value')).toHaveText('0');
  await expectAxeClean(page, KNOWS);
  await expectLayoutFits(page, KNOWS, testInfo, 'knows-smart');
  await page.setViewportSize({ width: 375, height: 812 });
  await expectAxeClean(page, KNOWS);
});
