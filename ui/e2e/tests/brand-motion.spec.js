import { test, expect } from '@playwright/test';
import { gotoCockpit, setTheme } from './support/cockpit.js';

// #455 — the brand mark is always subtly animated (owner request, 2026-09-21), and stops being
// animated the moment the browser says the user does not want motion.
//
// The animation is CSS keyframes over our own inline SVG (no animation library, nothing downloaded),
// so what this spec checks is exactly what ships: the static mark is still in the DOM, and the motion
// state the component publishes on the wrapper (`data-motion`) drives a real, named animation.

const mark = (page) => page.locator('.sh-top [data-testid="animated-logo"]');
const animationOf = (locator, part) =>
  locator.locator(`[data-part="${part}"]`).evaluate((el) => {
    const s = getComputedStyle(el);
    return { name: s.animationName, iterations: s.animationIterationCount, playState: s.animationPlayState };
  });

test('the top-bar brand animates in both themes and still renders the static mark', async ({ page }) => {
  await gotoCockpit(page, '/help');
  const brand = mark(page);

  for (const theme of ['dark', 'light']) {
    await setTheme(page, theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

    // The mark itself is unchanged: one inline SVG, decorative, no accessible name of its own — the
    // word "Cockpit" beside it is what assistive tech reads.
    await expect(brand).toHaveAttribute('aria-hidden', 'true');
    await expect(brand.locator('svg')).toHaveCount(1);
    await expect(page.locator('.sh-brand')).toContainText('Cockpit');

    // Always on: the component reports `idle` and the lit knob really is running a named, infinite loop.
    await expect(brand).toHaveAttribute('data-motion', 'idle');
    const knob = await animationOf(brand, 'knob');
    expect(knob.name, `knob animates in the ${theme} theme`).toBe('brand-breathe');
    expect(knob.iterations).toBe('infinite');
    expect(knob.playState).toBe('running');
  }
});

test('the animation is subtle: one slow, low-amplitude loop and nothing else moving', async ({ page }) => {
  await gotoCockpit(page, '/help');
  const brand = mark(page);
  await expect(brand).toHaveAttribute('data-motion', 'idle');

  // Exactly one shape in the mark moves — the outline and the bar stay put.
  const moving = await brand.locator('svg *').evaluateAll((els) => els.filter((el) => getComputedStyle(el).animationName !== 'none').length);
  expect(moving, 'only one element of the mark is animated').toBe(1);

  // Slow: a cycle measured in seconds, not fractions of one.
  const seconds = await brand.locator('[data-part="knob"]').evaluate((el) => parseFloat(getComputedStyle(el).animationDuration));
  expect(seconds).toBeGreaterThanOrEqual(3);
  expect(seconds).toBeLessThanOrEqual(6);
});

test('under reduced motion the brand runs no animation loop at all', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await gotoCockpit(page, '/help');
  const brand = mark(page);

  // The state the component publishes, and the state the stylesheet actually applies, both say "off"
  // — not a 0.001ms loop that technically still runs every frame.
  await expect(brand).toHaveAttribute('data-motion', 'off');
  const knob = await animationOf(brand, 'knob');
  expect(knob.name).toBe('none');
  const moving = await brand.locator('svg *').evaluateAll((els) => els.filter((el) => getComputedStyle(el).animationName !== 'none').length);
  expect(moving, 'nothing in the mark animates under reduced motion').toBe(0);

  // The mark is still there — reduced motion loses the animation, never the brand.
  await expect(brand.locator('svg')).toHaveCount(1);
  await expect(page.locator('.sh-brand')).toContainText('Cockpit');
  await ctx.close();
});
