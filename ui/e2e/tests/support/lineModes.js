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
 * switch is the shell's own: its pressed button (#fff on the dark theme's #5b8cff accent, 3.16:1) fails color-contrast,
 * reported to the shell owner rather than fixed from a screen lane. */
export async function expectAxeClean(page) {
  const found = await runAxe(page, { include: '[data-testid="lm-screen"]' });
  const blocking = found.filter(isBlocking);
  expect(blocking, format(blocking)).toEqual([]);
}
