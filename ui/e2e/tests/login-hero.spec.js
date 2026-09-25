import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Login hero (owner request 2026-09-20): the login screen is a full-screen, crossfading slideshow of real
// Cockpit screens with a small typed, changing one-liner and the Cockpit mark. Runs against the auth-armed
// server (playwright.auth.config.js), signed out, so the real login screen is what is on screen.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(__dirname, '../screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

test('the login screen has a full-screen slideshow, the logo, and a typed tagline that keeps changing', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const screen = page.getByTestId('login-screen');
  await expect(screen).toBeVisible();

  // The Cockpit mark and name.
  const brand = page.getByTestId('login-brand');
  await expect(brand).toContainText('Cockpit');
  await expect(brand.locator('svg')).toHaveCount(1);

  // Full-screen backdrop: fixed, covering the viewport, six slides, hidden from assistive tech.
  const backdrop = page.getByTestId('login-backdrop');
  await expect(backdrop).toHaveAttribute('aria-hidden', 'true');
  const box = await backdrop.boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(1440);
  expect(box.height).toBeGreaterThanOrEqual(900);
  await expect(backdrop.locator('.login-backdrop__slide')).toHaveCount(6);

  // Slides crossfade: over a few seconds a different slide becomes the visible one, and the sum of the
  // slide opacities never drops below 1 (no dip to the background).
  const opacities = () => backdrop.locator('.login-backdrop__slide').evaluateAll((els) => els.map((e) => +getComputedStyle(e).opacity));
  const first = await opacities();
  let changed = false;
  let dipped = false;
  for (let i = 0; i < 16 && !changed; i += 1) {
    await page.waitForTimeout(500);
    const now = await opacities();
    if (Math.max(...now) < 0.99) dipped = true;
    if (now.indexOf(Math.max(...now)) !== first.indexOf(Math.max(...first))) changed = true;
  }
  expect(changed, 'a different slide takes over within 8s').toBe(true);
  expect(dipped, 'the topmost slide is always fully opaque').toBe(false);

  // Typed tagline: it starts empty/short, gets longer as it types, and the phrase changes over time.
  const tagline = page.getByTestId('login-tagline');
  const seen = new Set();
  for (let i = 0; i < 90; i += 1) {
    const t = ((await tagline.textContent()) || '').trim();
    if (t) seen.add(t);
    if ([...seen].some((s) => s.length >= 20) && seen.size > 6) break;
    await page.waitForTimeout(150);
  }
  expect([...seen].some((s) => s.length >= 20), 'a full phrase gets typed').toBe(true);
  expect(seen.size, 'the text is typed one character at a time').toBeGreaterThan(6);
  await expect(tagline).toHaveAttribute('aria-hidden', 'true');

  // The real sign-in heading and controls are still there and readable.
  await expect(page.getByRole('heading', { name: /Sign in to the Cockpit/ })).toBeVisible();
  await page.screenshot({ path: path.join(SHOTS, 'login-hero-1-slideshow-and-typing.png') });
});

// #455 (owner request, 2026-09-21): the login brand is a two-row lockup — a large mark alone on the
// first row, the tracked-uppercase wordmark centred under it — and it is the animated mark.
test('the login brand stacks a large, animated mark over the wordmark without crowding the card', async ({ page }) => {
  for (const [width, height] of [
    [1440, 900],
    [1280, 800],
    [390, 800],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto('/');
    const brand = page.getByTestId('login-brand');
    await expect(brand).toBeVisible();

    const logo = brand.getByTestId('animated-logo');
    const word = brand.locator('.login-brand__word');
    const logoBox = await logo.boundingBox();
    const wordBox = await word.boundingBox();

    // Two rows: the mark sits entirely above the word, and both are centred on the same axis.
    expect(logoBox.y + logoBox.height, `mark is above the wordmark at ${width}x${height}`).toBeLessThanOrEqual(wordBox.y + 1);
    expect(Math.abs(logoBox.x + logoBox.width / 2 - (wordBox.x + wordBox.width / 2))).toBeLessThan(4);

    // Big and prominent, but still fluid: never below 88px, never past 120px, never wider than the phone.
    expect(logoBox.width).toBeGreaterThanOrEqual(88);
    expect(logoBox.width).toBeLessThanOrEqual(120);
    expect(logoBox.width).toBeLessThan(width);

    // It is the animated mark, idling.
    await expect(logo).toHaveAttribute('data-motion', 'idle');

    // The bigger mark must not push the sign-in control below the fold.
    const signIn = page.getByTestId('login-test-user');
    await expect(signIn).toBeVisible();
    const button = await signIn.boundingBox();
    expect(button.y + button.height, `sign-in stays above the fold at ${width}x${height}`).toBeLessThanOrEqual(height);
  }
});

test('under reduced motion the tagline is static and the first slide is shown', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1200, height: 800 } });
  const page = await ctx.newPage();
  await page.goto('/');
  await expect(page.getByTestId('login-screen')).toBeVisible();
  const tagline = page.getByTestId('login-tagline');
  await expect(tagline).toContainText('Sign in to try a calmer way to build.');
  await expect(page.locator('.login-tagline__caret')).toHaveCount(0);
  // #455: the brand mark is still drawn, just not animated.
  await expect(page.getByTestId('login-brand').getByTestId('animated-logo')).toHaveAttribute('data-motion', 'off');
  const first = await page.locator('.login-backdrop__slide').first().evaluate((e) => +getComputedStyle(e).opacity);
  expect(first).toBe(1);
  await ctx.close();
});

test('the test login matches the GitHub button in size and shape (owner request 2026-09-21)', async ({ page }) => {
  // The e2e server has no OAuth app, so answer the session probe as one that offers both paths.
  await page.route('**/auth/session', async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    await route.fulfill({ response: res, json: { ...body, githubConfigured: true } });
  });
  await page.goto('/');
  const gh = page.getByTestId('login-github');
  const test = page.getByTestId('login-test-user');
  await expect(gh).toBeVisible();
  await expect(test).toBeVisible();
  const [a, b] = [await gh.boundingBox(), await test.boundingBox()];
  expect(b.height).toBe(a.height);
  expect(b.width).toBeGreaterThanOrEqual(240);
  const style = (l) => l.evaluate((e) => { const c = getComputedStyle(e); return [c.borderRadius, c.fontWeight, c.borderTopWidth].join('|'); });
  expect(await style(test)).toBe(await style(gh));
});

// #406 (owner request 2026-09-21): after a real sign-in the mark plays a short exit hand-off before
// the login screen is gone, instead of an instant cut — and the Cockpit is reachable either way.
test.describe('#406 login hand-off', () => {
  test('a real sign-in plays the mark\'s exit hand-off, then the Cockpit is reachable', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByTestId('login-screen')).toBeVisible();
    const mark = page.getByTestId('login-brand').getByTestId('animated-logo');
    await expect(mark).toHaveAttribute('data-motion', 'idle');

    await page.getByTestId('login-test-user').click();

    // Not an instant cut: the mark reports a real, named "exit" motion state at some point in the
    // hand-off, and while it does the browser is actually running a named animation on it — not
    // just an attribute with nothing behind it.
    await expect(mark).toHaveAttribute('data-motion', 'exit');
    const animated = await mark.evaluate((el) => getComputedStyle(el).animationName !== 'none');
    expect(animated, 'the exit motion state is a real, named CSS animation').toBe(true);

    // The hand-off finishes on its own — nobody has to unmount it by hand — the login screen is
    // fully gone, and the Cockpit underneath (already mounted for the hand-off, #406) is reachable.
    await expect(page.getByTestId('login-screen')).toHaveCount(0);
    await expect(page.getByRole('banner')).toBeVisible();
    await expect(page.getByTestId('user-menu-trigger')).toBeVisible();
  });

  test('under reduced motion the hand-off is skipped instantly and the Cockpit is still reachable', async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.goto('/dashboard');
    await expect(page.getByTestId('login-screen')).toBeVisible();
    const mark = page.getByTestId('login-brand').getByTestId('animated-logo');
    await expect(mark).toHaveAttribute('data-motion', 'off');

    await page.getByTestId('login-test-user').click();

    // No animation loop at all (the same contract idle/off already holds): the login screen resolves
    // almost at once rather than staying around for a visible hand-off, and the Cockpit is reachable.
    await expect(page.getByTestId('login-screen')).toHaveCount(0, { timeout: 1500 });
    await expect(page.getByRole('banner')).toBeVisible();
    await ctx.close();
  });
});

// #406 / #665: hold the session probe's answer until the test says so. A fixed delay (the old 700 ms) races the assertions on a
// loaded machine: the answer lands first, the loading screen is gone, and toBeVisible times out. Held, the loading branch stays on
// screen exactly as long as the assertions need; `release()` lets the real answer through (call it in a finally, so the page
// can finish and close cleanly whatever the assertions did).
async function holdSessionProbe(page) {
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  await page.route('**/auth/session', async (route) => {
    await held;
    await route.continue().catch(() => {}); // the page may already be closed when a failed assertion ended the test
  });
  return release;
}

// #406: the shared AnimatedLoader (same brand mark, a faster `busy` loop) replaces the generic
// `.st-spinner` on the "Checking your session" screen — the one real drop-in site this ticket wires.
test.describe('#406 AnimatedLoader', () => {
  test('the shared loader appears while the session is being checked', async ({ page }) => {
    // Hold the session probe so the loading branch stays on screen until every assertion below has run.
    const release = await holdSessionProbe(page);
    try {
      await page.goto('/dashboard', { waitUntil: 'commit' });
      const region = page.getByTestId('state-loading');
      await expect(region).toBeVisible();
      await expect(region).toHaveAttribute('role', 'status');
      await expect(region).toContainText('Checking your session');

      const loader = page.getByTestId('animated-loader');
      await expect(loader).toBeVisible();
      // Decorative here: `state-loading` above is already the one status announcement — the loader
      // does not add a second, competing one.
      await expect(loader).toHaveAttribute('aria-hidden', 'true');
      const mark = loader.getByTestId('animated-logo');
      await expect(mark).toHaveAttribute('data-motion', 'busy');
      // The default mark is 'cockpit' (app/brand.css animates its knob, not the wrapper, for `busy` —
      // same idiom as the always-on idle loop): a real, named animation is actually running.
      const animated = await mark.locator('[data-part="knob"]').evaluate((el) => getComputedStyle(el).animationName !== 'none');
      expect(animated, 'busy is a real, named CSS animation').toBe(true);
    } finally {
      release();
    }
  });

  test('under reduced motion the loader shows a static mark, no animation loop', async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    const release = await holdSessionProbe(page);
    try {
      await page.goto('/dashboard', { waitUntil: 'commit' });
      const loader = page.getByTestId('animated-loader');
      await expect(loader).toBeVisible();
      const mark = loader.getByTestId('animated-logo');
      await expect(mark).toHaveAttribute('data-motion', 'off');
      const moving = await mark.locator('svg *').evaluateAll((els) => els.filter((el) => getComputedStyle(el).animationName !== 'none').length);
      expect(moving, 'no animation runs under reduced motion').toBe(0);
    } finally {
      release();
      await ctx.close();
    }
  });
});
