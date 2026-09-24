import { test, expect } from '@playwright/test';
import { gotoCockpit, setTheme } from './support/cockpit.js';

// The Cockpit's top-bar logo is a processing indicator (owner request, 2026-09-24): it is still until the framework is doing
// work (a command, the Import Wizard, a Process; here a real background validate that the shell starts on open), moves while
// it is, and goes still again a moment after. Under reduced motion it never moves. The motion is CSS keyframes over our own
// inline SVG (no animation library), and the state the component publishes on the wrapper (`data-motion`) drives them.
// #455 is where the marks and their keyframes come from.

const mark = (page) => page.locator('.sh-top [data-testid="animated-logo"]');
const animationOf = (locator, part) =>
  locator.locator(`[data-part="${part}"]`).evaluate((el) => {
    const s = getComputedStyle(el);
    return { name: s.animationName, iterations: s.animationIterationCount, playState: s.animationPlayState };
  });
const movingParts = (locator) => locator.locator('svg *').evaluateAll((els) => els.filter((el) => getComputedStyle(el).animationName !== 'none').length);

/** Hold the shell's background validate open (real work in flight) until released. */
async function holdValidate(page) {
  let release = () => {};
  const gate = new Promise((resolve) => { release = resolve; });
  await page.route('**/api/validate*', async (route) => {
    await gate;
    await route.continue();
  });
  return release;
}

test('at rest the top-bar brand is a still mark in both themes: one decorative SVG, nothing moving', async ({ page }) => {
  await gotoCockpit(page, '/help');
  const brand = mark(page);
  // The open-time validate is real work, so the mark moves briefly; it settles to still.
  await expect(brand).toHaveAttribute('data-motion', 'off', { timeout: 30_000 });
  for (const theme of ['dark', 'light']) {
    await setTheme(page, theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(brand).toHaveAttribute('aria-hidden', 'true');
    await expect(brand.locator('svg')).toHaveCount(1);
    await expect(page.locator('.sh-brand')).toContainText('Cockpit');
    await expect(brand).toHaveAttribute('data-motion', 'off');
    expect(await movingParts(brand), `nothing animates at rest in the ${theme} theme`).toBe(0);
    expect((await animationOf(brand, 'knob')).name).toBe('none');
  }
});

test('while the framework is working the mark moves (the toggle flips), and it goes still again after', async ({ page }) => {
  const release = await holdValidate(page);
  await gotoCockpit(page, '/help');
  const brand = mark(page);

  await expect(brand).toHaveAttribute('data-motion', 'busy');
  const knob = await animationOf(brand, 'knob');
  expect(knob.name).toBe('brand-toggle-knob');
  expect(knob.iterations).toBe('infinite');
  expect(knob.playState).toBe('running');
  // Only the knob and the bar that hands over to it move; the outline stays put.
  expect(await movingParts(brand)).toBe(2);
  // Still the same mark: one SVG, decorative, the word beside it is what is read.
  await expect(brand.locator('svg')).toHaveCount(1);
  await expect(brand).toHaveAttribute('aria-hidden', 'true');

  release();
  // Work ended: a short hold so a fast command still shows one visible cycle, then still.
  await expect(brand).toHaveAttribute('data-motion', 'off', { timeout: 30_000 });
  expect(await movingParts(brand)).toBe(0);
});

test('under reduced motion the brand runs no animation at all, even while the framework is working', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const release = await holdValidate(page);
  await gotoCockpit(page, '/help');
  const brand = mark(page);

  // Work is in flight, and the state the component publishes and the state the stylesheet applies both say "off".
  await expect(page.getByTestId('status-validate')).toContainText('checking', { timeout: 20_000 });
  await expect(brand).toHaveAttribute('data-motion', 'off');
  expect((await animationOf(brand, 'knob')).name).toBe('none');
  expect(await movingParts(brand), 'nothing in the mark animates under reduced motion').toBe(0);

  // The mark is still there: reduced motion loses the animation, never the brand.
  await expect(brand.locator('svg')).toHaveCount(1);
  await expect(page.locator('.sh-brand')).toContainText('Cockpit');
  release();
  await ctx.close();
});
