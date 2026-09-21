import { test, expect } from '@playwright/test';
import { gotoCockpit } from './support/cockpit.js';

// #454 -- the dev-only design-review overlay (threadmark-react) is mounted at the app root
// (app/layout.tsx) but must render nothing, and have zero effect on the page, unless
// NEXT_PUBLIC_REVIEW_OVERLAY=1 was set at build time. This config's dev server (see
// playwright.config.js's webServer) never sets that flag, matching the default (and hosted)
// build, so this proves the off-by-default behaviour without needing its own server config.
test.describe('design-review overlay (#454)', () => {
  test('renders nothing and adds no controls when the flag is off (the default)', async ({ page }) => {
    // /help (not /dashboard): a screen with no live-polling widgets of its own, so a DOM check
    // isn't chasing unrelated background updates (model status pill, process counts, ...).
    await gotoCockpit(page, '/help');

    // No trace of the overlay in the DOM at all: no stable-target attribute it defines, and no
    // element whose id/class names it (a real, non-fabricated absence check, not just "it didn't
    // crash").
    const threadmarkNodeCount = () =>
      page.evaluate(
        () => document.querySelectorAll('[data-threadmark-id], [id*="threadmark" i], [class*="threadmark" i]').length,
      );
    expect(await threadmarkNodeCount()).toBe(0);

    // Its own activation shortcut (Command/Ctrl+Shift+F) must be a no-op: no popover, no toolbar,
    // no new shadow-DOM host (threadmark-react renders into one) added as a result.
    const shadowHostCount = () =>
      page.evaluate(() => Array.from(document.body.children).filter((el) => el.shadowRoot !== null).length);
    const shadowBefore = await shadowHostCount();
    await page.keyboard.press('Control+Shift+F');
    await page.waitForTimeout(300);
    expect(await shadowHostCount()).toBe(shadowBefore);
    expect(await threadmarkNodeCount()).toBe(0);

    // The page itself is otherwise unaffected -- ordinary Cockpit content still renders.
    await expect(page.locator('h1, h2').first()).toBeVisible();
  });
});
