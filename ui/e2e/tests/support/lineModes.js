// Two modes (lib/lineModes.ts, features/line-modes): helpers the per-screen specs share. A chat option is picked by its
// stable id (never its label), an item by its id, a crumb by its "<param>:<id>".
import { expect } from '@playwright/test';
import { runAxe, isBlocking, format } from './axe.js';

export const lmScreen = (page) => page.getByTestId('lm-screen');
export const option = (page, id) => page.locator(`[data-testid="ln-option"][data-option-id="${id}"]`);
export const crumb = (page, id) => page.locator(`[data-testid="lm-crumb"][data-crumb="${id}"]`);
/** The newest pick button for an item (an older message may list the same item). */
export const pick = (page, itemId) => page.locator(`[data-testid="ln-pick"][data-item="${itemId}"]`).last();

export async function toMode(page, mode) {
  await page.getByTestId(mode === 'chat' ? 'lm-mode-chat' : 'lm-mode-hood').click();
  await expect(lmScreen(page)).toHaveAttribute('data-mode', mode);
}

export async function crumbLabels(page) {
  return page.getByTestId('lm-crumb').allInnerTexts();
}

/** No serious or critical axe finding on the two-modes screen (the chat, the breadcrumb and Under the hood). The shell's
 * switch is checked by line-two-modes.spec.js (its pressed button now uses the shell's accent foreground, 4.5:1+). */
export async function expectAxeClean(page) {
  const found = await runAxe(page, { include: '[data-testid="lm-screen"]' });
  const blocking = found.filter(isBlocking);
  expect(blocking, format(blocking)).toEqual([]);
}

/** Owner decision (12 Oct): every screen opens in Chat until the person picks a mode. A spec written for a screen's
 * regular view starts Under the hood with one line after its imports: `startUnderTheHood(test);`. It stores the pick a
 * person would make with the switch (the e2e servers have no sign-in, so the key is the local one), only when nothing
 * is picked yet, so a test that switches modes itself keeps its own choice. */
export function startUnderTheHood(test) {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        if (!window.localStorage.getItem('cockpit.mode')) window.localStorage.setItem('cockpit.mode', 'hood');
      } catch {
        // Storage blocked: the screen opens in Chat.
      }
    });
  });
}
